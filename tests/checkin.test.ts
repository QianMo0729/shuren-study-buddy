import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import jpeg from 'jpeg-js';
import { CAMPUS, CAMPUS_PLACES, NO_LOCATION_LABEL, OFF_CAMPUS_LABEL } from '../shared/campusPlaces.ts';
import { REPORT_REASONS } from '../shared/options.ts';
import { emptyProfile } from '../shared/profileRules.ts';
import type { ProfileInput } from '../shared/types.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** 用 jpeg-js 生成测试照片（亮色渐变），模拟网页 canvas 编码的 JPEG */
function photo(width = 640, height = 480, shade = 230) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const x = (i / 4) % width;
    data[i] = shade;
    data[i + 1] = Math.max(0, shade - Math.floor((x / width) * 30));
    data[i + 2] = Math.max(0, shade - 40);
    data[i + 3] = 255;
  }
  return jpeg.encode({ data, width, height }, 85).data;
}
const dataUrl = (buf: Buffer) => `data:image/jpeg;base64,${buf.toString('base64')}`;

/** 在 SOI 后插入带相机型号（Make）的 EXIF：相册照片的特征 */
function withCameraExif(buf: Buffer) {
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0x08, 0x00, 0x01, 0x01, 0x0f, 0x00, 0x02, 0, 0, 0, 0x04, 0x41, 0x42, 0x43, 0, 0, 0, 0, 0]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  return Buffer.concat([buf.subarray(0, 2), app1, buf.subarray(2)]);
}

/** 北京日期，day 为相对今天的偏移 */
const beijingDay = (day = 0) => new Date(Date.now() + 8 * 3600_000 + day * 86400_000).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-checkin-'));
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
    }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const buf = Buffer.from(await response.arrayBuffer());
    const text = buf.toString();
    return { status: response.status, text, buf, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
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
      await sleep(50);
    }
    assert.ok(ready, `API did not start: ${output}`);
    const db = new DatabaseSync(path.join(dir, 'app.db'));
    return { api, db, dir, stop };
  } catch (error) { await stop(); throw error; }
}

const consent = { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true };

test('live check-ins: session tokens, JPEG-only uploads, server stamp, visibility, stats and file access', { timeout: 180_000 }, async (t) => {
  const app = await startServer();
  const { api, db } = app;
  t.after(async () => { db.close(); await app.stop(); });

  let seq = 0;
  function createUser(opts: { role?: 'admin' | 'user'; profile?: Partial<ProfileInput> } = {}) {
    seq++;
    const studentId = `1263${String(seq).padStart(4, '0')}`;
    const email = `${studentId}@mail.sustech.edu.cn`;
    const id = Number(db.prepare("INSERT INTO users (email, activated, password_hash, role) VALUES (?, 1, 'x', ?)").run(email, opts.role ?? 'user').lastInsertRowid);
    const data: ProfileInput = {
      ...emptyProfile(), realName: `私密姓名${id}`, studentId,
      contacts: { showEmail: true, wechat: `private-wechat-${id}`, qq: '', phone: '', other: '' },
      privacyConsent: consent, ...opts.profile,
    };
    const nickname = `打卡同学${id}`;
    db.prepare('INSERT INTO profiles (user_id, nickname, data, published) VALUES (?, ?, ?, 1)').run(id, nickname, JSON.stringify(data));
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    return { id, email, nickname, studentId, cookie: `dz_sid=${token}` };
  }
  const matchUsers = (x: number, y: number) =>
    db.prepare("INSERT INTO matches (user_a, user_b, status) VALUES (?, ?, 'active')").run(Math.min(x, y), Math.max(x, y));

  const author = createUser();
  const buddy = createUser();
  const other = createUser();
  const excluded = createUser();
  const admin = createUser({ role: 'admin' });
  matchUsers(author.id, buddy.id);
  db.prepare('INSERT INTO exclusions (user_id, target_id) VALUES (?, ?)').run(author.id, excluded.id);

  const session = async (user: { cookie: string }, wait = true) => {
    const r = await api('/checkins/session', user.cookie, 'POST', {});
    assert.equal(r.status, 200, r.text);
    if (wait) await sleep(600);
    return r.body as { token: string; expiresAt: string; serverTime: string };
  };
  const lynn = CAMPUS_PLACES.find((p) => p.id === 'lynn-library')!;
  const submit = (user: { cookie: string }, body: Record<string, unknown>) =>
    api('/checkins', user.cookie, 'POST', { image: dataUrl(photo()), caption: '', visibility: 'all', location: null, ...body });

  let publicId = 0;
  let buddiesId = 0;
  let publicImage = '';
  let buddiesImage = '';

  await t.test('requires login', async () => {
    assert.equal((await api('/checkins')).status, 401);
    assert.equal((await api('/checkins/session', '', 'POST', {})).status, 401);
  });

  await t.test('issues short-lived one-time sessions', async () => {
    const before = Date.now();
    const s = await session(author, false);
    assert.match(s.token, /^[A-Za-z0-9_-]{43}$/);
    const ttl = Date.parse(s.expiresAt) - Date.parse(s.serverTime);
    assert.equal(ttl, 3 * 60_000);
    assert.ok(Math.abs(Date.parse(s.serverTime) - before) < 5_000);
    // 只存 sha256
    const stored = db.prepare('SELECT token_hash FROM checkin_sessions WHERE user_id = ?').all(author.id) as { token_hash: string }[];
    assert.ok(stored.length >= 1);
    assert.ok(stored.every((r) => r.token_hash !== s.token));
    assert.ok(stored.some((r) => r.token_hash === crypto.createHash('sha256').update(s.token).digest('hex')));
  });

  await t.test('rejects missing, unknown, too-early, foreign, expired and reused tokens', async () => {
    assert.equal((await submit(author, {})).status, 400);
    assert.equal((await submit(author, { token: 'not-a-token' })).status, 400);
    assert.equal((await submit(author, { token: crypto.randomBytes(32).toString('base64url') })).status, 400);

    // 领取后立即提交：太快
    const quick = await session(author, false);
    const early = await submit(author, { token: quick.token });
    assert.equal(early.status, 400);
    assert.match(early.body.error, /稍等/);

    // 别人的凭证不能用，且不会被消耗
    const mine = await session(author);
    const stolen = await submit(other, { token: mine.token });
    assert.equal(stolen.status, 400);
    assert.match(stolen.body.error, /凭证无效/);

    // 过期
    const old = await session(author);
    db.prepare('UPDATE checkin_sessions SET expires_at = ? WHERE token_hash = ?').run(
      new Date(Date.now() - 1000).toISOString(), crypto.createHash('sha256').update(old.token).digest('hex'));
    const expired = await submit(author, { token: old.token });
    assert.equal(expired.status, 400);
    assert.match(expired.body.error, /过期/);

    // 本人凭证可用一次，第二次被拒
    const ok = await submit(author, { token: mine.token, caption: '一次性凭证' });
    assert.equal(ok.status, 200, ok.text);
    const again = await submit(author, { token: mine.token });
    assert.equal(again.status, 400);
    assert.match(again.body.error, /已经提交过/);
    // 并发提交同一个凭证：只有一次成功
    const race = await session(author);
    const results = await Promise.all([submit(author, { token: race.token }), submit(author, { token: race.token })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    // 清理：这些不是后续测试关心的打卡
    db.prepare('UPDATE checkins SET deleted = 1 WHERE user_id = ?').run(author.id);
  });

  await t.test('accepts only live JPEG data and validates every field', async () => {
    const s = await session(other);
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ image: PNG }, /JPEG/],
      [{ image: `data:image/jpeg;base64,${Buffer.from(PNG.split(',')[1], 'base64').toString('base64')}` }, /JPEG/],
      [{ image: 'data:image/jpeg;base64,!!!!' }, /不完整/],
      [{ image: `data:image/webp;base64,${photo().toString('base64')}` }, /JPEG/],
      [{ image: 'abc.jpg' }, /JPEG/],
      [{ image: dataUrl(photo(200, 480)) }, /尺寸/],
      [{ image: dataUrl(photo(640, 200)) }, /尺寸/],
      [{ image: dataUrl(withCameraExif(photo())) }, /相册/],
      [{ image: dataUrl(Buffer.concat([photo().subarray(0, 200)])) }, /JPEG|无法识别/],
      [{ caption: 'x'.repeat(201) }, /200/],
      [{ caption: 42 }, /说明/],
      [{ visibility: 'friends' }, /谁可以看到/],
      [{ location: { lat: 'a', lng: 113.99, accuracy: 10 } }, /位置/],
      [{ location: { lat: 91, lng: 113.99, accuracy: 10 } }, /位置/],
      [{ location: { lat: 22.6, lng: 113.99 } }, /位置/],
      [{ location: { lat: 22.6, lng: 113.99, accuracy: -1 } }, /位置/],
    ];
    for (const [body, error] of cases) {
      const r = await submit(other, { token: s.token, ...body });
      assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 80)} → ${r.text}`);
      assert.match(r.body.error, error);
    }
    // 校验失败不消耗凭证：修正后同一个凭证仍可提交
    const r = await submit(other, { token: s.token, location: { lat: 39.9, lng: 116.4, accuracy: 30 } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.checkin.placeLabel, OFF_CAMPUS_LABEL);
    assert.equal((await api(`/checkins/${r.body.checkin.id}`, other.cookie, 'DELETE')).status, 200);
  });

  await t.test('/api/uploads cannot produce check-in photos', async () => {
    const r = await api('/uploads', author.cookie, 'POST', { dataUrl: dataUrl(photo()), kind: 'checkin' });
    if (r.status === 200) {
      const row = db.prepare('SELECT kind FROM uploads WHERE name = ?').get(r.body.name) as { kind: string };
      assert.notEqual(row.kind, 'checkin');
      // 已上传的文件名也不能当作打卡照片提交
      const s = await session(author);
      const reuse = await submit(author, { token: s.token, image: r.body.name });
      assert.equal(reuse.status, 400);
    } else {
      assert.equal(r.status, 400);
    }
  });

  await t.test('stamps place and server time; client time fields are ignored; no coordinates are stored', async () => {
    const s = await session(author);
    const before = Date.now();
    const r = await submit(author, {
      token: s.token, caption: '  图书馆三楼，线代第三章  ', visibility: 'all',
      location: { lat: lynn.lat, lng: lynn.lng, accuracy: 12 },
      stampedAt: '2001-01-01T00:00:00.000Z', stampText: '2001-01-01 08:00:00 北京时间', serverTime: '2001-01-01T00:00:00.000Z', time: 978307200000,
    });
    const after = Date.now();
    assert.equal(r.status, 200, r.text);
    const c = r.body.checkin;
    publicId = c.id;
    publicImage = c.image;
    assert.equal(c.caption, '图书馆三楼，线代第三章');
    assert.equal(c.placeLabel, `${CAMPUS.short}·${lynn.label}`);
    assert.equal(c.visibility, 'all');
    assert.equal(c.isMine, true);
    assert.equal(c.author.nickname, author.nickname);
    assert.equal(JSON.stringify(c).includes(author.email), false);
    assert.equal(JSON.stringify(c).includes(author.studentId), false);
    assert.equal(JSON.stringify(c).includes('private-wechat'), false);
    const stamped = Date.parse(c.stampedAt);
    assert.ok(stamped >= Math.floor(before / 1000) * 1000 && stamped <= after, 'stamp time must come from the server');
    assert.doesNotMatch(c.stampText, /2001/);
    assert.match(c.stampText, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} 北京时间$/);
    // 北京时间 = UTC+8
    const expected = new Date(stamped + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
    assert.equal(c.stampText, `${expected} 北京时间`);
    assert.deepEqual(r.body.stats, { streak: 1, total: 1, checkedInToday: true });

    const row = db.prepare('SELECT * FROM checkins WHERE id = ?').get(c.id) as Record<string, unknown>;
    assert.equal(row.local_date, beijingDay());
    assert.equal(row.place_label, c.placeLabel);
    assert.equal(row.stamp_text, c.stampText);
    assert.ok(!Object.keys(row).some((k) => /lat|lng|lon|accuracy/.test(k)));
    assert.ok(!JSON.stringify(row).includes(String(lynn.lat)));
    const upload = db.prepare('SELECT user_id, kind FROM uploads WHERE name = ?').get(c.image) as { user_id: number; kind: string };
    assert.deepEqual({ ...upload }, { user_id: author.id, kind: 'checkin' });
    assert.match(c.image, /^[a-f0-9]{24}\.jpg$/);

    // 保存的是盖过章、去掉元数据的照片
    const file = await fs.readFile(path.join(app.dir, 'uploads', c.image));
    const img = jpeg.decode(file, { useTArray: true });
    assert.equal(img.width, 640);
    assert.equal(img.height, 480);
    let dark = 0;
    for (let y = 400; y < 476; y++) for (let x = 300; x < 636; x++) if (img.data[(y * 640 + x) * 4] < 60) dark++;
    assert.ok(dark > 200, 'watermark pixels should be black on a light photo');
    assert.ok(img.data[(10 * 640 + 10) * 4] > 200, 'the rest of the photo is untouched');

    // 仅搭子可见的一条，未提供位置
    const s2 = await session(author);
    const r2 = await submit(author, { token: s2.token, visibility: 'buddies', image: dataUrl(photo(480, 640, 40)) });
    assert.equal(r2.status, 200, r2.text);
    buddiesId = r2.body.checkin.id;
    buddiesImage = r2.body.checkin.image;
    assert.equal(r2.body.checkin.placeLabel, NO_LOCATION_LABEL);
    assert.equal(r2.body.stats.total, 2);
  });

  await t.test('visibility: all → everyone except excluded; buddies → active matches only; author and admin always', async () => {
    const can = async (user: { cookie: string }, id: number) => (await api(`/checkins/${id}`, user.cookie)).status;
    const file = async (user: { cookie: string }, name: string) => (await api(`/files/${name}`, user.cookie)).status;
    const feed = async (user: { cookie: string }, scope = 'all') =>
      ((await api(`/checkins?scope=${scope}`, user.cookie)).body.items as { id: number }[]).map((c) => c.id);

    for (const u of [author, buddy, other, admin]) assert.equal(await can(u, publicId), 200);
    assert.equal(await can(excluded, publicId), 404);
    for (const u of [author, buddy, admin]) assert.equal(await can(u, buddiesId), 200);
    for (const u of [other, excluded]) assert.equal(await can(u, buddiesId), 404);

    assert.equal(await file(other, publicImage), 200);
    assert.equal(await file(excluded, publicImage), 404);
    assert.equal(await file(buddy, buddiesImage), 200);
    assert.equal(await file(other, buddiesImage), 404);
    assert.equal(await file(admin, buddiesImage), 200);
    assert.equal(await file(author, buddiesImage), 200);
    const served = await api(`/files/${publicImage}`, other.cookie);
    assert.equal(served.buf[0], 0xff);
    assert.equal(served.buf[1], 0xd8);

    assert.deepEqual(await feed(buddy), [buddiesId, publicId]);
    assert.deepEqual(await feed(other), [publicId]);
    assert.deepEqual(await feed(excluded), []);
    assert.deepEqual(await feed(author), [buddiesId, publicId]);
    assert.deepEqual(await feed(author, 'mine'), [buddiesId, publicId]);
    assert.deepEqual(await feed(buddy, 'buddies'), [buddiesId, publicId]);
    assert.deepEqual(await feed(other, 'buddies'), []);
    assert.deepEqual(await feed(other, 'mine'), []);

    // 配对解除后，仅搭子可见的打卡对原搭子也不可见
    db.prepare("UPDATE matches SET status = 'closed' WHERE user_a = ? AND user_b = ?").run(Math.min(author.id, buddy.id), Math.max(author.id, buddy.id));
    assert.equal(await can(buddy, buddiesId), 404);
    assert.equal(await file(buddy, buddiesImage), 404);
    assert.deepEqual(await feed(buddy, 'buddies'), []);
    db.prepare("UPDATE matches SET status = 'active' WHERE user_a = ? AND user_b = ?").run(Math.min(author.id, buddy.id), Math.max(author.id, buddy.id));

    // 互相排除：反方向（被排除者主动排除作者）同样生效
    const late = createUser();
    db.prepare('INSERT INTO exclusions (user_id, target_id) VALUES (?, ?)').run(late.id, author.id);
    assert.equal(await can(late, publicId), 404);
    assert.deepEqual(await feed(late), []);
  });

  await t.test('likes, comments and reports go through the registered content target', async () => {
    assert.equal((await api(`/forum/checkin/${buddiesId}/like`, buddy.cookie, 'POST', {})).status, 200);
    assert.equal((await api(`/forum/checkin/${buddiesId}/like`, other.cookie, 'POST', {})).status, 404);
    assert.equal((await api(`/forum/checkin/${publicId}/comments`, other.cookie, 'POST', { body: '加油！' })).status, 200);
    assert.equal((await api(`/forum/checkin/${publicId}/comments`, excluded.cookie, 'POST', { body: '看不到' })).status, 404);
    const c = (await api(`/checkins/${publicId}`, author.cookie)).body.checkin;
    assert.equal(c.commentCount, 1);
    const liked = (await api(`/checkins/${buddiesId}`, buddy.cookie)).body.checkin;
    assert.equal(liked.likeCount, 1);
    assert.equal(liked.liked, true);
    // 评论通知作者，链接到打卡详情
    const note = db.prepare('SELECT link FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(author.id) as { link: string };
    assert.equal(note.link, `/community/checkins/${publicId}`);

    const report = (user: { cookie: string }, id: number) =>
      api('/reports', user.cookie, 'POST', { targetType: 'checkin', targetId: id, reason: REPORT_REASONS[0] });
    const ok = await report(other, publicId);
    assert.equal(ok.status, 200, ok.text);
    // 看不到的打卡、自己的打卡都不能举报
    assert.equal((await report(other, buddiesId)).status, 404);
    assert.equal((await report(excluded, publicId)).status, 404);
    assert.equal((await report(author, publicId)).status, 404);
    const stored = db.prepare("SELECT detail FROM reports WHERE target_type = 'checkin' AND target_id = ?").get(publicId) as { detail: string };
    assert.match(stored.detail, /图书馆三楼/);
    assert.match(stored.detail, new RegExp(publicImage));
  });

  await t.test('taken-down check-ins are hidden from others but visible to the author (with reason) and admins', async () => {
    db.prepare("UPDATE checkins SET taken_down = 1, takedown_reason = '与学习无关' WHERE id = ?").run(publicId);
    assert.equal((await api(`/checkins/${publicId}`, other.cookie)).status, 404);
    assert.equal((await api(`/files/${publicImage}`, other.cookie)).status, 404);
    assert.equal((await api(`/forum/checkin/${publicId}/like`, other.cookie, 'POST', {})).status, 404);
    const mine = await api(`/checkins/${publicId}`, author.cookie);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.checkin.takenDown, true);
    assert.equal(mine.body.checkin.takedownReason, '与学习无关');
    const seen = await api(`/checkins/${publicId}`, admin.cookie);
    assert.equal(seen.status, 200);
    assert.equal(seen.body.checkin.takenDown, true);
    const feed = (await api('/checkins', other.cookie)).body.items as { id: number }[];
    assert.ok(!feed.some((c) => c.id === publicId));
    const mineFeed = (await api('/checkins?scope=mine', author.cookie)).body.items as { id: number; takenDown: boolean }[];
    assert.equal(mineFeed.find((c) => c.id === publicId)?.takenDown, true);
    // 他人看到的打卡不带审核信息
    const buddyView = (await api(`/checkins/${buddiesId}`, buddy.cookie)).body.checkin;
    assert.equal(buddyView.takenDown, false);
    assert.equal(buddyView.takedownReason, null);
    db.prepare('UPDATE checkins SET taken_down = 0, takedown_reason = NULL WHERE id = ?').run(publicId);
  });

  await t.test('only the author can delete; deleted check-ins disappear for everyone', async () => {
    assert.equal((await api(`/checkins/${publicId}`, other.cookie, 'DELETE')).status, 403);
    assert.equal((await api(`/checkins/${publicId}`, admin.cookie, 'DELETE')).status, 403);
    assert.equal((await api(`/checkins/${publicId}`, author.cookie, 'DELETE')).status, 200);
    assert.equal((await api(`/checkins/${publicId}`, author.cookie, 'DELETE')).status, 404);
    for (const u of [author, buddy, other]) assert.equal((await api(`/checkins/${publicId}`, u.cookie)).status, 404);
    assert.equal((await api(`/files/${publicImage}`, other.cookie)).status, 404);
    assert.equal((await api(`/forum/checkin/${publicId}/comments`, other.cookie)).status, 404);
    assert.equal((await api('/checkins/abc', author.cookie)).status, 404);
    assert.equal((await api('/checkins/999999', author.cookie)).status, 404);
  });

  await t.test('stats: streak counts consecutive Beijing dates up to today (or yesterday)', async () => {
    const d = createUser();
    const insert = (date: string, extra: { deleted?: number; taken_down?: number } = {}) => db.prepare(
      `INSERT INTO checkins (user_id, image, caption, place_label, stamped_at, local_date, stamp_text, visibility, deleted, taken_down, created_at)
       VALUES (?, 'x.jpg', '', '校外', datetime('now', '-3 days'), ?, '', 'all', ?, ?, datetime('now', '-3 days'))`,
    ).run(d.id, date, extra.deleted ?? 0, extra.taken_down ?? 0);
    assert.deepEqual((await api('/checkins/stats', d.cookie)).body, { streak: 0, total: 0, checkedInToday: false });
    insert(beijingDay(-1));
    insert(beijingDay(-1));
    insert(beijingDay(-2));
    insert(beijingDay(-4));
    insert(beijingDay(-3), { deleted: 1 });
    insert(beijingDay(-3), { taken_down: 1 });
    // 今天还没打卡：截至昨天连续 2 天
    assert.deepEqual((await api('/checkins/stats', d.cookie)).body, { streak: 2, total: 4, checkedInToday: false });
    const s = await session(d);
    const r = await submit(d, { token: s.token });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.stats, { streak: 3, total: 5, checkedInToday: true });
    assert.deepEqual((await api('/checkins/stats', d.cookie)).body, { streak: 3, total: 5, checkedInToday: true });

    // 断了一天：只算到今天
    const e = createUser();
    db.prepare(
      `INSERT INTO checkins (user_id, image, place_label, stamped_at, local_date, stamp_text, created_at)
       VALUES (?, 'y.jpg', '校外', datetime('now', '-3 days'), ?, '', datetime('now', '-3 days'))`,
    ).run(e.id, beijingDay(-2));
    assert.deepEqual((await api('/checkins/stats', e.cookie)).body, { streak: 0, total: 1, checkedInToday: false });
  });

  await t.test('daily limit of 10 check-ins (deleting does not reset it)', async () => {
    const f = createUser();
    for (let i = 0; i < 10; i++) {
      db.prepare(
        `INSERT INTO checkins (user_id, image, place_label, stamped_at, local_date, stamp_text, deleted)
         VALUES (?, 'z.jpg', '校外', datetime('now'), ?, '', ?)`,
      ).run(f.id, beijingDay(), i % 2);
    }
    const s = await session(f);
    const r = await submit(f, { token: s.token });
    assert.equal(r.status, 429);
    assert.match(r.body.error, /10/);
  });

  await t.test('pagination with before cursor', async () => {
    const g = createUser();
    const ids: number[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push(Number(db.prepare(
        `INSERT INTO checkins (user_id, image, place_label, stamped_at, local_date, stamp_text, created_at)
         VALUES (?, ?, '校外', datetime('now', '-2 days'), ?, '', datetime('now', '-2 days'))`,
      ).run(g.id, `${crypto.randomBytes(12).toString('hex')}.jpg`, beijingDay(-2)).lastInsertRowid));
    }
    const first = await api('/checkins?scope=mine', g.cookie);
    assert.equal(first.body.items.length, 20);
    assert.equal(first.body.hasMore, true);
    assert.deepEqual(first.body.items.map((c: { id: number }) => c.id), ids.slice(5).reverse());
    const second = await api(`/checkins?scope=mine&before=${first.body.items.at(-1).id}`, g.cookie);
    assert.equal(second.body.items.length, 5);
    assert.equal(second.body.hasMore, false);
    assert.deepEqual(second.body.items.map((c: { id: number }) => c.id), ids.slice(0, 5).reverse());
  });

  await t.test('session endpoint is rate limited (20 per 10 minutes)', async () => {
    const h = createUser();
    for (let i = 0; i < 20; i++) assert.equal((await api('/checkins/session', h.cookie, 'POST', {})).status, 200);
    assert.equal((await api('/checkins/session', h.cookie, 'POST', {})).status, 429);
  });
});

test('the check-in UI has no file picker, album or upload entry — photos only come from getUserMedia', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const dir = path.join(root, 'src/components/checkin');
  const files = [
    path.join(root, 'src/pages/CheckinCamera.tsx'),
    path.join(root, 'src/pages/CheckinDetail.tsx'),
    ...(await fs.readdir(dir)).map((f) => path.join(dir, f)),
  ];
  for (const file of files) {
    const src = await fs.readFile(file, 'utf8');
    const name = path.relative(root, file);
    assert.doesNotMatch(src, /type=["'{]*file/i, `${name} must not contain a file input`);
    assert.doesNotMatch(src, /showOpenFilePicker|FileReader|api\.upload|compressImage|capture=/, `${name} must not read local files`);
  }
  const camera = await fs.readFile(path.join(root, 'src/pages/CheckinCamera.tsx'), 'utf8')
    + await fs.readFile(path.join(dir, 'useLiveCamera.ts'), 'utf8');
  assert.match(camera, /getUserMedia/);
  assert.match(camera, /toDataURL\('image\/jpeg', quality\)/);
  assert.match(camera, /getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
});
