import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import jpeg from 'jpeg-js';
import { emptyProfile } from '../shared/profileRules.ts';
import type { ProfileInput } from '../shared/types.ts';

// 1×1 PNG：上传接口只检查文件头，足够用于权限测试
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-auto-moderation-'));
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dir,
      APP_URL: url, ADMIN_EMAILS: '', DEV_SHOW_CODES: 'true', RESEND_API_KEY: '',
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const api = async (endpoint: string, cookie = '', method = 'GET', body?: unknown) => {
    const response = await fetch(`${url}/api${endpoint}`, { method, headers: {
      ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: url }),
    }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    return { status: response.status, text, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
  };
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      try { await ended; } finally { clearTimeout(timer); }
    }
    await fs.rm(dir, { recursive: true, force: true });
  };
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      if (child.exitCode !== null) throw new Error(`API exited: ${output}`);
      try { ready = (await api('/auth/me')).status === 200; } catch { /* Wait for binding. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, `API did not start: ${output}`);
    const db = new DatabaseSync(path.join(dir, 'app.db'));
    return { api, db, stop };
  } catch (error) { await stop(); throw error; }
}

const consent = { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true };

const HELD = '出售海洛因，有货私聊。';
const SAFE = '明天图书馆一起学线代。';

test('ordinary content publishes immediately while only high-risk public text is held across content types', { timeout: 120_000 }, async (t) => {
  const app = await startServer();
  const { api, db } = app;
  t.after(async () => { db.close(); await app.stop(); });
  let sequence = 0;
  const createUser = () => {
    const studentId = `1288${String(++sequence).padStart(4, '0')}`;
    const id = Number(db.prepare("INSERT INTO users(email,activated,password_hash) VALUES (?,1,'x')").run(`${studentId}@mail.sustech.edu.cn`).lastInsertRowid);
    const data: ProfileInput = {
      ...emptyProfile(), realName: '测试同学', studentId, gender: 'male', grade: 'y1', privacyConsent: consent,
      planTags: ['期末复习备考'], places: ['library'], schedule: [0], studyType: 'quiet', bio: SAFE,
    };
    db.prepare("INSERT INTO profiles(user_id,nickname,data,published,reviewed_at) VALUES (?,?,?,1,datetime('now'))").run(id, `自动测试${id}`, JSON.stringify(data));
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    return { id, data, cookie: `dz_sid=${token}` };
  };
  const author = createUser();
  const other = createUser();
  const profileOwner = createUser();
  const admin = createUser();
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
  const expectReview = (value: any, held: boolean) => {
    assert.equal(value.reviewPending, held);
    assert.equal(value.takenDown, false, 'automatic queue is not a human takedown');
    assert.equal(value.reviewReasons.length > 0, held);
  };
  const row = (table: string, id: number, key = 'id') => db.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(id) as any;

  await t.test('forum posts publish ordinary sensitive discussion and hold explicit high risk, including attached files', async () => {
    const safe = await api('/forum/posts', author.cookie, 'POST', { body: '最近压力大，想找人聊聊。也想学习毒品预防知识。' });
    assert.equal(safe.status, 200, safe.text);
    expectReview(safe.body.post, false);
    assert.ok(row('forum_posts', safe.body.post.id).reviewed_at);
    assert.equal((await api(`/forum/posts/${safe.body.post.id}`, other.cookie)).status, 200);
    const upload = await api('/uploads', author.cookie, 'POST', { kind: 'forum', dataUrl: PNG });
    assert.equal(upload.status, 200, upload.text);
    const held = await api('/forum/posts', author.cookie, 'POST', { body: HELD, images: [upload.body.name] });
    assert.equal(held.status, 200, held.text);
    expectReview(held.body.post, true);
    assert.equal(row('forum_posts', held.body.post.id).taken_down, 1);
    assert.equal((await api(`/forum/posts/${held.body.post.id}`, other.cookie)).status, 404);
    assert.equal((await api(`/files/${upload.body.name}`, other.cookie)).status, 404);
    assert.equal((await api(`/files/${upload.body.name}`, author.cookie)).status, 200);
    const edited = await api(`/forum/posts/${held.body.post.id}`, author.cookie, 'PUT', { body: SAFE, images: [upload.body.name] });
    expectReview(edited.body.post, false);
    assert.equal((await api(`/forum/posts/${held.body.post.id}`, other.cookie)).status, 200);
    db.prepare("UPDATE forum_posts SET taken_down=1, auto_held=0, takedown_reason='manual' WHERE id=?").run(held.body.post.id);
    const manualEdit = await api(`/forum/posts/${held.body.post.id}`, author.cookie, 'PUT', { body: SAFE });
    assert.equal(manualEdit.body.post.takenDown, true);
    assert.equal(manualEdit.body.post.reviewPending, false);
    assert.equal((await api(`/forum/posts/${held.body.post.id}`, other.cookie)).status, 404);
  });

  await t.test('held comments stay visible to their author but never leak through counts or notifications', async () => {
    const parent = await api('/forum/posts', other.cookie, 'POST', { body: SAFE });
    const target = parent.body.post.id;
    const before = (db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=?').get(other.id) as any).n;
    const comment = await api(`/forum/post/${target}/comments`, author.cookie, 'POST', { body: HELD });
    assert.equal(comment.status, 200, comment.text);
    assert.equal(comment.body.comment.reviewPending, true);
    assert.equal((await api(`/forum/post/${target}/comments`, author.cookie)).body.items.length, 1);
    assert.equal((await api(`/forum/post/${target}/comments`, other.cookie)).body.items.length, 0);
    assert.equal((await api(`/forum/posts/${target}`, other.cookie)).body.post.commentCount, 0);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=?').get(other.id) as any).n, before);
    const safe = await api(`/forum/post/${target}/comments`, author.cookie, 'POST', { body: SAFE });
    assert.equal(safe.body.comment.reviewPending, false);
    assert.ok(row('forum_comments', safe.body.comment.id).reviewed_at);
    assert.equal((await api(`/forum/post/${target}/comments`, other.cookie)).body.items.length, 1);
  });

  await t.test('recruitments rescreen edits and preserve manual removals', async () => {
    const input = { title: '一起学习', category: 'course', description: SAFE, timeText: '明天下午', location: '图书馆' };
    const safe = await api('/posts', author.cookie, 'POST', input);
    assert.equal(safe.status, 200, safe.text);
    expectReview(safe.body.post, false);
    const held = await api(`/posts/${safe.body.post.id}`, author.cookie, 'PUT', { ...input, description: HELD });
    expectReview(held.body.post, true);
    assert.equal((await api(`/posts/${safe.body.post.id}`, other.cookie)).status, 404);
    assert.equal((await api(`/posts/${safe.body.post.id}/interest`, other.cookie, 'POST', {})).status, 404);
    db.prepare("UPDATE posts SET auto_held=0, taken_down=1, takedown_reason='manual' WHERE id=?").run(safe.body.post.id);
    const manualEdit = await api(`/posts/${safe.body.post.id}`, author.cookie, 'PUT', input);
    assert.equal(manualEdit.body.post.takenDown, true);
    assert.equal(manualEdit.body.post.reviewPending, false);
  });

  await t.test('profile screening excludes identity and contacts, holds public edits, and never republishes drafts or manual removals', async () => {
    const data = { ...profileOwner.data, realName: HELD, contacts: { ...profileOwner.data.contacts, wechat: HELD } };
    const privateText = await api('/profiles/me', profileOwner.cookie, 'PUT', { profile: data });
    assert.equal(privateText.status, 200, privateText.text);
    expectReview(privateText.body.profile, false);
    const mbti = await api('/profiles/me', profileOwner.cookie, 'PUT', { profile: { ...data, mbti: HELD } });
    assert.equal(mbti.status, 200, mbti.text);
    expectReview(mbti.body.profile, true);
    assert.equal((await api(`/profiles/${profileOwner.id}`, other.cookie)).status, 404, 'the public free-text MBTI field is also screened');
    const adminView = await api(`/profiles/${profileOwner.id}`, admin.cookie);
    assert.equal(adminView.status, 200, adminView.text);
    expectReview(adminView.body.profile, true);
    const cleared = await api('/profiles/me', profileOwner.cookie, 'PUT', { profile: { ...data, mbti: 'INFP' } });
    expectReview(cleared.body.profile, false);
    assert.equal((await api(`/profiles/${profileOwner.id}`, other.cookie)).status, 200);
    const held = await api('/profiles/me', profileOwner.cookie, 'PUT', { profile: { ...data, bio: HELD } });
    expectReview(held.body.profile, true);
    assert.equal((await api(`/profiles/${profileOwner.id}`, other.cookie)).status, 404);
    const draft = await api('/profiles/me/draft', profileOwner.cookie, 'PUT', { section: 'goals', profile: { ...data, bio: SAFE } });
    assert.equal(draft.status, 200, draft.text);
    assert.equal(row('profiles', profileOwner.id, 'user_id').auto_held, 1, 'saving a private draft does not publish it');
    await api('/profiles/me/unpublish', profileOwner.cookie, 'POST', {});
    assert.equal(row('profiles', profileOwner.id, 'user_id').auto_held, 0);
    const publish = await api('/profiles/me/publish', profileOwner.cookie, 'POST', {});
    assert.equal(publish.status, 200, publish.text);
    assert.equal(publish.body.reviewPending, true);
    db.prepare("UPDATE profiles SET auto_held=0, taken_down=1, takedown_reason='manual' WHERE user_id=?").run(profileOwner.id);
    await api('/profiles/me', profileOwner.cookie, 'PUT', { profile: data });
    assert.equal((await api('/profiles/me/publish', profileOwner.cookie, 'POST', {})).status, 409);
    assert.equal(row('profiles', profileOwner.id, 'user_id').taken_down, 1);
    assert.equal((await api(`/profiles/${profileOwner.id}`, other.cookie)).status, 404);
  });

  await t.test('check-in captions are screened before feed/file exposure', async () => {
    const pixels = Buffer.alloc(320 * 240 * 4, 220);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    const image = `data:image/jpeg;base64,${jpeg.encode({ data: pixels, width: 320, height: 240 }, 80).data.toString('base64')}`;
    for (const caption of [SAFE, HELD]) {
      const session = await api('/checkins/session', author.cookie, 'POST', {});
      assert.equal(session.status, 200, session.text);
      db.prepare('UPDATE checkin_sessions SET created_at=? WHERE user_id=? AND used=0').run(new Date(Date.now() - 2_000).toISOString(), author.id);
      const result = await api('/checkins', author.cookie, 'POST', { token: session.body.token, image, caption, visibility: 'all', location: null });
      assert.equal(result.status, 200, result.text);
      expectReview(result.body.checkin, caption === HELD);
      const expected = caption === HELD ? 404 : 200;
      assert.equal((await api(`/checkins/${result.body.checkin.id}`, other.cookie)).status, expected);
      assert.equal((await api(`/files/${result.body.checkin.image}`, other.cookie)).status, expected);
      assert.equal((await api(`/files/${result.body.checkin.image}`, author.cookie)).status, 200);
    }
  });
});

test('startup migration screens legacy public unreviewed content while preserving drafts, deletions and human decisions', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-moderation-migration-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const initialize = () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', "await import('./server/community.ts');"], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, NODE_ENV: 'test', DATA_DIR: dir, ADMIN_EMAILS: '' },
      encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr);
  };
  initialize();
  let db = new DatabaseSync(path.join(dir, 'app.db'));
  const user = Number(db.prepare("INSERT INTO users(email) VALUES ('migration@mail.sustech.edu.cn')").run().lastInsertRowid);
  const tables = ['profiles', 'posts', 'forum_posts', 'forum_comments', 'checkins'];
  const cases = ['ordinary', 'high', 'manual', 'approved', 'private'] as const;
  const fixtures: { table: string; key: string; id: number; kind: typeof cases[number] }[] = [];
  for (const table of tables) {
    for (const kind of cases) {
      const text = kind === 'ordinary' ? SAFE : HELD;
      let id: number;
      if (table === 'profiles') {
        id = Number(db.prepare('INSERT INTO users(email) VALUES (?)').run(`${kind}@mail.sustech.edu.cn`).lastInsertRowid);
        db.prepare('INSERT INTO profiles(user_id,nickname,data,published) VALUES (?,?,?,?)').run(id, kind, JSON.stringify({ bio: text }), kind === 'private' ? 0 : 1);
      } else if (table === 'posts') {
        id = Number(db.prepare("INSERT INTO posts(user_id,title,category) VALUES (?,?,'course')").run(user, text).lastInsertRowid);
      } else if (table === 'forum_posts') {
        id = Number(db.prepare('INSERT INTO forum_posts(user_id,body) VALUES (?,?)').run(user, text).lastInsertRowid);
      } else if (table === 'forum_comments') {
        id = Number(db.prepare("INSERT INTO forum_comments(user_id,body,target_type,target_id) VALUES (?,?,'post',1)").run(user, text).lastInsertRowid);
      } else {
        id = Number(db.prepare("INSERT INTO checkins(user_id,image,caption,place_label,stamped_at,local_date,stamp_text) VALUES (?,'migration.jpg',?,'campus',datetime('now'),'2026-10-06','stamp')").run(user, text).lastInsertRowid);
      }
      const key = table === 'profiles' ? 'user_id' : 'id';
      if (kind === 'manual') db.prepare(`UPDATE ${table} SET taken_down=1,takedown_reason='manual' WHERE ${key}=?`).run(id);
      if (kind === 'approved') db.prepare(`UPDATE ${table} SET reviewed_at='2026-09-01 00:00:00' WHERE ${key}=?`).run(id);
      if (kind === 'private' && table !== 'profiles') db.prepare(`UPDATE ${table} SET deleted=1 WHERE ${key}=?`).run(id);
      fixtures.push({ table, key, id, kind });
    }
    db.exec(`DROP INDEX idx_${table}_auto_held; ALTER TABLE ${table} DROP COLUMN auto_held; ALTER TABLE ${table} DROP COLUMN risk_reasons;`);
  }
  db.close();
  initialize();
  initialize(); // Startup is idempotent and does not override its previous queue.
  db = new DatabaseSync(path.join(dir, 'app.db'));
  try {
    for (const fixture of fixtures) {
      const row = db.prepare(`SELECT * FROM ${fixture.table} WHERE ${fixture.key}=?`).get(fixture.id) as any;
      assert.equal(row.auto_held, fixture.kind === 'high' ? 1 : 0, `${fixture.table}/${fixture.kind}`);
      assert.equal(row.taken_down, fixture.kind === 'high' || fixture.kind === 'manual' ? 1 : 0);
      if (fixture.kind === 'ordinary') assert.ok(row.reviewed_at);
      else if (fixture.kind === 'approved') assert.equal(row.reviewed_at, '2026-09-01 00:00:00');
      else assert.equal(row.reviewed_at, null);
      if (fixture.kind === 'manual') assert.equal(row.takedown_reason, 'manual');
      if (fixture.kind === 'private' && fixture.table === 'profiles') assert.equal(row.published, 0);
    }
  } finally { db.close(); }
});
