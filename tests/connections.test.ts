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
import bcrypt from 'bcryptjs';
import { emptyProfile } from '../shared/profileRules.ts';

const password = 'ContactPassword2026';

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-connections-'));
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
  const api = async (endpoint: string, cookie = '', method = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}) => {
    const response = await fetch(`${url}/api${endpoint}`, { method, headers: {
      ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: url }), ...extraHeaders,
    }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    return { status: response.status, cacheControl: response.headers.get('cache-control'), body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
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
    return { api, db, dir, stop };
  } catch (error) { await stop(); throw error; }
}

test('contact exchange, exclusion and account withdrawal preserve privacy', { timeout: 60_000 }, async (t) => {
  const app = await startServer();
  const { api, db } = app;
  t.after(async () => { db.close(); await app.stop(); });
  const passwordHash = await bcrypt.hash(password, 4);
  function createUser(studentId: string) {
    const email = `${studentId}@mail.sustech.edu.cn`;
    const id = Number(db.prepare('INSERT INTO users (email, activated, password_hash) VALUES (?, 1, ?)').run(email, passwordHash).lastInsertRowid);
    const data = { ...emptyProfile(), schemaVersion: 2, realName: `私密姓名${id}`, studentId, gender: 'male', grade: 'y1',
      contacts: { showEmail: true, wechat: `private-wechat-${id}`, qq: '', phone: '', other: '' },
      privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true } };
    db.prepare('INSERT INTO profiles (user_id, nickname, data, published) VALUES (?, ?, ?, 1)').run(id, `测试同学${id}`, JSON.stringify(data));
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    return { id, email, cookie: `dz_sid=${token}`, data };
  }
  /** 直接写库：双方互相感兴趣并建立配对（交换联系方式必须先有进行中的配对） */
  function matchUsers(x: { id: number }, y: { id: number }): number {
    for (const [from, to] of [[x, y], [y, x]]) {
      db.prepare("INSERT OR REPLACE INTO match_feedback (user_id, target_id, action) VALUES (?, ?, 'like')").run(from.id, to.id);
    }
    return Number(db.prepare('INSERT INTO matches (user_a, user_b) VALUES (?, ?)').run(Math.min(x.id, y.id), Math.max(x.id, y.id)).lastInsertRowid);
  }
  const a = createUser('12618801');
  const b = createUser('12618802');
  const outsider = createUser('12618803');
  let requestId: number;
  let publicPhoto: string;

  await t.test('profile HTTP writes bind identity, preserve the assigned nickname and enforce consent on publication', async () => {
    const studentId = '12618804';
    const member = createUser(studentId);
    // Exercise first-visit nickname allocation rather than reusing the fixture nickname.
    db.prepare('DELETE FROM profiles WHERE user_id = ?').run(member.id);
    const initial = await api('/profiles/me', member.cookie);
    assert.equal(initial.status, 200);
    const assignedNickname = initial.body.profile.nickname;
    assert.ok(assignedNickname);
    assert.equal(initial.body.profile.studentId, studentId);
    const minimum = {
      realName: '测试姓名', studentId: '99999999', nickname: '尝试伪造的昵称', gender: 'male', grade: 'y1',
      planTags: ['期末复习备考'], places: ['library'], schedule: [0], studyType: 'quiet',
      privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true },
    };
    const saved = await api('/profiles/me', member.cookie, 'PUT', { profile: minimum });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.missing, []);
    assert.equal(saved.body.profile.studentId, studentId);
    assert.equal(saved.body.profile.nickname, assignedNickname);
    assert.equal(JSON.parse(String(db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(member.id)!.data)).studentId, studentId);
    for (const field of ['major', 'mbti', 'bio', 'frequency', 'duration']) {
      assert.equal(saved.body.profile[field], '', `${field} must remain optional`);
    }
    assert.equal(saved.body.profile.gender, 'male');
    assert.equal(saved.body.profile.grade, 'y1');
    assert.equal((await api('/profiles/me/nickname', member.cookie, 'POST', {})).status, 410);
    assert.equal((await api('/profiles/me', member.cookie)).body.profile.nickname, assignedNickname);

    for (const consentKey of Object.keys(minimum.privacyConsent)) {
      const complete = await api('/profiles/me', member.cookie, 'PUT', { profile: minimum });
      assert.deepEqual(complete.body.missing, []);
      assert.equal((await api('/profiles/me/publish', member.cookie, 'POST', {})).status, 200);
      assert.equal((await api(`/profiles/${member.id}`, a.cookie)).status, 200);
      const withdrawn = await api('/profiles/me', member.cookie, 'PUT', { profile: {
        ...minimum, privacyConsent: { ...minimum.privacyConsent, [consentKey]: false },
      } });
      assert.equal(withdrawn.status, 200);
      assert.equal(withdrawn.body.profile.published, false, `withdrawing ${consentKey} must unpublish immediately`);
      assert.equal(withdrawn.body.profile.studentId, studentId);
      assert.ok(withdrawn.body.missing.some((item: { key: string }) => item.key === 'privacyConsent'));
      assert.equal((await api(`/profiles/${member.id}`, a.cookie)).status, 404);
      assert.equal((await api('/profiles/me/publish', member.cookie, 'POST', {})).status, 400);
    }
  });

  await t.test('rejects cross-origin and cross-site mutations without changing session state', async () => {
    assert.equal((await api('/auth/logout', a.cookie, 'POST', {}, { Origin: 'https://unrelated.example' })).status, 403);
    assert.equal((await api('/auth/logout', a.cookie, 'POST', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await api('/auth/me', a.cookie)).body.user.id, a.id);
  });

  await t.test('requires current publication and every privacy consent before requesting contact', async () => {
    assert.equal((await api(`/connections/${b.id}`, '', 'POST', {})).status, 401);
    db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(a.id);
    assert.equal((await api(`/connections/${b.id}`, a.cookie, 'POST', {})).status, 403);
    db.prepare('UPDATE profiles SET published = 1, data = ? WHERE user_id = ?').run(JSON.stringify({ ...a.data,
      privacyConsent: { ...a.data.privacyConsent, contactExchange: false } }), a.id);
    assert.equal((await api(`/connections/${b.id}`, a.cookie, 'POST', {})).status, 403);
    db.prepare('UPDATE profiles SET data = ? WHERE user_id = ?').run(JSON.stringify(a.data), a.id);
    assert.equal((await api(`/connections/${a.id}`, a.cookie, 'POST', {})).status, 400);
    // 资料齐全但还没有互相感兴趣：只能先在匹配推荐里配对，再到私聊中申请
    const unmatched = await api(`/connections/${b.id}`, a.cookie, 'POST', {});
    assert.equal(unmatched.status, 403);
    assert.match(unmatched.body.error, /互相感兴趣/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM contact_requests').get()?.n, 0);
  });

  await t.test('pending request reveals no contacts and only the recipient can accept it', async () => {
    const matchId = matchUsers(a, b);
    const sent = await api(`/connections/${b.id}`, a.cookie, 'POST', { message: '一起复习数学' });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.request.status, 'pending');
    requestId = sent.body.request.id;
    assert.equal(sent.body.emailStatus, 'logged');
    assert.equal((await api(`/connections/${b.id}`, a.cookie)).body.contacts, null);
    assert.equal((await api(`/connections/${a.id}`, b.cookie)).body.contacts, null);
    assert.equal((await api(`/profiles/${b.id}/contact`, a.cookie, 'POST', {})).status, 403);
    assert.equal((await api(`/connections/${requestId}/respond`, a.cookie, 'POST', { action: 'accept' })).status, 404);
    assert.equal((await api(`/connections/${requestId}/respond`, outsider.cookie, 'POST', { action: 'accept' })).status, 404);
    const duplicates = await Promise.all([
      api(`/connections/${b.id}`, a.cookie, 'POST', {}), api(`/connections/${a.id}`, b.cookie, 'POST', {}),
    ]);
    assert.equal(duplicates[0].body.request.id, requestId);
    assert.equal(duplicates[1].body.request.id, requestId);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM contact_requests').get()?.n, 1);
    assert.equal((await api('/connections', b.cookie)).body.items[0].direction, 'incoming');
    assert.equal((await api(`/connections/${requestId}/respond`, b.cookie, 'POST', { action: 'accept' })).status, 200);
    assert.equal((await api(`/connections/${b.id}`, a.cookie)).body.contacts.wechat, b.data.contacts.wechat);
    assert.equal((await api(`/connections/${a.id}`, b.cookie)).body.contacts.email, a.email);
    // 申请与同意都会以系统消息写进两人的私聊
    const notes = (db.prepare("SELECT body FROM messages WHERE match_id = ? AND kind = 'system' ORDER BY id").all(matchId) as { body: string }[]).map((row) => row.body);
    assert.equal(notes.length, 2);
    assert.match(notes[0], /申请交换联系方式/);
    assert.match(notes[1], /同意了交换联系方式/);
    // 私聊列表与消息里只出现昵称，不出现任何联系方式或身份信息
    const chatPayload = JSON.stringify([(await api('/chat', a.cookie)).body, (await api(`/chat/${matchId}`, a.cookie)).body]);
    for (const secret of [b.data.contacts.wechat, b.email, b.data.realName, a.data.contacts.wechat, a.email]) {
      assert.equal(chatPayload.includes(secret), false, `chat must not leak ${secret}`);
    }
    db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(b.id);
    assert.equal((await api(`/connections/${b.id}`, a.cookie)).status, 404);
    db.prepare('UPDATE profiles SET published = 1 WHERE user_id = ?').run(b.id);
  });

  await t.test('rejection never grants contact access', async () => {
    matchUsers(a, outsider);
    const pending = await api(`/connections/${outsider.id}`, a.cookie, 'POST', {});
    const rejected = await api(`/connections/${pending.body.request.id}/respond`, outsider.cookie, 'POST', { action: 'reject' });
    assert.equal(rejected.body.request.status, 'rejected');
    assert.equal((await api(`/connections/${outsider.id}`, a.cookie)).body.contacts, null);
    assert.equal((await api(`/connections/${a.id}`, outsider.cookie)).body.contacts, null);
    // 被拒绝后 7 天内不能再次申请，申请状态保持“未通过”
    assert.equal((await api(`/connections/${outsider.id}`, a.cookie, 'POST', {})).status, 409);
    assert.equal((await api(`/connections/${outsider.id}`, a.cookie)).body.request.status, 'rejected');
    assert.equal((await api(`/profiles/${outsider.id}/contact`, a.cookie, 'POST', {})).status, 403);
  });

  await t.test('photos are private by default; public media links revoke immediately on withdrawal or moderation', async () => {
    publicPhoto = `${crypto.randomBytes(12).toString('hex')}.png`;
    const timetable = `${crypto.randomBytes(12).toString('hex')}.png`;
    for (const [name, kind] of [[publicPhoto, 'photo'], [timetable, 'timetable']]) {
      await fs.writeFile(path.join(app.dir, 'uploads', name), Buffer.from('private-media-fixture'));
      db.prepare('INSERT INTO uploads (name, user_id, kind) VALUES (?, ?, ?)').run(name, b.id, kind);
    }
    const profile = { ...b.data, photos: [publicPhoto], timetable };
    assert.equal(profile.photoVisibility, 'private');
    db.prepare('UPDATE profiles SET data = ? WHERE user_id = ?').run(JSON.stringify(profile), b.id);
    assert.equal((await api(`/files/${publicPhoto}`, a.cookie)).status, 404);
    assert.equal((await api(`/files/${publicPhoto}`, b.cookie)).status, 200);
    assert.deepEqual((await api(`/profiles/${b.id}`, a.cookie)).body.profile.photos, []);
    db.prepare('UPDATE profiles SET data = ? WHERE user_id = ?').run(JSON.stringify({ ...profile, photoVisibility: 'public' }), b.id);
    const file = await api(`/files/${publicPhoto}`, a.cookie);
    assert.equal(file.status, 200);
    assert.match(file.cacheControl!, /no-store/);
    assert.equal((await api(`/files/${timetable}`, a.cookie)).status, 404);
    db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(b.id);
    assert.equal((await api(`/files/${publicPhoto}`, a.cookie)).status, 404);
    assert.equal((await api(`/files/${publicPhoto}`, b.cookie)).status, 200);
    db.prepare('UPDATE profiles SET published = 1, taken_down = 1 WHERE user_id = ?').run(b.id);
    assert.equal((await api(`/files/${publicPhoto}`, a.cookie)).status, 404);
    assert.equal((await api(`/files/${publicPhoto}`, b.cookie)).status, 200);
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(outsider.id);
    assert.equal((await api(`/files/${publicPhoto}`, outsider.cookie)).status, 200);
    db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(outsider.id);
    db.prepare('UPDATE profiles SET taken_down = 0 WHERE user_id = ?').run(b.id);
    assert.equal((await api(`/files/${publicPhoto}`, a.cookie)).status, 200);
  });

  await t.test('exclusion is silent, revokes prior consent and hides both profiles from one another', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ?').get(b.id)!.n;
    assert.equal((await api(`/connections/${b.id}/exclude`, a.cookie, 'POST', {})).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ?').get(b.id)!.n, before);
    assert.equal((await api(`/connections/${b.id}`, a.cookie)).status, 404);
    assert.equal((await api(`/connections/${a.id}`, b.cookie)).status, 404);
    assert.equal((await api(`/profiles/${a.id}`, b.cookie)).status, 404);
    assert.equal((await api(`/files/${publicPhoto}`, a.cookie)).status, 404);
    assert.equal((await api('/profiles', a.cookie)).body.items.some((item: any) => item.id === b.id), false);
    assert.equal((await api('/connections', a.cookie)).body.exclusions[0].id, b.id);
    assert.equal((await api('/connections', b.cookie)).body.items.some((item: any) => item.id === requestId), false);
    // 排除同时解除配对：双方的私聊列表里都不再出现对方
    assert.equal(db.prepare("SELECT COUNT(*) n FROM matches WHERE status = 'active' AND user_a = ? AND user_b = ?").get(Math.min(a.id, b.id), Math.max(a.id, b.id))!.n, 0);
    assert.equal((await api('/chat', a.cookie)).body.items.some((item: any) => item.other.id === b.id), false);
    assert.equal((await api('/chat', b.cookie)).body.items.some((item: any) => item.other.id === a.id), false);
    assert.equal((await api(`/connections/${b.id}/exclude`, a.cookie, 'DELETE')).status, 200);
    assert.equal((await api(`/connections/${b.id}`, a.cookie)).body.contacts, null);
    assert.equal((await api(`/connections/${b.id}`, a.cookie)).body.request, null);
  });

  await t.test('deletion needs the current password and retracts content, credentials, files and private data', async () => {
    const filename = `${crypto.randomBytes(12).toString('hex')}.png`;
    await fs.writeFile(path.join(app.dir, 'uploads', filename), Buffer.from('private-photo'));
    db.prepare("INSERT INTO uploads (name, user_id, kind) VALUES (?, ?, 'photo')").run(filename, a.id);
    const postId = Number(db.prepare("INSERT INTO posts (user_id, title, category, description) VALUES (?, '私密标题', 'study', '私密正文')").run(a.id).lastInsertRowid);
    db.prepare("INSERT INTO moderation_logs (admin_id, action, target_type, target_id, target_user_id) VALUES (?, 'review', 'post', ?, ?)").run(a.id, postId, a.id);
    assert.equal((await api('/auth/account', a.cookie, 'DELETE', { password: 'wrong' })).status, 400);
    assert.equal((await api('/auth/account', a.cookie, 'DELETE', { password })).status, 200);
    assert.equal((await api('/auth/me', a.cookie)).body.user, null);
    assert.equal((await api(`/profiles/${a.id}`, b.cookie)).status, 404);
    assert.equal((await api(`/files/${filename}`, b.cookie)).status, 404);
    await assert.rejects(fs.access(path.join(app.dir, 'uploads', filename)));
    assert.equal(db.prepare('SELECT 1 FROM profiles WHERE user_id = ?').get(a.id), undefined);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(a.id)!.n, 0);
    assert.equal(db.prepare('SELECT deleted FROM posts WHERE id = ?').get(postId)!.deleted, 1);
    assert.equal(db.prepare('SELECT description FROM posts WHERE id = ?').get(postId)!.description, '');
    const account = db.prepare('SELECT activated, password_hash, email FROM users WHERE id = ?').get(a.id)!;
    assert.equal(account.activated, 0);
    assert.equal(account.password_hash, null);
    assert.match(String(account.email), /@deleted\.invalid$/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM moderation_logs WHERE target_user_id = ?').get(a.id)!.n, 1);
  });
});
