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
import type { ProfileInput } from '../shared/types.ts';

const password = 'ChatFixturePassword2026';

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-notes-'));
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dir,
      APP_URL: url, ADMIN_EMAILS: '', DEV_SHOW_CODES: 'false', RESEND_API_KEY: '',
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const api = async (endpoint: string, cookie = '', method = 'GET', body?: unknown) => {
    const response = await fetch(`${url}/api${endpoint}`, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: url }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    return { status: response.status, text, body: (() => { try { return JSON.parse(text); } catch { return text; } })() as any };
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
    return { api, db: new DatabaseSync(path.join(dir, 'app.db')), stop };
  } catch (error) { await stop(); throw error; }
}

test('private notes preserve owner isolation and existing visibility boundaries', { timeout: 120_000 }, async (t) => {
  const app = await startServer();
  const { api, db } = app;
  t.after(async () => { db.close(); await app.stop(); });
  const passwordHash = await bcrypt.hash(password, 4);
  let studentNumber = 12620000;
  function createUser() {
    const studentId = String(++studentNumber);
    const id = Number(db.prepare('INSERT INTO users (email, activated, password_hash) VALUES (?, 1, ?)')
      .run(`${studentId}@mail.sustech.edu.cn`, passwordHash).lastInsertRowid);
    const data: ProfileInput = { ...emptyProfile(), realName: `姓名${id}`, studentId, gender: 'male', grade: 'y1',
      major: '计算机科学与技术', planTags: ['期末复习备考'], schedule: [0, 1, 2], studyType: 'quiet', places: ['library'],
      privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true } };
    db.prepare('INSERT INTO profiles (user_id, nickname, data, published, saved_at) VALUES (?, ?, ?, 1, ?)')
      .run(id, `备注测试${id}`, JSON.stringify(data), new Date().toISOString());
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    return { id, cookie: `dz_sid=${token}`, data };
  }
  const a = createUser();
  const b = createUser();
  const c = createUser();
  const notes = (owner: typeof a, target: typeof a, method = 'GET', body?: unknown) => api(`/notes/${target.id}`, owner.cookie, method, body);
  const matchId = Number(db.prepare('INSERT INTO matches (user_a, user_b) VALUES (?, ?)').run(a.id, b.id).lastInsertRowid);
  const count = () => (db.prepare('SELECT COUNT(*) n FROM user_notes').get() as { n: number }).n;
  const notificationCount = () => (db.prepare('SELECT COUNT(*) n FROM notifications').get() as { n: number }).n;

  await t.test('authentication, target validation, lengths and input types', async () => {
    assert.equal((await api(`/notes/${b.id}`)).status, 401);
    assert.equal((await notes(a, a)).status, 404);
    for (const id of ['0', '-1', '1.5', 'abc', '999999999']) {
      assert.equal((await api(`/notes/${id}`, a.cookie)).status, 404);
    }
    assert.equal((await notes(a, b, 'PUT', { remarkName: 123, note: '' })).status, 400);
    assert.equal((await notes(a, b, 'PUT', { remarkName: '字'.repeat(41), note: '' })).status, 400);
    assert.equal((await notes(a, b, 'PUT', { remarkName: '', note: '字'.repeat(301) })).status, 400);
    assert.equal(count(), 0);
  });

  await t.test('notes are private to their author and do not change nickname, notifications or public search', async () => {
    const notificationsBefore = notificationCount();
    const saved = await notes(a, b, 'PUT', { remarkName: '  私密备注名  ', note: '周三\r\n复习\u202E', ownerId: c.id, targetId: c.id });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.privateNote.remarkName, '私密备注名');
    assert.equal(saved.body.privateNote.note, '周三\n复习');
    assert.ok(saved.body.privateNote.updatedAt.endsWith('Z'));
    assert.equal((await notes(c, b)).body.privateNote, null);
    assert.equal((await notes(b, a)).body.privateNote, null);
    assert.equal((await notes(a, b)).body.privateNote.note, '周三\n复习');
    assert.equal(notificationCount(), notificationsBefore);
    assert.equal(db.prepare('SELECT nickname FROM profiles WHERE user_id = ?').get(b.id)!.nickname, `备注测试${b.id}`);
    assert.ok(!String(db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(b.id)!.data).includes('私密备注名'));

    const ownProfile = await api(`/profiles/${b.id}`, a.cookie);
    assert.equal(ownProfile.body.profile.privateNote.remarkName, '私密备注名');
    assert.equal((await api(`/profiles/${b.id}`, c.cookie)).body.profile.privateNote, null);
    assert.ok(!(await api(`/profiles/${b.id}`, b.cookie)).text.includes('私密备注名'));
    assert.equal((await api('/profiles?q=' + encodeURIComponent('私密备注名'), a.cookie)).body.items.length, 0);
    const myCards = (await api('/profiles', a.cookie)).body.items;
    assert.equal(myCards.find((card: any) => card.id === b.id).remarkName, '私密备注名');
    assert.ok(!(await api('/profiles', c.cookie)).text.includes('私密备注名'));
    assert.equal((await api(`/chat/${matchId}`, a.cookie)).body.summary.other.privateNote.remarkName, '私密备注名');
    assert.equal((await api(`/chat/${matchId}`, b.cookie)).body.summary.other.privateNote, null);
    assert.equal((await api('/chat', a.cookie)).body.items[0].other.privateNote.remarkName, '私密备注名');
    assert.ok(!(await api('/chat', b.cookie)).text.includes('私密备注名'));
  });

  await t.test('withdrawn or taken-down strangers are unavailable; legal chat history remains available', async () => {
    db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(b.id);
    assert.equal((await notes(c, b)).status, 404);
    assert.equal((await notes(c, b, 'PUT', { remarkName: '', note: 'hidden' })).status, 404);
    assert.equal((await notes(c, b, 'DELETE')).status, 404);
    assert.equal((await notes(a, b)).status, 200);
    db.prepare("UPDATE matches SET status = 'closed' WHERE id = ?").run(matchId);
    assert.equal((await notes(a, b, 'PUT', { remarkName: '历史会话备注', note: '' })).status, 200);
    db.prepare('UPDATE profiles SET published = 1, taken_down = 1 WHERE user_id = ?').run(b.id);
    assert.equal((await notes(c, b)).status, 404);
    db.prepare('UPDATE profiles SET taken_down = 0, data = ? WHERE user_id = ?')
      .run(JSON.stringify({ ...b.data, privacyConsent: { ...b.data.privacyConsent, policy: false } }), b.id);
    assert.equal((await notes(c, b)).status, 404);
    db.prepare('UPDATE profiles SET data = ? WHERE user_id = ?').run(JSON.stringify(b.data), b.id);
  });

  await t.test('exclusion in either direction hides notes even with chat history', async () => {
    for (const [from, to] of [[a.id, b.id], [b.id, a.id]]) {
      db.prepare('INSERT INTO exclusions (user_id, target_id) VALUES (?, ?)').run(from, to);
      assert.equal((await notes(a, b)).status, 404);
      assert.equal((await notes(a, b, 'PUT', { remarkName: '', note: 'excluded' })).status, 404);
      assert.equal((await notes(a, b, 'DELETE')).status, 404);
      assert.equal((await api('/chat', a.cookie)).body.items.length, 0);
      db.prepare('DELETE FROM exclusions WHERE user_id = ? AND target_id = ?').run(from, to);
    }
    assert.equal((await notes(a, b)).body.privateNote.remarkName, '历史会话备注');
  });

  await t.test('empty values and explicit delete clear only the current owner record', async () => {
    await notes(c, b, 'PUT', { remarkName: 'C的备注', note: '' });
    assert.equal((await notes(a, b, 'PUT', { remarkName: ' ', note: ' ' })).body.privateNote, null);
    assert.equal((await notes(c, b)).body.privateNote.remarkName, 'C的备注');
    assert.equal((await notes(c, b, 'DELETE')).status, 200);
    assert.equal((await notes(c, b)).body.privateNote, null);
    assert.equal(count(), 0);
  });

  await t.test('account deletion removes notes owned by and targeting the anonymized account', async () => {
    await notes(a, b, 'PUT', { remarkName: 'A给B', note: '' });
    await notes(b, a, 'PUT', { remarkName: 'B给A', note: '' });
    await notes(c, b, 'PUT', { remarkName: 'C给B', note: '' });
    await notes(c, a, 'PUT', { remarkName: 'C给A', note: '' });
    assert.equal(count(), 4);
    const response = await api('/auth/account', a.cookie, 'DELETE', { password });
    assert.equal(response.status, 200);
    assert.equal(count(), 1);
    assert.equal((await notes(c, b)).body.privateNote.remarkName, 'C给B');
    assert.equal((await notes(c, a)).status, 404);
    assert.equal((await api('/auth/account', b.cookie, 'DELETE', { password })).status, 200);
    assert.equal(count(), 0);
  });
});
