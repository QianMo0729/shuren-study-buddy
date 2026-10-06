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
import { goalDateToIso } from '../shared/goalDate.ts';
import { COURSE_OPTIONS } from '../shared/courseCatalog.ts';
import type { ProfileInput, QuestionnaireSection } from '../shared/types.ts';

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-profile-drafts-'));
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

test('questionnaire drafts preserve unpublished answers without changing live profiles', { timeout: 60_000 }, async (t) => {
  const app = await startServer();
  const { api, db } = app;
  t.after(async () => { db.close(); await app.stop(); });
  const password = 'ProfileDraftFixture2026';
  const passwordHash = await bcrypt.hash(password, 4);
  let studentNumber = 12618000;
  function createUser() {
    const studentId = String(++studentNumber);
    const email = `${studentId}@mail.sustech.edu.cn`;
    const id = Number(db.prepare('INSERT INTO users (email, activated, password_hash) VALUES (?, 1, ?)').run(email, passwordHash).lastInsertRowid);
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    const form: ProfileInput = { ...emptyProfile(), studentId, realName: `同学${id}`, gender: 'male', grade: 'y1', planTags: ['期末复习备考'],
      places: ['library'], schedule: [0, 1], studyType: 'quiet', studyPlan: '已提交的学习计划',
      privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true } };
    return { id, email, cookie: `dz_sid=${token}`, form };
  }
  const read = (cookie: string) => api('/profiles/me/draft', cookie);
  const save = (cookie: string, profile: ProfileInput, section: QuestionnaireSection = 'identity') =>
    api('/profiles/me/draft', cookie, 'PUT', { profile, section });

  await t.test('requires login and never marks a complete autosaved draft as submitted', async () => {
    assert.equal((await read('')).status, 401);
    assert.equal((await save('', emptyProfile())).status, 401);
    const member = createUser();
    const initial = await read(member.cookie);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.draft, null);
    assert.equal(db.prepare('SELECT user_id FROM profiles WHERE user_id = ?').get(member.id), undefined);
    const saved = await save(member.cookie, member.form, 'review');
    assert.equal(saved.status, 200);
    assert.match(saved.cacheControl!, /no-store/);
    assert.equal(saved.body.draft.section, 'review');
    assert.equal(saved.body.draft.form.realName, member.form.realName);
    assert.ok(Number.isFinite(Date.parse(saved.body.draft.updatedAt)));
    const row = db.prepare('SELECT published, saved_at, data FROM profiles WHERE user_id = ?').get(member.id)!;
    assert.equal(row.published, 0);
    assert.equal(row.saved_at, null);
    assert.equal(JSON.parse(String(row.data)).realName, '');
    const session = (await api('/auth/me', member.cookie)).body.user;
    assert.equal(session.questionnaireComplete, false);
    assert.equal(session.published, false);
    assert.equal((await api('/profiles/recommendations', member.cookie)).body.state, 'incomplete');
  });

  await t.test('autosave never changes the public profile, publication state or review metadata', async () => {
    const owner = createUser();
    const viewer = createUser();
    assert.equal((await api('/profiles/me', owner.cookie, 'PUT', { profile: owner.form })).status, 200);
    assert.equal((await api('/profiles/me/publish', owner.cookie, 'POST', {})).status, 200);
    db.prepare("UPDATE profiles SET reviewed_at = '2026-01-01 00:00:00' WHERE user_id = ?").run(owner.id);
    const before = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(owner.id);
    const draft = { ...owner.form, studyPlan: '尚未提交的私密计划', realName: '', privacyConsent: emptyProfile().privacyConsent };
    assert.equal((await save(owner.cookie, draft, 'goals')).status, 200);
    assert.deepEqual(db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(owner.id), before);
    const visible = await api(`/profiles/${owner.id}`, viewer.cookie);
    assert.equal(visible.status, 200);
    assert.equal(visible.body.profile.studyPlan, owner.form.studyPlan);
    assert.equal((await api('/auth/me', owner.cookie)).body.user.questionnaireComplete, true);
    assert.equal((await read(owner.cookie)).body.draft.form.studyPlan, draft.studyPlan);
  });

  await t.test('restores each section, sanitizes inputs, binds identity and isolates users', async () => {
    const owner = createUser();
    const other = createUser();
    for (const section of ['identity', 'demographics', 'goals', 'study', 'personality', 'expectations', 'privacy', 'review'] as const) {
      assert.equal((await save(owner.cookie, { ...owner.form, studentId: '99999999', realName: '  草稿姓名  ' }, section)).status, 200);
      const restored = await read(owner.cookie);
      assert.equal(restored.body.draft.section, section);
      assert.equal(restored.body.draft.form.realName, '草稿姓名');
      assert.equal(restored.body.draft.form.studentId, owner.form.studentId);
      assert.equal((await read(other.cookie)).body.draft, null);
    }
    assert.equal((await save(other.cookie, other.form, 'study')).status, 200);
    assert.equal((await read(other.cookie)).body.draft.form.realName, other.form.realName);
    assert.equal((await read(owner.cookie)).body.draft.form.realName, '草稿姓名');
  });

  await t.test('round-trips partial and invalid date digits in drafts while submitted dates retain ISO format', async () => {
    const owner = createUser();
    for (const goalDeadline of ['2026', '2026123', '20260230', '20261231', '']) {
      const saved = await save(owner.cookie, { ...owner.form, goalDeadline }, 'goals');
      assert.equal(saved.status, 200);
      assert.equal(saved.body.draft.form.goalDeadline, goalDeadline);
      assert.equal((await read(owner.cookie)).body.draft.form.goalDeadline, goalDeadline);
      const stored = db.prepare('SELECT data FROM profile_drafts WHERE user_id = ?').get(owner.id)!;
      assert.equal(JSON.parse(String(stored.data)).goalDeadline, goalDeadline);
    }
    const profile = { ...owner.form, goalDeadline: goalDateToIso('20261231')! };
    const submitted = await api('/profiles/me', owner.cookie, 'PUT', { profile });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.profile.goalDeadline, '2026-12-31');
    assert.equal((await api('/profiles/me', owner.cookie)).body.profile.goalDeadline, '2026-12-31');
    assert.equal((await save(owner.cookie, profile, 'goals')).body.draft.form.goalDeadline, '2026-12-31');
  });

  await t.test('autosave retains private gender before required demographic answers are complete', async () => {
    const owner = createUser();
    const profile: ProfileInput = { ...owner.form, gender: '', grade: '', genderVisibility: 'private' };
    const saved = await save(owner.cookie, profile, 'demographics');
    assert.equal(saved.status, 200);
    assert.equal(saved.body.draft.form.genderVisibility, 'private');
    const restored = (await read(owner.cookie)).body.draft.form;
    assert.equal(restored.gender, '');
    assert.equal(restored.grade, '');
    assert.equal(restored.genderVisibility, 'private');
    const submitted = await api('/profiles/me', owner.cookie, 'PUT', { profile });
    assert.equal(submitted.status, 200);
    assert.deepEqual(submitted.body.missing, [{ key: 'gender', label: '性别' }, { key: 'grade', label: '年级' }]);
    assert.equal((await api('/profiles/me/publish', owner.cookie, 'POST', {})).status, 400);
  });

  await t.test('semester courses persist privately, reject exams and enforce the independent 30-course limit', async () => {
    const owner = createUser();
    const viewer = createUser();
    const profile = { ...owner.form, subjects: ['雅思', '托福', 'GRE'], semesterCourses: COURSE_OPTIONS.slice(0, 30).map((course) => course.code) };
    const expected = COURSE_OPTIONS.slice(0, 30).map((course) => course.label);
    const saved = await save(owner.cookie, profile, 'goals');
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.draft.form.semesterCourses, expected);
    assert.deepEqual((await read(owner.cookie)).body.draft.form.semesterCourses, expected);
    for (const semesterCourses of [['IELTS'], ['自行填写课程'], COURSE_OPTIONS.slice(0, 31).map((course) => course.code)]) {
      const rejected = await save(owner.cookie, { ...profile, semesterCourses }, 'goals');
      assert.equal(rejected.status, 400);
      assert.ok(rejected.body.missing.some((item: { key: string }) => item.key === 'semesterCourses'));
      assert.deepEqual((await read(owner.cookie)).body.draft.form.semesterCourses, expected);
      assert.equal((await api('/profiles/me', owner.cookie, 'PUT', { profile: { ...profile, semesterCourses } })).status, 400);
    }
    const submitted = await api('/profiles/me', owner.cookie, 'PUT', { profile });
    assert.equal(submitted.status, 200);
    assert.deepEqual(submitted.body.profile.semesterCourses, expected);
    assert.deepEqual((await api('/profiles/me', owner.cookie)).body.profile.semesterCourses, expected);
    assert.equal((await api('/profiles/me/publish', owner.cookie, 'POST', {})).status, 200);
    assert.equal(Object.hasOwn((await api(`/profiles/${owner.id}`, viewer.cookie)).body.profile, 'semesterCourses'), false);
    assert.equal((await api('/profiles/me', viewer.cookie, 'PUT', { profile: viewer.form })).status, 200);
    assert.equal((await api('/profiles/me/publish', viewer.cookie, 'POST', {})).status, 200);
    for (const endpoint of ['/profiles', '/profiles/recommendations', '/match/deck', '/match/ranked']) {
      const publicCard = (await api(endpoint, viewer.cookie)).body.items.find((item: { id: number }) => item.id === owner.id);
      assert.ok(publicCard, endpoint);
      assert.equal(Object.hasOwn(publicCard, 'semesterCourses'), false, endpoint);
    }
  });

  await t.test('old over-limit targets survive draft recovery but cannot be submitted until reduced to three', async () => {
    const owner = createUser();
    const fresh = createUser();
    const targets = ['雅思', '托福', 'GRE', 'GMAT'];
    const legacy = { ...owner.form, subjects: targets };
    db.prepare('INSERT INTO profiles (user_id, nickname, data, saved_at) VALUES (?, ?, ?, ?)')
      .run(owner.id, `旧目标同学${owner.id}`, JSON.stringify(legacy), '2026-01-01 00:00:00');
    db.prepare('INSERT INTO profile_drafts (user_id, data, section) VALUES (?, ?, ?)').run(owner.id, JSON.stringify(legacy), 'goals');
    assert.deepEqual((await read(owner.cookie)).body.draft.form.subjects, targets);
    assert.deepEqual((await save(owner.cookie, { ...legacy, studyPlan: '仅修改计划' }, 'goals')).body.draft.form.subjects, targets);
    assert.equal((await save(fresh.cookie, { ...fresh.form, subjects: targets }, 'goals')).status, 400);
    assert.equal((await save(owner.cookie, { ...legacy, subjects: [...targets, '大学英语四级'] }, 'goals')).status, 400);
    const submitted = await api('/profiles/me', owner.cookie, 'PUT', { profile: legacy });
    assert.equal(submitted.status, 400);
    assert.ok(submitted.body.missing.some((item: { key: string }) => item.key === 'subjects'));
    assert.equal((await api('/profiles/me/publish', owner.cookie, 'POST', {})).status, 400);
    assert.deepEqual((await read(owner.cookie)).body.draft.form.subjects, targets);
    const reduced = { ...legacy, subjects: targets.slice(0, 3) };
    assert.equal((await save(owner.cookie, reduced, 'goals')).status, 200);
    assert.equal((await api('/profiles/me', owner.cookie, 'PUT', { profile: reduced })).status, 200);
    assert.equal((await api('/profiles/me/publish', owner.cookie, 'POST', {})).status, 200);
    assert.equal((await read(owner.cookie)).body.draft, null);
  });

  await t.test('publication revalidates stored semester courses even when bypassing the save endpoint', async () => {
    const owner = createUser();
    const initial = await api('/profiles/me', owner.cookie, 'PUT', { profile: owner.form });
    assert.equal(initial.status, 200);
    for (const semesterCourses of [['雅思'], COURSE_OPTIONS.slice(0, 31).map((course) => course.label)]) {
      db.prepare('UPDATE profiles SET data = ? WHERE user_id = ?').run(JSON.stringify({ ...owner.form, semesterCourses }), owner.id);
      const result = await api('/profiles/me/publish', owner.cookie, 'POST', {});
      assert.equal(result.status, 400);
      assert.ok(result.body.missing.some((item: { key: string }) => item.key === 'semesterCourses'));
    }
  });

  await t.test('rejects invalid sections, malformed data and foreign or wrong-kind images without losing the saved draft', async () => {
    const owner = createUser();
    const other = createUser();
    const ownPhoto = '111111111111111111111111.png';
    const ownTimetable = '222222222222222222222222.png';
    const foreignPhoto = '333333333333333333333333.png';
    db.prepare('INSERT INTO uploads (name, user_id, kind) VALUES (?, ?, ?)').run(ownPhoto, owner.id, 'photo');
    db.prepare('INSERT INTO uploads (name, user_id, kind) VALUES (?, ?, ?)').run(ownTimetable, owner.id, 'timetable');
    db.prepare('INSERT INTO uploads (name, user_id, kind) VALUES (?, ?, ?)').run(foreignPhoto, other.id, 'photo');
    const valid = { ...owner.form, photos: [ownPhoto], timetable: ownTimetable };
    const original = await save(owner.cookie, valid, 'demographics');
    assert.equal(original.status, 200);
    for (const body of [
      { profile: valid, section: 'H' }, { profile: valid }, { section: 'study' },
      { profile: [], section: 'study' },
      { profile: { ...valid, photos: [foreignPhoto] }, section: 'study' },
      { profile: { ...valid, photos: [ownTimetable] }, section: 'study' },
      { profile: { ...valid, timetable: ownPhoto }, section: 'study' },
    ]) {
      assert.equal((await api('/profiles/me/draft', owner.cookie, 'PUT', body)).status, 400);
      assert.deepEqual((await read(owner.cookie)).body, original.body);
    }
  });

  await t.test('a failed publish preserves answers and successful final submission clears only its own draft', async () => {
    const owner = createUser();
    const other = createUser();
    await save(owner.cookie, owner.form, 'review');
    await save(other.cookie, other.form, 'goals');
    const original = (await read(owner.cookie)).body;
    // A complete draft cannot bypass the final explicit save and validation of the live profile.
    assert.equal((await api('/profiles/me/publish', owner.cookie, 'POST', {})).status, 400);
    assert.deepEqual((await read(owner.cookie)).body, original);
    assert.equal((await api('/profiles/me', owner.cookie, 'PUT', { profile: owner.form })).status, 200);
    assert.deepEqual((await read(owner.cookie)).body, original);
    assert.equal((await api('/profiles/me/publish', owner.cookie, 'POST', {})).status, 200);
    assert.equal((await read(owner.cookie)).body.draft, null);
    assert.equal((await read(other.cookie)).body.draft.section, 'goals');
    assert.equal((await api('/auth/me', owner.cookie)).body.user.questionnaireComplete, true);
  });

  await t.test('keeps legacy course answers during draft edits but requires valid selections before publishing', async () => {
    const owner = createUser();
    const other = createUser();
    const legacy = { ...owner.form, subjects: ['旧版手填课程'] };
    db.prepare('INSERT INTO profiles (user_id, nickname, data, saved_at) VALUES (?, ?, ?, ?)')
      .run(owner.id, `旧课程同学${owner.id}`, JSON.stringify(legacy), '2026-01-01 00:00:00');
    const draft = await save(owner.cookie, { ...legacy, studyPlan: '修改学习计划' }, 'goals');
    assert.equal(draft.status, 200);
    assert.deepEqual(draft.body.draft.form.subjects, legacy.subjects);
    assert.deepEqual((await read(owner.cookie)).body.draft.form.subjects, legacy.subjects);
    // A different account cannot introduce arbitrary values by relying on another person's old answers.
    const introduced = await save(other.cookie, { ...other.form, subjects: legacy.subjects }, 'goals');
    assert.equal(introduced.status, 400);
    assert.equal((await read(other.cookie)).body.draft, null);
    const saved = await api('/profiles/me', owner.cookie, 'PUT', { profile: draft.body.draft.form });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.profile.subjects, legacy.subjects);
    const rejected = await api('/profiles/me/publish', owner.cookie, 'POST', {});
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.missing.some((item: { key: string }) => item.key === 'subjects'));
    assert.deepEqual((await read(owner.cookie)).body, draft.body);
    assert.equal((await api('/profiles/me', owner.cookie, 'PUT', { profile: { ...legacy, subjects: [] } })).status, 200);
    assert.equal((await api('/profiles/me/publish', owner.cookie, 'POST', {})).status, 200);
    assert.equal((await read(owner.cookie)).body.draft, null);
  });

  await t.test('deleting an account removes its draft even though the numeric user row is retained', async () => {
    const owner = createUser();
    const other = createUser();
    await save(owner.cookie, owner.form, 'privacy');
    await save(other.cookie, other.form, 'identity');
    const deleted = await api('/auth/account', owner.cookie, 'DELETE', { password });
    assert.equal(deleted.status, 200);
    assert.equal(db.prepare('SELECT user_id FROM profile_drafts WHERE user_id = ?').get(owner.id), undefined);
    assert.equal(db.prepare('SELECT activated FROM users WHERE id = ?').get(owner.id)!.activated, 0);
    assert.equal((await read(owner.cookie)).status, 401);
    assert.equal((await read(other.cookie)).body.draft.section, 'identity');
  });
});
