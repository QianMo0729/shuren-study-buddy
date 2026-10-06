import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

// The storage module is loaded in-process against a throwaway data directory.
// Configuration is read from the environment at import time, so it is set first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-buddy-uploads-'));
Object.assign(process.env, {
  NODE_ENV: 'test', DATA_DIR: dir, UPLOAD_QUOTA_MB: '0.02', MIN_FREE_DISK_MB: '0',
  RESEND_API_KEY: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: '', ADMIN_EMAILS: '',
});
const { db, q } = await import('../server/db.ts');
const { config } = await import('../server/config.ts');
const { HttpError } = await import('../server/auth.ts');
const {
  ORPHAN_GRACE_HOURS, UPLOAD_DIR, assertStorageAvailable, assertUploadQuota, storeUpload, sweepOrphanPage, sweepOrphanUploads, uploadedBytes,
} = await import('../server/uploads.ts');
const { miscRouter } = await import('../server/routes/misc.ts');

test.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const QUOTA = 0.02 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (bytes: number) => Buffer.concat([PNG, Buffer.alloc(bytes - PNG.length, 7)]);
let seq = 0;
function createUser() {
  const id = Number(q.run('INSERT INTO users (email, activated, password_hash) VALUES (?, 1, ?)', `1264${String(++seq).padStart(4, '0')}@mail.sustech.edu.cn`, 'x').lastInsertRowid);
  q.run("INSERT INTO profiles (user_id, nickname, data) VALUES (?, ?, '{}')", id, `存储测试${id}`);
  return id;
}
const onDisk = () => fs.readdirSync(UPLOAD_DIR).sort();
const rows = () => q.all<{ name: string }>('SELECT name FROM uploads ORDER BY name').map((r) => r.name);
const age = (name: string, hours: number) => q.run("UPDATE uploads SET created_at = datetime('now', ?) WHERE name = ?", `-${hours} hours`, name);
const status = (fn: () => unknown) => {
  try { fn(); return 200; } catch (error) { if (error instanceof HttpError) return error.status; throw error; }
};

test('each stored file is counted against its owner; a failed registration leaves no file behind', () => {
  const user = createUser();
  const name = storeUpload(user, 'photo', 'png', png(3000));
  assert.equal(fs.statSync(path.join(UPLOAD_DIR, name)).size, 3000);
  assert.equal(q.get<{ bytes: number }>('SELECT bytes FROM uploads WHERE name = ?', name)!.bytes, 3000);
  storeUpload(user, 'forum', 'png', png(2000));
  q.run("INSERT INTO uploads (name, user_id, kind, bytes) VALUES ('cccccccccccccccccccccccc.jpg', ?, 'checkin', 900000)", user);
  assert.equal(uploadedBytes(user), 5000, 'check-in photos are limited per day instead and are not part of this quota');

  const before = onDisk();
  assert.throws(() => storeUpload(987654, 'photo', 'png', png(1000)), 'the owner does not exist, so the row cannot be inserted');
  assert.deepEqual(onDisk(), before, 'the file written before the failed insert was removed');
});

test('the per-user quota bounds cumulative storage, and reclaims the owner’s unused files before refusing', () => {
  const user = createUser();
  const kept = storeUpload(user, 'photo', 'png', png(8000));
  const unused = storeUpload(user, 'forum', 'png', png(8000));
  assert.equal(status(() => assertUploadQuota(user, 4000)), 200);
  assert.equal(status(() => assertUploadQuota(user, 8000)), 413, `${8000 * 3} bytes would exceed the ${QUOTA}-byte quota`);
  assert.equal(status(() => assertUploadQuota(createUser(), 8000)), 200, 'the quota is per user');

  // Still inside the grace period: an upload that has not been attached yet must stay usable.
  assert.equal(sweepOrphanUploads(user), 0);
  // Later, the photo kept in the profile stays; the image that was never used is reclaimed and frees the quota.
  q.run('UPDATE profiles SET data = ? WHERE user_id = ?', JSON.stringify({ photos: [kept] }), user);
  age(kept, ORPHAN_GRACE_HOURS + 1);
  age(unused, ORPHAN_GRACE_HOURS + 1);
  assert.equal(status(() => assertUploadQuota(user, 8000)), 200);
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, kept)));
  assert.equal(fs.existsSync(path.join(UPLOAD_DIR, unused)), false);
  assert.equal(q.get('SELECT 1 FROM uploads WHERE name = ?', unused), undefined);
  assert.equal(uploadedBytes(user), 8000);
});

test('the site-wide sweep removes exactly the files nothing refers to any more, a bounded page at a time', () => {
  for (const name of rows()) q.run('DELETE FROM uploads WHERE name = ?', name);
  fs.rmSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR);
  const user = createUser();
  const other = createUser();
  const old = (kind: string, owner = user) => {
    const name = storeUpload(owner, kind, 'png', png(500));
    age(name, ORPHAN_GRACE_HOURS + 5);
    return name;
  };
  const inProfile = old('photo');
  const inDraft = old('timetable');
  const inPost = old('forum');
  const inDeletedPost = old('forum');
  const inCheckin = old('checkin');
  const inReportedDeletedCheckin = old('checkin');
  const inReportedEditedPost = old('forum');
  const neverUsed = old('forum');
  const someoneElses = old('photo', other);
  const fresh = storeUpload(user, 'forum', 'png', png(500));

  q.run('UPDATE profiles SET data = ? WHERE user_id = ?', JSON.stringify({ photos: [inProfile] }), user);
  q.run("INSERT INTO profile_drafts (user_id, data, section) VALUES (?, ?, 'goals')", user, JSON.stringify({ timetable: inDraft }));
  // A file counts as used only by its owner's content: naming someone else's file does not keep it.
  q.run("INSERT INTO forum_posts (user_id, body, images) VALUES (?, '在用的帖子', ?)", user, JSON.stringify([inPost, someoneElses]));
  q.run("INSERT INTO forum_posts (user_id, body, images, deleted) VALUES (?, '已删除的帖子', ?, 1)", user, JSON.stringify([inDeletedPost]));
  const checkin = (image: string, deleted: number) => Number(q.run(
    `INSERT INTO checkins (user_id, image, place_label, stamped_at, local_date, stamp_text, deleted)
     VALUES (?, ?, '校外', datetime('now'), '2026-10-06', '2026-10-06 12:00:00 北京时间', ?)`, user, image, deleted).lastInsertRowid);
  checkin(inCheckin, 0);
  const reportedCheckin = checkin(inReportedDeletedCheckin, 1);
  const report = (type: string, id: number, snapshot: string) => Number(q.run(
    "INSERT INTO reports (reporter_id, target_type, target_id, reason, snapshot) VALUES (?, ?, ?, '其他', ?)", other, type, id, snapshot).lastInsertRowid);
  const checkinReport = report('checkin', reportedCheckin, `照片：${inReportedDeletedCheckin}\n说明：（无）`);
  // The author removed the image from the post after it was reported; the report still points at it.
  const editedPost = Number(q.run("INSERT INTO forum_posts (user_id, body, images) VALUES (?, '改过的帖子', '[]')", user).lastInsertRowid);
  const postReport = report('forum_post', editedPost, `改过的帖子\n图片：${inReportedEditedPost}`);

  const sweepAll = (pageSize: number) => {
    let after = '';
    let removed = 0;
    for (let pages = 0; ; pages++) {
      assert.ok(pages < 50, 'paging terminates');
      const page = sweepOrphanPage(after, pageSize);
      removed += page.removed;
      if (page.next === null) return removed;
      assert.ok(page.next > after, 'each page moves forward');
      after = page.next;
    }
  };
  assert.equal(sweepAll(3), 3);
  const gone = [inDeletedPost, neverUsed, someoneElses].sort();
  const kept = [inProfile, inDraft, inPost, inCheckin, inReportedDeletedCheckin, inReportedEditedPost, fresh].sort();
  assert.deepEqual(rows(), kept);
  assert.deepEqual(onDisk(), kept, 'rows and files are removed together');
  for (const name of gone) assert.equal(fs.existsSync(path.join(UPLOAD_DIR, name)), false);
  assert.equal(sweepAll(3), 0, 'a second pass finds nothing');

  // Evidence is kept only while the report is open.
  q.run("UPDATE reports SET status = 'dismissed' WHERE id IN (?, ?)", checkinReport, postReport);
  assert.equal(sweepAll(100), 2);
  assert.deepEqual(onDisk(), [inProfile, inDraft, inPost, inCheckin, fresh].sort());
});

test('uploads are refused while the data volume is nearly full', () => {
  assert.equal(status(assertStorageAvailable), 200);
  const configured = config.minFreeDiskBytes;
  config.minFreeDiskBytes = Number.MAX_SAFE_INTEGER;
  try {
    assert.equal(status(assertStorageAvailable), 507);
  } finally {
    config.minFreeDiskBytes = configured;
  }
});

test('POST /api/uploads enforces the quota without writing anything', async (t) => {
  const user = createUser();
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use((req, _res, next) => { req.user = { id: user, email: 'x@mail.sustech.edu.cn', role: 'user' }; next(); });
  app.use('/api', miscRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof HttpError ? error.status : 500).json({ error: String((error as Error).message) });
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const upload = async (bytes: number) => {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/uploads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'forum', dataUrl: `data:image/png;base64,${png(bytes).toString('base64')}` }),
    });
    return { status: response.status, body: await response.json() as { name?: string; error?: string } };
  };
  const first = await upload(9000);
  assert.equal(first.status, 200);
  assert.equal(q.get<{ bytes: number }>('SELECT bytes FROM uploads WHERE name = ?', first.body.name)!.bytes, 9000);
  assert.equal((await upload(9000)).status, 200);
  const [filesBefore, rowsBefore] = [onDisk(), rows()];
  const refused = await upload(9000);
  assert.equal(refused.status, 413);
  assert.match(refused.body.error!, /图片空间已满/);
  assert.deepEqual(onDisk(), filesBefore, 'no file was created');
  assert.deepEqual(rows(), rowsBefore, 'no row was created');
  assert.equal((await upload(2000)).status, 200, 'a file that still fits is accepted');
});
