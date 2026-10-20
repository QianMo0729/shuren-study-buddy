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
import { COURSE_OPTIONS } from '../shared/courseCatalog.ts';

test('private timetables validate structured input, isolate users and clean up on account deletion', { timeout: 60_000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-timetable-'));
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dir,
      APP_URL: url, ADMIN_EMAILS: '', DEV_SHOW_CODES: 'false', RESEND_API_KEY: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  let db: DatabaseSync | undefined;
  t.after(async () => {
    db?.close();
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit'); child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await ended; } finally { clearTimeout(timer); }
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
  const api = async (endpoint: string, cookie = '', method = 'GET', body?: unknown) => {
    const response = await fetch(`${url}/api${endpoint}`, { method,
      headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: url }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() as any };
  };
  let ready = false;
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(`API exited: ${output}`);
    try { ready = (await api('/auth/me')).status === 200; } catch { /* Starting server. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(ready, `API failed to start: ${output}`);
  db = new DatabaseSync(path.join(dir, 'app.db'));
  const password = 'TimetableTestPassword2026';
  const hash = await bcrypt.hash(password, 4);
  const createUser = (number: number, role = 'user') => {
    const id = Number(db!.prepare('INSERT INTO users (email, activated, password_hash, role) VALUES (?, 1, ?, ?)').run(`${number}@mail.sustech.edu.cn`, hash, role).lastInsertRowid);
    const token = crypto.randomBytes(32).toString('base64url');
    db!.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3600_000).toISOString());
    return { id, cookie: `dz_sid=${token}` };
  };
  const owner = createUser(12619991);
  const viewer = createUser(12619992);
  const admin = createUser(12619993, 'admin');
  const course = COURSE_OPTIONS[0];
  const data = { semester: '测试学期', firstWeekDate: '2026-09-07', lessons: [{ id: 'test-one', courseName: course.name, course: course.label,
    day: 1, startPeriod: 5, endPeriod: 6, weeks: [1, 2, 4], location: '测试教室' }] };
  assert.equal((await api('/timetables/me')).status, 401);
  assert.equal((await api('/timetables/me', '', 'PUT', data)).status, 401);
  assert.equal((await api('/timetables/me', owner.cookie)).body.timetable, null);
  const saved = await api('/timetables/me', owner.cookie, 'PUT', data);
  assert.equal(saved.status, 200);
  assert.match(saved.cache!, /no-store/);
  assert.deepEqual(saved.body.timetable.lessons, data.lessons);
  assert.equal((await api('/timetables/me', viewer.cookie)).body.timetable, null);
  assert.equal((await api('/timetables/me', admin.cookie)).body.timetable, null);
  assert.equal((await api(`/timetables/${owner.id}`, viewer.cookie)).status, 404);
  assert.equal((await api(`/timetables/${owner.id}`, admin.cookie)).status, 404);
  assert.equal((await api('/timetables/me', viewer.cookie, 'PUT', { ...data, userId: owner.id })).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM uploads').get()!.n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profiles').get()!.n, 0);

  for (const invalid of [
    { ...data, semester: '' }, { ...data, firstWeekDate: '2026-02-30' }, { ...data, firstWeekDate: '2026-09-08' },
    { ...data, rawFile: 'unexpected source data' },
    ...[{ weeks: [] }, { weeks: [0] }, { weeks: [31] }, { day: 8 }, { day: '1' }, { startPeriod: 0 }, { endPeriod: 12 },
      { startPeriod: 7, endPeriod: 6 }, { course: 'UNKNOWN INVALID COURSE' }, { teacher: 'not stored' }, { location: 'a'.repeat(201) }]
      .map((patch) => ({ ...data, lessons: [{ ...data.lessons[0], ...patch }] })),
    { ...data, lessons: Array.from({ length: 201 }, (_, index) => ({ ...data.lessons[0], id: `item-${index}` })) },
  ]) {
    assert.equal((await api('/timetables/me', owner.cookie, 'PUT', invalid)).status, 400);
    assert.deepEqual((await api('/timetables/me', owner.cookie)).body.timetable.lessons, data.lessons, 'invalid import must preserve saved timetable');
  }
  const unknown = { ...data, firstWeekDate: '', lessons: [{ ...data.lessons[0], courseName: '尚未编目的课程', course: '' }] };
  assert.equal((await api('/timetables/me', viewer.cookie, 'PUT', unknown)).status, 200);
  assert.equal((await api('/timetables/me', viewer.cookie)).body.timetable.lessons[0].courseName, '尚未编目的课程');
  assert.deepEqual((await api('/timetables/me', owner.cookie)).body.timetable.lessons, data.lessons);
  assert.equal((await api('/auth/account', owner.cookie, 'DELETE', { password })).status, 200);
  assert.equal(db.prepare('SELECT user_id FROM private_timetables WHERE user_id = ?').get(owner.id), undefined);
  assert.ok(db.prepare('SELECT user_id FROM private_timetables WHERE user_id = ?').get(viewer.id));
});
