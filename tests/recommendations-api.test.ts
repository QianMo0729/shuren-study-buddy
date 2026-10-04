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
import type { ProfileInput, RecommendationResponse } from '../shared/types.ts';

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-recommendations-'));
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    // Override every delivery credential, including values that the private .env could otherwise load.
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dir,
      APP_URL: url, ADMIN_EMAILS: '', DEV_SHOW_CODES: 'false', RESEND_API_KEY: '',
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let startupError: Error | undefined;
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  child.on('error', (error) => { startupError = error; });
  const api = async (endpoint: string, cookie = '', method = 'GET', body?: unknown) => {
    const response = await fetch(`${url}/api${endpoint}`, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: url }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.json() as any };
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
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw new Error(`API exited: ${output}`);
      try { ready = (await api('/auth/me')).status === 200; } catch { /* Allow the child to start. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, `API did not start: ${output}`);
    return { api, db: new DatabaseSync(path.join(dir, 'app.db')), stop };
  } catch (error) { await stop(); throw error; }
}

test('recommendations respect onboarding, reciprocal availability and current privacy permissions', { timeout: 60_000 }, async (t) => {
  const app = await startServer();
  const { api, db } = app;
  t.after(async () => { db.close(); await app.stop(); });
  const passwordHash = await bcrypt.hash('RecommendationFixture2026', 4);
  let studentNumber = 12617000;
  function createUser(patch: Partial<ProfileInput> = {}, options: { profile?: boolean; published?: boolean; saved?: boolean } = {}) {
    const studentId = String(++studentNumber);
    const email = `${studentId}@mail.sustech.edu.cn`;
    const id = Number(db.prepare('INSERT INTO users (email, activated, password_hash) VALUES (?, 1, ?)').run(email, passwordHash).lastInsertRowid);
    const data: ProfileInput = {
      ...emptyProfile(), realName: `SECRET-NAME-${id}`, studentId,
      planTags: ['期末复习备考'], places: ['library'], schedule: [0, 1, 2], studyType: 'quiet',
      privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true },
      contacts: { showEmail: true, wechat: `SECRET-WECHAT-${id}`, qq: '90000123', phone: '18800001234', other: 'SECRET-CONTACT' },
      ...patch,
    };
    if (options.profile !== false) {
      db.prepare('INSERT INTO profiles (user_id, nickname, data, published, saved_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, `推荐测试同学${id}`, JSON.stringify(data), options.published === false ? 0 : 1,
          options.saved === false ? null : new Date().toISOString());
    }
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    return { id, email, cookie: `dz_sid=${token}`, data };
  }
  type Member = ReturnType<typeof createUser>;
  const reset = () => db.exec('DELETE FROM users');
  const storeProfile = (member: Member, patch: Partial<ProfileInput> = {}) => {
    db.prepare('UPDATE profiles SET data = ? WHERE user_id = ?').run(JSON.stringify({ ...member.data, ...patch }), member.id);
  };
  const recommend = async (member: Member): Promise<RecommendationResponse> => {
    const response = await api('/profiles/recommendations', member.cookie);
    assert.equal(response.status, 200);
    assert.match(response.cacheControl!, /no-store/);
    return response.body;
  };

  await t.test('requires a session and exposes incomplete, unpublished and unavailable states without recommendations', async () => {
    reset();
    assert.equal((await api('/profiles/recommendations')).status, 401);
    const viewer = createUser({}, { profile: false });
    const incomplete = await recommend(viewer);
    assert.equal(incomplete.state, 'incomplete');
    assert.deepEqual(incomplete.items, []);
    assert.equal(incomplete.eligibleCount, 0);
    assert.ok(incomplete.missing.some((item) => item.key === 'planTags'));
    assert.equal((await api('/auth/me', viewer.cookie)).body.user.questionnaireComplete, false);

    const unsaved = createUser({}, { published: true, saved: false });
    const unsavedResult = await recommend(unsaved);
    assert.equal(unsavedResult.state, 'incomplete');
    assert.deepEqual(unsavedResult.missing, []);
    assert.deepEqual(unsavedResult.items, []);
    assert.equal((await api('/auth/me', unsaved.cookie)).body.user.questionnaireComplete, false);

    const saved = await api('/profiles/me', viewer.cookie, 'PUT', { profile: viewer.data });
    assert.equal(saved.status, 200);
    assert.equal((await api('/auth/me', viewer.cookie)).body.user.questionnaireComplete, true);
    assert.equal((await recommend(viewer)).state, 'unpublished');
    assert.equal((await api('/profiles/me/publish', viewer.cookie, 'POST', {})).status, 200);
    assert.equal((await recommend(viewer)).state, 'empty');

    storeProfile(viewer, { status: 'busy' });
    assert.equal((await recommend(viewer)).state, 'unavailable');
    storeProfile(viewer);
    db.prepare('UPDATE profiles SET taken_down = 1 WHERE user_id = ?').run(viewer.id);
    assert.equal((await recommend(viewer)).state, 'unavailable');
    db.prepare('UPDATE profiles SET taken_down = 0 WHERE user_id = ?').run(viewer.id);
    const withdrawn = await api('/profiles/me', viewer.cookie, 'PUT', { profile: {
      ...viewer.data, privacyConsent: { ...viewer.data.privacyConsent, policy: false },
    } });
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.body.profile.published, false);
    assert.equal((await api('/auth/me', viewer.cookie)).body.user.questionnaireComplete, false);
    assert.equal((await recommend(viewer)).state, 'incomplete');
  });

  await t.test('only complete, published, active password accounts with every consent enter the candidate pool', async () => {
    reset();
    const viewer = createUser();
    const candidate = createUser();
    assert.deepEqual((await recommend(viewer)).items.map((item) => item.id), [candidate.id]);
    for (const savedAt of [null, '']) {
      db.prepare('UPDATE profiles SET saved_at = ? WHERE user_id = ?').run(savedAt, candidate.id);
      const unsavedResult = await recommend(viewer);
      assert.equal(unsavedResult.state, 'empty');
      assert.equal(unsavedResult.eligibleCount, 0);
      assert.deepEqual(unsavedResult.items, []);
    }
    db.prepare('UPDATE profiles SET saved_at = ? WHERE user_id = ?').run(new Date().toISOString(), candidate.id);
    for (const [column, value, restored] of [['published', 0, 1], ['taken_down', 1, 0]] as const) {
      db.prepare(`UPDATE profiles SET ${column} = ? WHERE user_id = ?`).run(value, candidate.id);
      assert.equal((await recommend(viewer)).eligibleCount, 0, column);
      db.prepare(`UPDATE profiles SET ${column} = ? WHERE user_id = ?`).run(restored, candidate.id);
    }
    db.prepare('UPDATE users SET activated = 0 WHERE id = ?').run(candidate.id);
    assert.equal((await recommend(viewer)).eligibleCount, 0);
    db.prepare('UPDATE users SET activated = 1, password_hash = NULL WHERE id = ?').run(candidate.id);
    assert.equal((await recommend(viewer)).eligibleCount, 0);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, candidate.id);
    for (const patch of [{ realName: '' }, { planTags: [] }, { places: [] }, { schedule: [] }, { studyType: '' }, { status: 'busy' }]) {
      storeProfile(candidate, patch);
      const result = await recommend(viewer);
      assert.equal(result.state, 'empty', JSON.stringify(patch));
      assert.equal(result.eligibleCount, 0);
    }
    for (const key of Object.keys(candidate.data.privacyConsent)) {
      storeProfile(candidate, { privacyConsent: { ...candidate.data.privacyConsent, [key]: false } });
      assert.equal((await recommend(viewer)).eligibleCount, 0, key);
    }
    storeProfile(candidate, { status: 'open' });
    assert.equal((await recommend(viewer)).items[0]?.id, candidate.id);
  });

  await t.test('exclusions and rejected contact requests are enforced in either direction', async () => {
    reset();
    const viewer = createUser();
    const candidate = createUser();
    for (const [from, to] of [[viewer.id, candidate.id], [candidate.id, viewer.id]]) {
      db.prepare('INSERT INTO exclusions (user_id, target_id) VALUES (?, ?)').run(from, to);
      assert.equal((await recommend(viewer)).eligibleCount, 0);
      db.exec('DELETE FROM exclusions');
      db.prepare("INSERT INTO contact_requests (requester_id, recipient_id, status) VALUES (?, ?, 'rejected')").run(from, to);
      assert.equal((await recommend(viewer)).eligibleCount, 0);
      db.prepare("UPDATE contact_requests SET status = 'pending'").run();
      assert.equal((await recommend(viewer)).items[0]?.id, candidate.id);
      db.prepare("UPDATE contact_requests SET status = 'accepted'").run();
      assert.equal((await recommend(viewer)).items[0]?.id, candidate.id);
      db.exec('DELETE FROM contact_requests');
    }
  });

  await t.test('recommendation cards preserve private photos and never serialize identity or contact fields', async () => {
    reset();
    const viewer = createUser();
    const privatePhoto = '0123456789abcdef01234567.png';
    const candidate = createUser({ photos: [privatePhoto], timetable: 'abcdef0123456789abcdef01.png', mbti: 'SECRET-MBTI' });
    const privateResult = await recommend(viewer);
    assert.equal(privateResult.state, 'ready');
    assert.equal(privateResult.items[0].id, candidate.id);
    assert.equal(privateResult.items[0].cover, null);
    assert.equal(privateResult.items[0].isMe, false);
    const serialized = JSON.stringify(privateResult);
    for (const secret of [privatePhoto, candidate.email, candidate.data.realName, candidate.data.studentId,
      candidate.data.contacts.wechat, candidate.data.contacts.qq, candidate.data.contacts.phone, candidate.data.contacts.other, 'SECRET-MBTI']) {
      assert.equal(serialized.includes(secret), false, `private value must not be serialized: ${secret}`);
    }
    function checkKeys(value: unknown) {
      if (Array.isArray(value)) { value.forEach(checkKeys); return; }
      if (!value || typeof value !== 'object') return;
      for (const [key, nested] of Object.entries(value)) {
        assert.ok(!['realName', 'studentId', 'email', 'contacts', 'wechat', 'qq', 'phone', 'password_hash', 'photos', 'timetable'].includes(key), `unexpected private response key ${key}`);
        checkKeys(nested);
      }
    }
    checkKeys(privateResult);
    storeProfile(candidate, { photos: [privatePhoto], photoVisibility: 'public' });
    assert.equal((await recommend(viewer)).items[0].cover, privatePhoto);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM contact_requests').get()!.n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get()!.n, 0);
  });

  await t.test('both users effective time must overlap; no-overlap remains distinct from an empty candidate pool', async () => {
    reset();
    const viewer = createUser({ schedule: [0, 1], expectedSchedule: [0] });
    const candidate = createUser({ schedule: [0, 1], expectedSchedule: [1] });
    const disjoint = await recommend(viewer);
    assert.equal(disjoint.state, 'no_overlap');
    assert.equal(disjoint.eligibleCount, 1);
    assert.equal(disjoint.total, 0);
    assert.deepEqual(disjoint.items, []);
    storeProfile(candidate, { schedule: [0, 1], expectedSchedule: [0] });
    const common = await recommend(viewer);
    assert.equal(common.state, 'ready');
    assert.deepEqual(common.items[0].recommendation!.commonSlots, [0]);
    assert.equal(common.items[0].recommendation!.overlapHours, 2);
    assert.equal(common.items[0].overlapHours, 2);
    storeProfile(viewer, { schedule: [0, 1], expectedSchedule: [2] });
    assert.equal((await recommend(viewer)).state, 'no_overlap');
  });

  await t.test('ties are deterministic, results are bounded, and profile changes recompute scores immediately', async () => {
    reset();
    const viewer = createUser();
    const candidates = Array.from({ length: 23 }, () => createUser());
    const first = await recommend(viewer);
    const second = await recommend(viewer);
    assert.equal(first.total, 23);
    assert.equal(first.eligibleCount, 23);
    assert.equal(first.items.length, 20);
    assert.deepEqual(first.items.map((item) => item.id), candidates.slice(0, 20).map((item) => item.id));
    assert.deepEqual(first, second);
    for (const item of first.items) {
      const info = item.recommendation!;
      assert.equal(info.version, 'rules-v1');
      assert.ok(Number.isFinite(info.score) && info.score >= 0 && info.score <= 100);
      assert.ok(Number.isFinite(info.coverage) && info.coverage >= 0 && info.coverage <= 100);
      assert.equal(info.dimensions.length, 7);
    }
    const changed = await api('/profiles/me', candidates[0].cookie, 'PUT', { profile: {
      ...candidates[0].data, planTags: ['考研'], studyType: 'discuss', places: ['dorm'],
    } });
    assert.equal(changed.status, 200);
    const updated = await recommend(viewer);
    assert.equal(updated.items[0].id, candidates[1].id);
    assert.ok(!updated.items.some((item) => item.id === candidates[0].id));

    // A complete draft update changes the current user's comparison without needing a new login.
    const saved = await api('/profiles/me', viewer.cookie, 'PUT', { profile: {
      ...viewer.data, planTags: ['考研'], studyType: 'discuss', places: ['dorm'],
    } });
    assert.equal(saved.status, 200);
    const recomputed = await recommend(viewer);
    assert.equal(recomputed.items[0].id, candidates[0].id);
    assert.equal((await api('/auth/me', viewer.cookie)).body.user.questionnaireComplete, true);
  });
});
