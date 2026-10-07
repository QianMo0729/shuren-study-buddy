import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import bcrypt from 'bcryptjs';

const root = path.resolve(import.meta.dirname, '..');
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
// Verification codes are stored as HMACs keyed by a server secret that never enters the database.
const CODE_PEPPER = 'test-only-code-pepper';
const codeHash = (email: string, purpose: string, code: string) =>
  crypto.createHmac('sha256', CODE_PEPPER).update(`${email}:${purpose}:${code}`).digest('hex');
const password = 'StudyBuddy2026!';
const nextPassword = 'AnotherPassword2026!';
const emailOf = (studentId: string) => `${studentId}@mail.sustech.edu.cn`;

async function startServer(production = false, resendStatus?: number) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-auth-'));
  const mailLog = path.join(dir, 'mail.jsonl');
  const mailMock = path.join(dir, 'mail-mock.mjs');
  if (resendStatus !== undefined) {
    // Replace every child-process fetch: these provider tests can never contact a real server.
    await fs.writeFile(mailMock, `import fs from 'node:fs';
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://api.resend.com/emails') throw new Error('Unexpected network request blocked by test');
  fs.appendFileSync(${JSON.stringify(mailLog)}, JSON.stringify({ url, ...options, signal: undefined }) + '\\n');
  return new Response(JSON.stringify({ id: 'mock-delivery' }), { status: ${resendStatus} });
};\n`);
  }
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  const url = `http://127.0.0.1:${port}`;
  // Explicit empty values prevent the project's private .env from enabling real email delivery.
  const child = spawn(process.execPath, [...(resendStatus === undefined ? [] : ['--import', mailMock]), '--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: {
      ...process.env, NODE_ENV: production ? 'production' : 'test', HOST: '127.0.0.1', PORT: String(port),
      DATA_DIR: dir, APP_URL: url, ADMIN_EMAILS: '', DEV_SHOW_CODES: 'true', CODE_PEPPER,
      RESEND_API_KEY: resendStatus === undefined ? '' : 're_fake_test_key', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
      MAIL_FROM: resendStatus === undefined ? '' : 'noreply@example.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk) => { output += String(chunk); });
  child.stderr?.on('data', (chunk) => { output += String(chunk); });
  let startupError: Error | undefined;
  child.on('error', (error) => { startupError = error; });
  // `headers` replaces the default same-origin Origin, so a test can act as a script or a proxied remote client.
  const api = async (endpoint: string, body?: unknown, cookie?: string, headers?: Record<string, string>) => {
    const response = await fetch(`${url}/api${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', ...(headers ?? { Origin: url }) }), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, body: await response.json() as any, cookie: response.headers.getSetCookie().at(-1) ?? null };
  };
  const stop = async () => {
    await stopChild(child);
    await fs.rm(dir, { recursive: true, force: true });
  };
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw new Error(`Test API exited: ${output}`);
      try { ready = (await api('/auth/me')).status === 200; } catch { /* Startup may still be binding. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, `Test API did not start: ${output}`);
    return { api, dir, mailLog, stop, url, db: new DatabaseSync(path.join(dir, 'app.db')) };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'exit');
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 2_000);
  try { await done; } finally { clearTimeout(force); }
}

test('account activation, password login and recovery use isolated one-use credentials', { timeout: 60_000 }, async (t) => {
  const app = await startServer();
  t.after(async () => { app.db.close(); await app.stop(); });
  const { api, db } = app;
  const studentId = '12619901';
  const email = emailOf(studentId);
  let activationCode: string;
  let userId: number;
  let firstSession: string;

  await t.test('rejects malformed identities and retires passwordless login routes', async () => {
    assert.equal((await api('/auth/request-activation-code', { studentId: 'invalid' })).status, 400);
    assert.equal((await api('/auth/login', { email: 'person@example.com', password })).status, 400);
    assert.equal((await api('/auth/request-login-code', { studentId })).status, 410);
    assert.equal((await api('/auth/verify-login-code', { studentId, code: '000000' })).status, 410);
  });

  await t.test('verification never logs in until a valid password is set; code and setup token are one-use', async () => {
    const requested = await api('/auth/request-activation-code', { studentId });
    assert.equal(requested.status, 200);
    activationCode = requested.body.devCode;
    assert.match(activationCode, /^\d{6}$/);
    assert.equal(requested.body.email, email);
    assert.equal((await api('/auth/request-activation-code', { studentId })).status, 429);
    assert.equal(db.prepare('SELECT id FROM users WHERE email = ?').get(email), undefined);
    const wrong = activationCode === '000000' ? '000001' : '000000';
    assert.equal((await api('/auth/verify-activation-code', { studentId, code: wrong })).status, 400);
    assert.equal(db.prepare("SELECT attempts FROM email_codes WHERE email = ? AND purpose = 'activation'").get(email)?.attempts, 1);
    const verified = await api('/auth/verify-activation-code', { studentId, code: activationCode });
    assert.equal(verified.status, 200);
    assert.equal(verified.cookie, null);
    const setupToken = verified.body.setupToken;
    assert.equal(typeof setupToken, 'string');
    assert.equal((await api('/profiles/me')).status, 401);
    assert.equal((await api('/auth/verify-activation-code', { studentId, code: activationCode })).status, 400);
    assert.equal((await api('/auth/activate', { setupToken, password: 'short' })).status, 400);
    const [activated, replay] = await Promise.all([
      api('/auth/activate', { setupToken, password }), api('/auth/activate', { setupToken, password }),
    ]);
    const success = activated.status === 200 ? activated : replay;
    const failure = activated.status === 200 ? replay : activated;
    assert.equal(success.status, 200);
    assert.ok([400, 409].includes(failure.status));
    userId = success.body.user.id;
    assert.equal(success.body.user.email, email);
    assert.equal(success.body.user.questionnaireComplete, false);
    assert.equal(success.body.user.password_hash, undefined);
    assert.match(success.cookie!, /HttpOnly/i);
    assert.match(success.cookie!, /SameSite=Lax/i);
    firstSession = success.cookie!.split(';')[0];
    const row = db.prepare('SELECT activated, password_hash FROM users WHERE id = ?').get(userId)!;
    assert.equal(row.activated, 1);
    assert.notEqual(row.password_hash, password);
    assert.ok(await bcrypt.compare(password, String(row.password_hash)));
    assert.equal((await api('/auth/me', undefined, firstSession)).body.user.id, userId);
    // An activated account answers exactly like any other student ID; only the mailbox owner learns the state.
    db.prepare("UPDATE email_codes SET created_at = datetime('now', '-2 minutes') WHERE email = ?").run(email);
    const again = await api('/auth/request-activation-code', { studentId });
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, { ok: true, email });
    const decoy = db.prepare("SELECT used, attempts FROM email_codes WHERE email = ? AND purpose = 'activation' ORDER BY id DESC LIMIT 1").get(email)!;
    assert.equal(decoy.used, 0, 'the placeholder behaves like a live code that no guess can match');
    assert.equal((await api('/auth/request-activation-code', { studentId })).status, 429, 'the same resend cooldown applies');
    const guess = await api('/auth/verify-activation-code', { studentId, code: '123456' });
    assert.equal(guess.status, 400);
    assert.equal(guess.body.error, '验证码不正确');
    assert.equal(db.prepare("SELECT attempts FROM email_codes WHERE email = ? AND purpose = 'activation' ORDER BY id DESC LIMIT 1").get(email)?.attempts, 1);
  });

  await t.test('codes are stored as keyed verifiers that a database copy alone cannot brute-force', async () => {
    const studentId = '12619910';
    const requested = await api('/auth/request-activation-code', { studentId });
    const code = requested.body.devCode as string;
    const stored = String(db.prepare("SELECT code_hash FROM email_codes WHERE email = ? AND purpose = 'activation'").get(emailOf(studentId))!.code_hash);
    assert.notEqual(stored, hash(`${emailOf(studentId)}:activation:${code}`), 'no unkeyed hash of the code is stored');
    assert.equal(stored, codeHash(emailOf(studentId), 'activation', code));
    // Every value an attacker could derive from the database alone fails to reproduce the verifier.
    for (const candidate of [code, `${emailOf(studentId)}:${code}`, `${emailOf(studentId)}:activation:${code}`, `activation:${code}`]) {
      assert.notEqual(stored, hash(candidate));
    }
  });

  await t.test('code echo is limited to a browser on this machine: no echo for scripts or clients behind the dev proxy', async () => {
    // A script that omits browser headers gets no code, even from loopback.
    const script = await api('/auth/request-activation-code', { studentId: '12619911' }, undefined, {});
    assert.equal(script.status, 200);
    assert.equal(script.body.devCode, undefined);
    // The dev proxy forwards the real client address; a LAN client is not the local developer.
    const proxied = await api('/auth/request-activation-code', { studentId: '12619912' }, undefined, { Origin: app.url, 'X-Forwarded-For': '192.168.1.23' });
    assert.equal(proxied.status, 200);
    assert.equal(proxied.body.devCode, undefined);
    // A forged loopback hop in front of the real address does not help.
    const forged = await api('/auth/request-activation-code', { studentId: '12619913' }, undefined, { Origin: app.url, 'X-Forwarded-For': '127.0.0.1, 192.168.1.24' });
    assert.equal(forged.body.devCode, undefined);
    const reset = await api('/auth/request-reset-code', { email }, undefined, { Origin: app.url, 'X-Forwarded-For': '192.168.1.25' });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.devCode, undefined);
    db.prepare("UPDATE email_codes SET created_at = datetime('now', '-2 minutes') WHERE email = ? AND purpose = 'password_reset'").run(email);
    assert.equal((await fetch(`${app.url}/api/meta`, { headers: { 'X-Forwarded-For': '192.168.1.26' } }).then((r) => r.json()) as any).devMode, false);
    assert.equal((await api('/meta')).body.devMode, true);
    // The developer's own browser still sees it.
    const local = await api('/auth/request-activation-code', { studentId: '12619914' });
    assert.match(local.body.devCode, /^\d{6}$/);
  });

  await t.test('password login accepts the email; logout invalidates its own session', async () => {
    assert.equal((await api('/auth/login', { email, password: 'WrongPassword1' })).status, 401);
    const login = await api('/auth/login', { email, password });
    assert.equal(login.status, 200);
    const cookie = login.cookie!.split(';')[0];
    assert.equal((await api('/auth/me', undefined, cookie)).body.user.id, userId);
    assert.equal((await api('/auth/logout', {}, cookie)).status, 200);
    assert.equal((await api('/auth/me', undefined, cookie)).body.user, null);
    assert.equal((await api('/auth/me', undefined, firstSession)).body.user.id, userId);
  });

  await t.test('reset codes are purpose-bound and revoke every session after changing the password', async () => {
    const login = await api('/auth/login', { email, password });
    const secondSession = login.cookie!.split(';')[0];
    const requested = await api('/auth/request-reset-code', { email });
    assert.equal(requested.status, 200);
    const code = requested.body.devCode as string;
    assert.match(code, /^\d{6}$/);
    assert.equal((await api('/auth/request-reset-code', { email })).status, 429);
    const activationOnly = code === '123456' ? '654321' : '123456';
    db.prepare('INSERT INTO email_codes (email, purpose, code_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(email, 'activation', codeHash(email, 'activation', activationOnly), new Date(Date.now() + 600_000).toISOString());
    assert.equal((await api('/auth/reset-password', { email, code: activationOnly, password: nextPassword })).status, 400);
    assert.equal(db.prepare("SELECT attempts FROM email_codes WHERE email = ? AND purpose = 'password_reset' ORDER BY id DESC LIMIT 1").get(email)?.attempts, 1);
    assert.equal((await api('/auth/reset-password', { email, code, password: 'short' })).status, 400);
    const reset = await api('/auth/reset-password', { email, code, password: nextPassword });
    assert.equal(reset.status, 200);
    assert.ok(!reset.body.user);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(userId)?.count, 0);
    assert.equal((await api('/auth/me', undefined, firstSession)).body.user, null);
    assert.equal((await api('/auth/me', undefined, secondSession)).body.user, null);
    assert.equal((await api('/auth/reset-password', { email, code, password })).status, 400);
    assert.equal((await api('/auth/login', { email, password })).status, 401);
    assert.equal((await api('/auth/login', { email, password: nextPassword })).status, 200);
    const unknown = await api('/auth/request-reset-code', { email: emailOf('12619999') });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.ok, true);
    assert.equal(unknown.body.devCode, undefined);
    // An address without an account is indistinguishable afterwards too: same cooldown, same wrong-code answer.
    assert.equal((await api('/auth/request-reset-code', { email: emailOf('12619999') })).status, 429);
    const guess = await api('/auth/reset-password', { email: emailOf('12619999'), code: '123456', password: nextPassword });
    assert.equal(guess.status, 400);
    assert.equal(guess.body.error, '验证码不正确');
    assert.equal(db.prepare('SELECT id FROM users WHERE email = ?').get(emailOf('12619999')), undefined);
  });

  await t.test('legacy accounts must set a password and retain their identity and profile', async () => {
    const legacyId = '12619902';
    const legacyEmail = emailOf(legacyId);
    const oldId = Number(db.prepare('INSERT INTO users (email, activated) VALUES (?, 1)').run(legacyEmail).lastInsertRowid);
    db.prepare("INSERT INTO profiles (user_id, nickname, data) VALUES (?, '保留的旧资料', '{}')").run(oldId);
    const legacyToken = 'legacy-passwordless-session';
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hash(legacyToken), oldId, new Date(Date.now() + 600_000).toISOString());
    assert.equal((await api('/auth/me', undefined, `dz_sid=${legacyToken}`)).body.user, null);
    const requested = await api('/auth/request-activation-code', { studentId: legacyId });
    assert.equal(requested.status, 200);
    const verified = await api('/auth/verify-activation-code', { studentId: legacyId, code: requested.body.devCode });
    assert.equal(verified.status, 200);
    const activated = await api('/auth/activate', { setupToken: verified.body.setupToken, password });
    assert.equal(activated.status, 200);
    assert.equal(activated.body.user.id, oldId);
    assert.equal(activated.body.user.nickname, '保留的旧资料');
    assert.equal(db.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').get(hash(legacyToken)), undefined);
  });

  await t.test('five wrong attempts stay recorded and lock the code even if the next guess is correct', async () => {
    const studentId = '12619903';
    const requested = await api('/auth/request-activation-code', { studentId });
    const code = requested.body.devCode as string;
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) {
      assert.equal((await api('/auth/verify-activation-code', { studentId, code: wrong })).status, 400);
    }
    assert.equal(db.prepare("SELECT attempts FROM email_codes WHERE email = ? AND purpose = 'activation'").get(emailOf(studentId))?.attempts, 5);
    assert.equal((await api('/auth/verify-activation-code', { studentId, code })).status, 400);
  });

  await t.test('expired activation codes and setup tokens cannot activate an account', async () => {
    const studentId = '12619904';
    const email = emailOf(studentId);
    const requested = await api('/auth/request-activation-code', { studentId });
    db.prepare("UPDATE email_codes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = ?").run(email);
    assert.equal((await api('/auth/verify-activation-code', { studentId, code: requested.body.devCode })).status, 400);
    db.prepare('UPDATE email_codes SET expires_at = ? WHERE email = ?').run(new Date(Date.now() + 600_000).toISOString(), email);
    const verified = await api('/auth/verify-activation-code', { studentId, code: requested.body.devCode });
    assert.equal(verified.status, 200);
    db.prepare("UPDATE email_codes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = ? AND purpose = 'activation_setup'").run(email);
    assert.equal((await api('/auth/activate', { setupToken: verified.body.setupToken, password })).status, 400);
    assert.equal(db.prepare('SELECT id FROM users WHERE email = ?').get(email), undefined);
  });
});

test('production without configured delivery never generates or reveals activation codes', { timeout: 30_000 }, async (t) => {
  const app = await startServer(true);
  t.after(async () => { app.db.close(); await app.stop(); });
  const result = await app.api('/auth/request-activation-code', { studentId: '12619905' });
  assert.equal(result.status, 503);
  assert.equal(result.body.devCode, undefined);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM email_codes').get()?.count, 0);
});

test('Resend delivers the activation template without exposing the production verification code', { timeout: 30_000 }, async (t) => {
  const app = await startServer(true, 200);
  t.after(async () => { app.db.close(); await app.stop(); });
  const studentId = '12619906';
  const requested = await app.api('/auth/request-activation-code', { studentId });
  assert.equal(requested.status, 200);
  assert.equal(requested.body.devCode, undefined);
  const deliveries = (await fs.readFile(app.mailLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(deliveries.length, 1);
  const request = deliveries[0];
  assert.equal(request.method, 'POST');
  assert.ok(request.headers['Idempotency-Key']);
  const payload = JSON.parse(request.body);
  assert.deepEqual(payload.to, [emailOf(studentId)]);
  assert.match(payload.from, /noreply@example\.test/);
  assert.match(payload.subject, /激活/);
  assert.match(payload.html, /验证码/);
  const code = payload.text.match(/验证码：(\d{6})/)[1];
  assert.equal((await app.api('/auth/verify-activation-code', { studentId, code })).status, 200);
});

test('failed Resend delivery invalidates the generated code and does not create a cooldown', { timeout: 30_000 }, async (t) => {
  const app = await startServer(true, 422);
  t.after(async () => { app.db.close(); await app.stop(); });
  const studentId = '12619907';
  for (let i = 0; i < 2; i++) {
    const requested = await app.api('/auth/request-activation-code', { studentId });
    assert.equal(requested.status, 502);
    assert.equal(requested.body.devCode, undefined);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM email_codes').get()?.count, 0);
  }
  const deliveries = (await fs.readFile(app.mailLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(deliveries.length, 2);
  const code = JSON.parse(deliveries[0].body).text.match(/验证码：(\d{6})/)[1];
  assert.equal((await app.api('/auth/verify-activation-code', { studentId, code })).status, 400);
});

test('activation and recovery answer identically whether or not the account exists', { timeout: 60_000 }, async (t) => {
  const app = await startServer(true, 200);
  t.after(async () => { app.db.close(); await app.stop(); });
  const { api, db } = app;
  const [activeId, freshId] = ['12619920', '12619921'];
  db.prepare('INSERT INTO users (email, activated, password_hash) VALUES (?, 1, ?)').run(emailOf(activeId), await bcrypt.hash(password, 4));
  const mails = async () => (await fs.readFile(app.mailLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(JSON.parse(line).body));
  const same = (a: { status: number; body: any }, b: { status: number; body: any }, label: string) => {
    assert.equal(a.status, b.status, label);
    assert.deepEqual(Object.keys(a.body).sort(), Object.keys(b.body).sort(), label);
    assert.equal(a.body.error, b.body.error, label);
  };

  // Activation: an activated account and a fresh student ID.
  const [activeCode, freshCode] = [await api('/auth/request-activation-code', { studentId: activeId }), await api('/auth/request-activation-code', { studentId: freshId })];
  same(activeCode, freshCode, 'request-activation-code');
  assert.equal(activeCode.status, 200);
  same(await api('/auth/request-activation-code', { studentId: activeId }), await api('/auth/request-activation-code', { studentId: freshId }), 'activation resend cooldown');
  same(await api('/auth/verify-activation-code', { studentId: activeId, code: '000000' }), await api('/auth/verify-activation-code', { studentId: freshId, code: '000000' }), 'verify-activation-code');

  // Recovery: an activated account and an address without one.
  const [knownReset, unknownReset] = [await api('/auth/request-reset-code', { email: emailOf(activeId) }), await api('/auth/request-reset-code', { email: emailOf(freshId) })];
  same(knownReset, unknownReset, 'request-reset-code');
  assert.equal(knownReset.status, 200);
  same(await api('/auth/request-reset-code', { email: emailOf(activeId) }), await api('/auth/request-reset-code', { email: emailOf(freshId) }), 'reset resend cooldown');
  same(await api('/auth/reset-password', { email: emailOf(activeId), code: '000000', password: nextPassword }),
    await api('/auth/reset-password', { email: emailOf(freshId), code: '000000', password: nextPassword }), 'reset-password');

  // Each request sent exactly one mail; only the owner of the mailbox learns the account state, and no code leaks into a notice.
  const sent = await mails();
  assert.equal(sent.length, 4);
  const to = (address: string, subject: RegExp) => sent.find((mail) => mail.to[0] === address && subject.test(mail.subject));
  assert.match(to(emailOf(freshId), /激活/)!.text, /验证码：\d{6}/);
  assert.match(to(emailOf(activeId), /重置|重设/)!.text, /验证码：\d{6}/);
  for (const notice of [to(emailOf(activeId), /已经激活/)!, to(emailOf(freshId), /还没有激活/)!]) {
    assert.doesNotMatch(notice.text, /\d{6}/);
    assert.doesNotMatch(notice.html, /\d{6}/);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n, 1, 'no account is created by any of these requests');
});

test('one source cannot mint unlimited rate-limit keys by rotating student IDs', { timeout: 60_000 }, async (t) => {
  const app = await startServer();
  t.after(async () => { app.db.close(); await app.stop(); });
  const verify = (n: number, source: string) =>
    app.api('/auth/verify-activation-code', { studentId: String(12700000 + n), code: '000000' }, undefined, { Origin: app.url, 'X-Forwarded-For': source });
  // 60 different student IDs from one address are answered; the 61st hits the per-source budget before any new key is created.
  for (let i = 0; i < 60; i++) assert.equal((await verify(i, '198.51.100.7')).status, 400);
  assert.equal((await verify(60, '198.51.100.7')).status, 429);
  assert.equal((await verify(61, '198.51.100.8')).status, 400, 'another source has its own budget');
  // Rotating addresses inside one IPv6 /64 does not create new budgets either.
  for (let i = 0; i < 60; i++) assert.equal((await verify(100 + i, `2001:db8:5:6::${(i + 1).toString(16)}`)).status, 400);
  assert.equal((await verify(160, '2001:db8:5:6:ffff::1')).status, 429);
  assert.equal((await verify(161, '2001:db8:5:7::1')).status, 400);
});
