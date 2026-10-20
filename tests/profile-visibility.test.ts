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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-visibility-'));
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

test('people search and favorites enforce public visibility without daily recommendation limits', { timeout: 120_000 }, async (t) => {
  const app = await startServer();
  const { api, db } = app;
  t.after(async () => { db.close(); await app.stop(); });
  const hash = await bcrypt.hash(password, 4);
  let number = 12623000;
  function member(patch: Partial<ProfileInput> = {}) {
    const studentId = String(++number);
    const id = Number(db.prepare('INSERT INTO users (email, activated, password_hash) VALUES (?, 1, ?)').run(`${studentId}@mail.sustech.edu.cn`, hash).lastInsertRowid);
    const data = { ...emptyProfile(), realName: '测试', studentId, gender: 'male', grade: 'y1', schedule: [0], studyType: 'quiet',
      bio: '一起学习', privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true }, ...patch };
    db.prepare('INSERT INTO profiles (user_id, nickname, data, published) VALUES (?, ?, ?, 1)').run(id, `公开测试${id}`, JSON.stringify(data));
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    return { id, cookie: `dz_sid=${token}`, data };
  }
  const viewer = member();
  const visible = Array.from({ length: 7 }, () => member({ schedule: [50], major: '数学与应用数学' }));
  const inactive = member();
  db.prepare('UPDATE users SET activated = 0 WHERE id = ?').run(inactive.id);
  const noPassword = member();
  db.prepare('UPDATE users SET password_hash = NULL WHERE id = ?').run(noPassword.id);
  const emptyPassword = member();
  db.prepare("UPDATE users SET password_hash = '' WHERE id = ?").run(emptyPassword.id);
  const privateMember = member();
  db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(privateMember.id);
  const takenDown = member();
  db.prepare('UPDATE profiles SET taken_down = 1 WHERE user_id = ?').run(takenDown.id);
  const noConsent = member({ privacyConsent: { policy: true, contactExchange: false, silentExclusion: true, withdrawal: true } });
  const excluded = member();
  const excludesViewer = member();
  db.prepare('INSERT INTO exclusions (user_id, target_id) VALUES (?, ?)').run(viewer.id, excluded.id);
  db.prepare('INSERT INTO exclusions (user_id, target_id) VALUES (?, ?)').run(excludesViewer.id, viewer.id);
  for (const person of [...visible, inactive, noPassword, emptyPassword, privateMember, takenDown, noConsent, excluded, excludesViewer]) {
    db.prepare('INSERT INTO favorites (user_id, target_id) VALUES (?, ?)').run(viewer.id, person.id);
  }
  const expected = visible.map((person) => person.id).sort((a, b) => a - b);
  for (const endpoint of ['/profiles/favorites', '/profiles/search']) {
    const result = await api(endpoint, viewer.cookie, endpoint.endsWith('search') ? 'POST' : 'GET', endpoint.endsWith('search') ? { criteria: [], matchMode: 'precise', mutualGender: false } : undefined);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.items.map((item: any) => item.id).sort((a: number, b: number) => a - b), expected);
    if (endpoint.endsWith('search')) assert.equal(result.body.total, 7);
    assert.ok(result.body.items.every((item: any) => item.overlapHours === 0), 'active search permits students with no common time');
  }
  const square = await api('/profiles', viewer.cookie);
  assert.deepEqual(square.body.items.map((item: any) => item.id).sort((a: number, b: number) => a - b), [viewer.id, ...expected]);
  assert.equal(square.body.total, 8, 'total does not expose hidden profiles');
  const search = await api('/profiles/search', viewer.cookie, 'POST', { criteria: [], keyword: '一起学习' });
  assert.equal(search.body.total, 7, 'keyword search shares the same visibility boundary and is not capped to five');
  const timeFiltered = await api('/profiles/search', viewer.cookie, 'POST', { criteria: [{ field: 'overlap', mode: 'must', values: ['1'] }] });
  assert.equal(timeFiltered.body.total, 0, 'time only becomes a hard constraint when explicitly requested');
});
