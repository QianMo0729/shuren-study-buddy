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
import { emptyPersonality, emptyProfile } from '../shared/profileRules.ts';
import type { DeckCard, DeckResponse, ProfileInput } from '../shared/types.ts';
import { FEATURE_KEYS } from '../server/learning.ts';

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-match-'));
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
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    return { status: response.status, body: await response.json() as any };
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
      try { ready = (await api('/auth/me')).status === 200; } catch { /* Allow the child to start. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, `API did not start: ${output}`);
    return { api, db: new DatabaseSync(path.join(dir, 'app.db')), stop };
  } catch (error) { await stop(); throw error; }
}

/** 周一到周日的白天时段（不含通宵） */
const DAY_SLOTS = Array.from({ length: 63 }, (_, s) => s).filter((s) => s % 9 !== 8);
const PERSONALITY = { ...emptyPersonality(), talk: 3, noise: 3, punctual: 3, plan: 3, needSupervision: 3, giveSupervision: 3, social: 3 };

test('match deck, feedback, learning and exploration', { timeout: 180_000 }, async (t) => {
  const app = await startServer();
  const { api, db } = app;
  t.after(async () => { db.close(); await app.stop(); });
  const passwordHash = await bcrypt.hash('MatchFixture2026', 4);
  let studentNumber = 12618000;

  function createUser(patch: Partial<ProfileInput> = {}, options: { published?: boolean } = {}) {
    const studentId = String(++studentNumber);
    const email = `${studentId}@mail.sustech.edu.cn`;
    const id = Number(db.prepare('INSERT INTO users (email, activated, password_hash) VALUES (?, 1, ?)').run(email, passwordHash).lastInsertRowid);
    const data: ProfileInput = {
      ...emptyProfile(), realName: `SECRET-NAME-${id}`, studentId, gender: 'male', grade: 'y1',
      planTags: ['期末复习备考'], subjects: ['线性代数'], places: ['library'], schedule: DAY_SLOTS.slice(0, 12), studyType: 'quiet',
      personality: PERSONALITY, interests: ['reading'],
      privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true },
      contacts: { showEmail: true, wechat: `SECRET-WECHAT-${id}`, qq: '90000123', phone: '18800001234', other: 'SECRET-CONTACT' },
      ...patch,
    };
    db.prepare('INSERT INTO profiles (user_id, nickname, data, published, saved_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, `匹配测试${id}`, JSON.stringify(data), options.published === false ? 0 : 1, new Date().toISOString());
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    return { id, email, cookie: `dz_sid=${token}`, data, nickname: `匹配测试${id}` };
  }
  type Member = ReturnType<typeof createUser>;
  const reset = () => {
    db.exec('DELETE FROM users');
    db.exec("DELETE FROM settings WHERE key LIKE 'pref_%'");
  };
  const storeProfile = (member: Member, patch: Partial<ProfileInput> = {}) => {
    db.prepare('UPDATE profiles SET data = ? WHERE user_id = ?').run(JSON.stringify({ ...member.data, ...patch }), member.id);
  };
  const deck = async (member: Member, limit?: number): Promise<DeckResponse> => {
    const response = await api(`/match/deck${limit === undefined ? '' : `?limit=${limit}`}`, member.cookie);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  };
  const ranked = async (member: Member, limit = 50): Promise<DeckResponse> => {
    const response = await api(`/match/ranked?limit=${limit}`, member.cookie);
    assert.equal(response.status, 200);
    return response.body;
  };
  const ids = (items: DeckCard[]) => items.map((item) => item.id);
  const feedback = (from: Member, to: Member | number, action: string) =>
    api('/match/feedback', from.cookie, 'POST', { targetId: typeof to === 'number' ? to : to.id, action });
  const notifications = (member: Member) =>
    (db.prepare('SELECT title, link FROM notifications WHERE user_id = ? ORDER BY id').all(member.id) as { title: string; link: string }[])
      .map((row) => ({ title: row.title, link: row.link }));
  const model = (member: Member) => {
    const row = db.prepare('SELECT weights, samples FROM preference_models WHERE user_id = ?').get(member.id) as { weights: string; samples: number } | undefined;
    return row ? { weights: JSON.parse(row.weights) as Record<string, number>, samples: row.samples } : null;
  };

  await t.test('every endpoint requires a session', async () => {
    reset();
    for (const [endpoint, method, body] of [['/match/deck', 'GET'], ['/match/ranked', 'GET'], ['/match/feedback?action=like', 'GET'],
      ['/match/feedback', 'POST', { targetId: 1, action: 'like' }], ['/match/feedback/1', 'DELETE']] as const) {
      assert.equal((await api(endpoint, '', method, body)).status, 401, endpoint);
    }
  });

  await t.test('viewers who cannot be matched get a state and no candidates', async () => {
    reset();
    const viewer = createUser();
    createUser();
    storeProfile(viewer, { studyType: '' });
    const incomplete = await deck(viewer);
    assert.equal(incomplete.state, 'incomplete');
    assert.deepEqual(incomplete.items, []);
    assert.ok(incomplete.missing.some((item) => item.key === 'studyType'));
    storeProfile(viewer, { status: 'busy' });
    assert.equal((await deck(viewer)).state, 'unavailable');
    storeProfile(viewer);
    db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(viewer.id);
    const unpublished = await deck(viewer);
    assert.equal(unpublished.state, 'unpublished');
    assert.equal(unpublished.eligibleCount, 0);
    assert.equal((await ranked(viewer)).state, 'unpublished');
    db.prepare('UPDATE profiles SET published = 1 WHERE user_id = ?').run(viewer.id);
    const ready = await deck(viewer);
    assert.equal(ready.state, 'ready');
    assert.deepEqual(ready.personalization, { samples: 0, active: false, emphasis: [] });
  });

  await t.test('legacy published profiles with missing gender or grade require completion without mutating their publication record', async () => {
    reset();
    const viewer = createUser();
    const legacy = createUser({ gender: '', grade: '' });
    const session = await api('/auth/me', legacy.cookie);
    assert.equal(session.body.user.questionnaireComplete, false);
    const incomplete = await deck(legacy);
    assert.equal(incomplete.state, 'incomplete');
    assert.deepEqual(incomplete.missing, [{ key: 'gender', label: '性别' }, { key: 'grade', label: '年级' }]);
    assert.ok(!ids((await deck(viewer)).items).includes(legacy.id));
    const publish = await api('/profiles/me/publish', legacy.cookie, 'POST', {});
    assert.equal(publish.status, 400);
    assert.ok(publish.body.missing.some((item: { key: string }) => item.key === 'gender'));
    assert.ok(publish.body.missing.some((item: { key: string }) => item.key === 'grade'));
    assert.equal(db.prepare('SELECT published FROM profiles WHERE user_id = ?').get(legacy.id)!.published, 1);
    storeProfile(legacy, { gender: 'female', grade: 'y1' });
    assert.equal((await api('/auth/me', legacy.cookie)).body.user.questionnaireComplete, true);
    assert.ok(!ids((await deck(viewer)).items).includes(legacy.id), 'completing another profile does not refill today');
  });

  await t.test('hidden gender is redacted from every public card and profile while matching uses the actual answer', async () => {
    reset();
    const viewer = createUser({ gender: 'male', buddyGender: 'female' });
    const hidden = createUser({ gender: 'female', genderVisibility: 'private' });
    const shown = createUser({ gender: 'female', genderVisibility: 'public' });
    const saved = await api('/profiles/me', hidden.cookie, 'PUT', { profile: hidden.data });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.missing, []);
    assert.equal(saved.body.profile.gender, 'female');
    assert.equal(saved.body.profile.genderVisibility, 'private');
    assert.equal((await api('/profiles/me', hidden.cookie)).body.profile.gender, 'female');
    assert.equal((await api('/auth/me', hidden.cookie)).body.user.questionnaireComplete, true);
    for (const endpoint of ['/profiles', '/profiles/recommendations', '/match/deck', '/match/ranked']) {
      const response = await api(endpoint, viewer.cookie);
      assert.equal(response.status, 200);
      const card = response.body.items.find((item: { id: number }) => item.id === hidden.id);
      assert.ok(card, `${endpoint} must keep compatible hidden-gender candidates`);
      assert.equal(card.gender, '', endpoint);
      assert.equal(response.body.items.find((item: { id: number }) => item.id === shown.id).gender, 'female', endpoint);
    }
    for (const cookie of [viewer.cookie, hidden.cookie]) {
      assert.equal((await api(`/profiles/${hidden.id}`, cookie)).body.profile.gender, '');
    }
    const searched = await api('/profiles/search', viewer.cookie, 'POST', {
      criteria: [{ field: 'gender', mode: 'must', values: ['female'] }],
    });
    assert.equal(searched.status, 200);
    assert.ok(!searched.body.items.some((item: { id: number }) => item.id === hidden.id));
    assert.ok(searched.body.items.some((item: { id: number }) => item.id === shown.id));
    storeProfile(hidden, { gender: 'male', genderVisibility: 'private' });
    assert.ok(!ids((await deck(viewer)).items).includes(hidden.id), 'visibility must not bypass actual buddy-gender compatibility');
    assert.equal((await api(`/profiles/${hidden.id}`, viewer.cookie)).body.profile.gender, '');
  });

  await t.test('mutual likes create a match and notify both people; a one-way like does not', async () => {
    reset();
    const a = createUser();
    const b = createUser();
    const first = await feedback(a, b, 'like');
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { action: 'like', matched: false, matchId: null });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM matches').get()!.n, 0);
    assert.deepEqual(notifications(a), []);
    assert.deepEqual(notifications(b), [], 'a one-way like is never announced');
    assert.equal((await api(`/profiles/${b.id}`, a.cookie)).body.profile.matchState, 'liked');
    assert.equal((await api(`/profiles/${a.id}`, b.cookie)).body.profile.matchState, 'none', 'the like stays private');
    assert.ok(!ids((await deck(a)).items).includes(b.id), 'people I already like wait outside the deck');
    assert.ok(ids((await deck(b)).items).includes(a.id));

    const second = await feedback(b, a, 'like');
    assert.equal(second.status, 200);
    assert.equal(second.body.matched, true);
    const matchId = second.body.matchId;
    assert.ok(Number.isInteger(matchId));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM matches WHERE status = 'active'").get()!.n, 1);
    for (const member of [a, b]) {
      assert.deepEqual(notifications(member), [{ title: '你们互相感兴趣了', link: `/messages/${matchId}` }]);
      const profile = (await api(`/profiles/${member === a ? b.id : a.id}`, member.cookie)).body.profile;
      assert.equal(profile.matchState, 'matched');
      assert.equal(profile.matchId, matchId);
      assert.equal((await deck(member)).items.length, 0, 'matched people leave each other\'s deck');
    }
    // Repeating a like is idempotent and does not notify again.
    const again = await feedback(a, b, 'like');
    assert.deepEqual(again.body, { action: 'like', matched: true, matchId });
    assert.equal(notifications(a).length, 1);
    // Undoing a like keeps the existing match.
    assert.equal((await api(`/match/feedback/${b.id}`, a.cookie, 'DELETE')).status, 200);
    assert.equal(db.prepare("SELECT status FROM matches WHERE id = ?").get(matchId)!.status, 'active');
  });

  await t.test('feedback hides assigned people; saved-for-later never expires and undo restores only their assigned slot', async () => {
    reset();
    const viewer = createUser();
    const [disliked, liked, skipped, other] = Array.from({ length: 4 }, () => createUser());
    assert.deepEqual(ids((await deck(viewer)).items).sort(), [disliked.id, liked.id, skipped.id, other.id].sort());
    for (const [target, action] of [[disliked, 'dislike'], [liked, 'like'], [skipped, 'skip']] as const) {
      const response = await feedback(viewer, target, action);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { action, matched: false, matchId: null });
    }
    const after = await deck(viewer);
    assert.deepEqual(ids(after.items), [other.id]);
    assert.equal(after.total, 1);
    assert.equal(after.eligibleCount, 1);
    for (const [target, state] of [[disliked, 'disliked'], [liked, 'liked'], [skipped, 'skipped'], [other, 'none']] as const) {
      assert.equal((await api(`/profiles/${target.id}`, viewer.cookie)).body.profile.matchState, state);
    }
    // Saved-for-later does not expire, even after its old three-day cooldown.
    db.prepare("UPDATE match_feedback SET updated_at = datetime('now', '-2 days') WHERE user_id = ? AND target_id = ?").run(viewer.id, skipped.id);
    assert.ok(!ids((await deck(viewer)).items).includes(skipped.id));
    db.prepare("UPDATE match_feedback SET updated_at = datetime('now', '-4 days') WHERE user_id = ? AND target_id = ?").run(viewer.id, skipped.id);
    assert.ok(!ids((await deck(viewer)).items).includes(skipped.id));
    assert.deepEqual((await api('/match/feedback?action=skip', viewer.cookie)).body.items.map((item: any) => item.targetId), [skipped.id]);
    assert.equal((await api('/match/feedback?action=skip', other.cookie)).body.items.length, 0);
    assert.equal(model(viewer)!.samples, 2, 'skip is not a negative preference signal');
    db.prepare('UPDATE match_feedback SET features = (SELECT features FROM match_feedback WHERE user_id = ? AND target_id = ?) WHERE user_id = ? AND target_id = ?').run(viewer.id, liked.id, viewer.id, skipped.id);
    assert.equal((await deck(viewer)).personalization.samples, 2, 'legacy skip feature snapshots are ignored as well');

    const list = await api('/match/feedback?action=dislike', viewer.cookie);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map((item: any) => [item.targetId, item.nickname, item.action]), [[disliked.id, disliked.nickname, 'dislike']]);
    assert.ok(!Number.isNaN(Date.parse(list.body.items[0].createdAt)));
    assert.equal(JSON.stringify(list.body).includes('SECRET'), false);
    assert.equal((await api('/match/feedback?action=bogus', viewer.cookie)).status, 400);

    assert.equal((await api(`/match/feedback/${disliked.id}`, viewer.cookie, 'DELETE')).status, 200);
    assert.ok(ids((await deck(viewer)).items).includes(disliked.id), 'undo puts the person back');
    assert.deepEqual((await api('/match/feedback?action=dislike', viewer.cookie)).body.items, []);
    assert.equal((await api('/match/feedback/999999', viewer.cookie, 'DELETE')).status, 200);
    assert.equal((await api('/match/feedback/abc', viewer.cookie, 'DELETE')).status, 404);
  });

  await t.test('a candidate who disliked me silently disappears, and exclusions hide people both ways', async () => {
    reset();
    const viewer = createUser();
    const candidate = createUser();
    assert.equal((await feedback(candidate, viewer, 'dislike')).status, 200);
    const result = await deck(viewer);
    assert.deepEqual(result.items, []);
    assert.equal(result.state, 'empty');
    assert.equal((await api(`/profiles/${candidate.id}`, viewer.cookie)).body.profile.matchState, 'none', 'their dislike is not revealed');
    db.exec('DELETE FROM match_feedback');

    for (const [from, to] of [[viewer, candidate], [candidate, viewer]]) {
      db.prepare('INSERT INTO exclusions (user_id, target_id) VALUES (?, ?)').run(from.id, to.id);
      for (const member of [viewer, candidate]) {
        const hidden = await deck(member);
        assert.deepEqual(hidden.items, []);
        assert.equal(hidden.eligibleCount, 0);
        assert.deepEqual((await ranked(member)).items, []);
      }
      assert.equal((await feedback(viewer, candidate, 'like')).status, 404);
      assert.equal((await feedback(candidate, viewer, 'dislike')).status, 404);
      db.exec('DELETE FROM exclusions');
    }
    // A dislike I hid in the past is not listed while we exclude each other.
    await feedback(viewer, candidate, 'dislike');
    db.prepare('INSERT INTO exclusions (user_id, target_id) VALUES (?, ?)').run(candidate.id, viewer.id);
    assert.deepEqual((await api('/match/feedback?action=dislike', viewer.cookie)).body.items, []);
  });

  await t.test('only visible, complete profiles can receive feedback, and only ready viewers can like', async () => {
    reset();
    const viewer = createUser();
    const target = createUser();
    const restore = () => {
      storeProfile(target);
      db.prepare('UPDATE profiles SET published = 1, taken_down = 0 WHERE user_id = ?').run(target.id);
      db.prepare('UPDATE users SET activated = 1, password_hash = ? WHERE id = ?').run(passwordHash, target.id);
    };
    const cases: [string, () => void][] = [
      ['unpublished', () => db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(target.id)],
      ['taken down', () => db.prepare('UPDATE profiles SET taken_down = 1 WHERE user_id = ?').run(target.id)],
      ['incomplete', () => storeProfile(target, { studyType: '' })],
      ['no schedule', () => storeProfile(target, { schedule: [] })],
      ['withdrawn consent', () => storeProfile(target, { privacyConsent: { ...target.data.privacyConsent, withdrawal: false } })],
      ['inactive', () => db.prepare('UPDATE users SET activated = 0 WHERE id = ?').run(target.id)],
    ];
    for (const [label, apply] of cases) {
      apply();
      for (const action of ['like', 'dislike', 'skip']) assert.equal((await feedback(viewer, target, action)).status, 404, `${label} ${action}`);
      restore();
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM match_feedback').get()!.n, 0);
    assert.equal((await feedback(viewer, 999_999, 'like')).status, 404);
    assert.equal((await api('/match/feedback', viewer.cookie, 'POST', { targetId: 'abc', action: 'like' })).status, 404);
    assert.equal((await feedback(viewer, viewer, 'like')).status, 400);
    assert.equal((await feedback(viewer, target, 'love')).status, 400);

    db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(viewer.id);
    const blocked = await feedback(viewer, target, 'like');
    assert.equal(blocked.status, 403, 'an unpublished viewer cannot like, because the other person could not see them');
    assert.equal((await feedback(viewer, target, 'dislike')).status, 200, 'but can still hide people');
  });

  await t.test('feedback keeps a privacy-safe feature snapshot and trains a personal model', async () => {
    reset();
    const viewer = createUser();
    const target = createUser({ gender: 'female', grade: 'y2', photos: ['0123456789abcdef01234567.png'], photoVisibility: 'public' });
    assert.equal((await feedback(viewer, target, 'like')).status, 200);
    const stored = JSON.parse((db.prepare('SELECT features FROM match_feedback WHERE user_id = ? AND target_id = ?').get(viewer.id, target.id) as { features: string }).features);
    assert.deepEqual(Object.keys(stored).sort(), [...FEATURE_KEYS].sort());
    for (const [key, value] of Object.entries(stored)) {
      assert.doesNotMatch(key, /gender|photo|grade|nick/i);
      assert.ok(typeof value === 'number' && value >= 0 && value <= 1, key);
    }
    assert.equal(model(viewer)!.samples, 1);
    // Changing my mind replaces the earlier signal instead of counting twice.
    assert.equal((await feedback(viewer, target, 'dislike')).status, 200);
    assert.equal(model(viewer)!.samples, 1);
    assert.equal((await api(`/match/feedback/${target.id}`, viewer.cookie, 'DELETE')).status, 200);
    assert.equal(model(viewer)!.samples, 0);
    // Without common time there is nothing to learn from, but the feedback is still recorded.
    const apart = createUser({ schedule: [DAY_SLOTS[40]] });
    storeProfile(viewer, { schedule: [DAY_SLOTS[0]] });
    assert.equal((await feedback(viewer, apart, 'dislike')).status, 200);
    assert.equal(model(viewer)!.samples, 0);
    assert.equal((await api(`/profiles/${apart.id}`, viewer.cookie)).body.profile.matchState, 'disliked');
  });

  await t.test('learning updates preferences while today’s assigned order remains stable', async () => {
    reset();
    const viewer = createUser({ schedule: DAY_SLOTS, frequency: 'daily', duration: 'long' });
    // X: the same subject, style and habits, but only one shared slot. Y: lots of shared time, a different subject and style.
    const x = createUser({ schedule: [DAY_SLOTS[0]] });
    const y = createUser({ schedule: DAY_SLOTS.slice(0, 12), planTags: ['考研'], subjects: ['雅思'], studyType: 'discuss' });
    const order = (result: DeckResponse) => ids(result.items).filter((id) => id === x.id || id === y.id);
    const initial = await deck(viewer);
    assert.ok(initial.items.find((item) => item.id === x.id)!.recommendation.score > initial.items.find((item) => item.id === y.id)!.recommendation.score,
      'fixture: X has the better questionnaire score');
    assert.deepEqual(order(initial), [x.id, y.id]);

    const highTime = () => createUser({ schedule: DAY_SLOTS.slice(0, 12) });
    const lowTime = () => createUser({ schedule: [DAY_SLOTS[1]] });
    for (const action of ['like', 'dislike', 'like'] as const) {
      assert.equal((await feedback(viewer, action === 'like' ? highTime() : lowTime(), action)).status, 200);
    }
    const early = await deck(viewer);
    assert.deepEqual(order(early), [x.id, y.id], 'three feedbacks do not override the questionnaire');
    assert.equal(early.personalization.samples, 3);
    assert.equal(early.personalization.active, false);

    for (let i = 0; i < 12; i++) {
      assert.equal((await feedback(viewer, highTime(), 'like')).status, 200);
      assert.equal((await feedback(viewer, lowTime(), 'dislike')).status, 200);
    }
    const learned = model(viewer)!;
    assert.equal(learned.samples, 27);
    assert.ok(learned.weights.time > 2.4, `time weight rose above the prior (${learned.weights.time})`);
    assert.ok('bias' in learned.weights);
    const late = await deck(viewer);
    assert.deepEqual(order(late), [x.id, y.id], 'feedback only changes future assignments');
    assert.equal(late.personalization.samples, 27);
    assert.equal(late.personalization.active, true);
    assert.ok(late.personalization.emphasis.includes('共同时间'), JSON.stringify(late.personalization));
    const yCard = late.items.find((item) => item.id === y.id)!;
    assert.equal(yCard.rankScore, initial.items.find((item) => item.id === y.id)!.rankScore, 'today’s ranking score remains stable');
    // The plain ranked list ignores personal preferences.
    assert.deepEqual(order(await ranked(viewer)), [x.id, y.id]);
  });

  await t.test('other people’s private state never changes what a viewer sees: one-way likes, login activity, pending likes', async () => {
    reset();
    const viewer = createUser();
    const best = createUser();
    const admirer = createUser({ interests: ['music'] });
    // Everything a viewer can observe, for every batch size they may ask for.
    const observe = async () => JSON.stringify([
      await deck(viewer), await deck(viewer, 1), await deck(viewer, 2), await deck(viewer, 3), await ranked(viewer), await ranked(viewer, 1),
    ]);
    const before = await observe();
    assert.deepEqual(ids((await deck(viewer)).items), [best.id, admirer.id]);
    assert.deepEqual(ids((await deck(viewer, 1)).items), [best.id]);

    // 单向的「感兴趣」：对方回应之前，被喜欢的人看到的任何结果都不变（包括只要一张卡片时）
    assert.equal((await feedback(admirer, viewer, 'like')).status, 200);
    assert.equal(await observe(), before, 'a one-way like is unobservable to its recipient');
    assert.deepEqual(ids((await deck(viewer, 1)).items), [best.id]);

    // 登录时间：最近登录或长期未登录都不改变排序
    for (const age of ['-40 days', '-1 days', '-8 days']) {
      db.prepare("UPDATE users SET last_login_at = datetime('now', ?) WHERE id = ?").run(age, best.id);
      assert.equal(await observe(), before, `last login ${age} is unobservable`);
    }
    db.prepare('UPDATE users SET last_login_at = NULL WHERE id = ?').run(best.id);
    assert.equal(await observe(), before);

    // 别人收到了多少尚未回应的「感兴趣」也不改变排序
    const crowd = Array.from({ length: 20 }, () => createUser({}, { published: false }));
    for (const fan of crowd) {
      db.prepare("INSERT INTO match_feedback (user_id, target_id, action, features) VALUES (?, ?, 'like', '{}')").run(fan.id, best.id);
    }
    assert.equal(await observe(), before, 'pending likes received by a candidate are unobservable');

    // 展示的分数与顺序一致：没有任何不出现在返回值里的加成
    const shown = await deck(viewer);
    for (const item of shown.items) assert.equal(item.rankScore, item.recommendation.score);
    const scores = shown.items.map((item) => item.rankScore);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
    assert.equal(JSON.stringify(shown).includes('liked'), false);
  });

  await t.test('my own choices can be reviewed: likes still waiting for an answer, and people moved to "not interested" by closing a chat', async () => {
    reset();
    const viewer = createUser();
    const waiting = createUser();
    const matched = createUser();
    const closed = createUser();
    const liked = async () => (await api('/match/feedback?action=like', viewer.cookie)).body.items as any[];
    assert.deepEqual(await liked(), []);
    for (const target of [waiting, matched, closed]) assert.equal((await feedback(viewer, target, 'like')).status, 200);
    assert.deepEqual((await liked()).map((item) => item.targetId).sort(), [waiting.id, matched.id, closed.id].sort());

    // 对方也感兴趣之后进入私聊，不再属于“等待回应”
    const first = await feedback(matched, viewer, 'like');
    const second = await feedback(closed, viewer, 'like');
    assert.equal(first.body.matched, true);
    assert.deepEqual((await liked()).map((item) => [item.targetId, item.nickname, item.action]), [[waiting.id, waiting.nickname, 'like']]);
    assert.equal(JSON.stringify(await liked()).includes('SECRET'), false);
    // 名单只属于自己：对方看不到谁在等自己回应
    assert.deepEqual((await api('/match/feedback?action=like', waiting.cookie)).body.items, []);

    // 撤回之后回到推荐里
    assert.equal((await api(`/match/feedback/${waiting.id}`, viewer.cookie, 'DELETE')).status, 200);
    assert.deepEqual(await liked(), []);
    assert.ok(ids((await deck(viewer)).items).includes(waiting.id));

    // 解除配对的同学出现在「不感兴趣」名单里，并标明来由；卡片上标记的没有这个标记
    assert.equal((await api(`/chat/${second.body.matchId}/close`, viewer.cookie, 'POST', {})).status, 200);
    assert.equal((await feedback(viewer, waiting, 'dislike')).status, 200);
    const disliked = (await api('/match/feedback?action=dislike', viewer.cookie)).body.items as any[];
    assert.deepEqual(disliked.map((item) => [item.targetId, item.closedMatch]).sort(), [[closed.id, true], [waiting.id, false]].sort());
    // 被解除的一方没有做过这个选择，名单里不会出现
    assert.deepEqual((await api('/match/feedback?action=dislike', closed.cookie)).body.items, []);
  });

  await t.test('daily assignments cap all endpoints at five, survive concurrent refresh, and never refill', async () => {
    reset();
    const viewer = createUser({ schedule: DAY_SLOTS.slice(0, 40) });
    Array.from({ length: 32 }, (_, i) => createUser({ schedule: DAY_SLOTS.slice(0, (i % 16) + 1), interests: i % 3 ? ['reading'] : ['games'] }));
    const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => index % 2 ? ranked(viewer, 100) : deck(viewer, 40)));
    const first = concurrent[0];
    for (const response of concurrent) assert.deepEqual(response, first);
    assert.equal(first.items.length, 5);
    assert.equal(first.daily.assigned, 5);
    assert.equal(first.daily.remaining, 5);
    assert.equal(first.items[4].explore, true);
    assert.equal(first.items.filter((item) => item.explore).length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_recommendation_batches WHERE user_id = ?').get(viewer.id)!.n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_recommendation_items WHERE user_id = ?').get(viewer.id)!.n, 5);
    assert.deepEqual(ids((await deck(viewer, 1)).items), ids(first.items).slice(0, 1));
    assert.deepEqual(ids((await deck(viewer, 1000)).items), ids(first.items));
    assert.deepEqual((await api('/profiles/recommendations', viewer.cookie)).body.items.map((item: any) => item.id), ids(first.items));
    for (const [index, item] of first.items.entries()) {
      assert.equal((await feedback(viewer, item.id, (['like', 'dislike', 'skip'] as const)[index % 3])).status, 200);
    }
    const done = await deck(viewer);
    assert.equal(done.state, 'daily_done');
    assert.deepEqual(done.items, []);
    assert.equal(done.daily.assigned, 5);
    assert.equal(done.daily.remaining, 0);
    createUser();
    assert.equal((await ranked(viewer)).items.length, 0, 'new profiles cannot refill a spent day');
    await api(`/match/feedback/${first.items[0].id}`, viewer.cookie, 'DELETE');
    assert.deepEqual(ids((await deck(viewer)).items), [first.items[0].id], 'undo restores the same assigned person');
    assert.equal((await deck(viewer)).daily.assigned, 5);
    db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(first.items[0].id);
    assert.equal((await deck(viewer)).state, 'daily_done', 'withdrawal hides the last item without refill');
  });

  await t.test('deck responses never serialize identity, contact or activity fields', async () => {
    reset();
    const viewer = createUser();
    const privatePhoto = 'abcdef0123456789abcdef01.png';
    const candidate = createUser({ photos: [privatePhoto], mbti: 'SECRET-MBTI' });
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(candidate.id);
    for (const result of [await deck(viewer), await ranked(viewer)]) {
      assert.equal(result.items[0].id, candidate.id);
      assert.equal(result.items[0].cover, null);
      const serialized = JSON.stringify(result);
      for (const secret of [privatePhoto, candidate.email, candidate.data.realName, candidate.data.studentId, 'SECRET-WECHAT', 'SECRET-MBTI', 'last_login']) {
        assert.equal(serialized.includes(secret), false, secret);
      }
    }
  });

  await t.test('a site-wide prior is fitted once enough feedback exists', async () => {
    reset();
    const members = Array.from({ length: 16 }, () => createUser());
    const snapshot = JSON.stringify(Object.fromEntries(FEATURE_KEYS.map((key) => [key, key === 'places' ? 1 : 0.5])));
    const insert = db.prepare("INSERT INTO match_feedback (user_id, target_id, action, features) VALUES (?, ?, 'like', ?)");
    let inserted = 0;
    for (const a of members.slice(1)) for (const b of members.slice(1)) {
      if (a.id !== b.id && inserted < 200) { insert.run(a.id, b.id, snapshot); inserted++; }
    }
    assert.equal(inserted, 200);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM settings WHERE key = 'pref_global_model'").get()!.n, 0);
    assert.equal((await feedback(members[0], members[1], 'like')).status, 200);
    // 全站先验在响应之后异步重算，不阻塞这次请求
    let stored: { value: string } | undefined;
    for (let i = 0; i < 50 && !stored; i++) {
      stored = db.prepare("SELECT value FROM settings WHERE key = 'pref_global_model'").get() as { value: string } | undefined;
      if (!stored) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(stored, 'global prior stored in settings');
    const global = JSON.parse(stored.value);
    assert.ok(Number.isFinite(global.model.bias));
    for (const key of FEATURE_KEYS) assert.ok(Number.isFinite(global.model[key]), key);
    assert.ok(global.model.bias > 0, 'mostly-like feedback raises the base rate');
  });

  await t.test('feedback is rate limited per user', async () => {
    reset();
    const viewer = createUser();
    const target = createUser();
    let last = 0;
    for (let i = 0; i < 301; i++) last = (await feedback(viewer, target, i % 2 ? 'skip' : 'dislike')).status;
    assert.equal(last, 429);
  });
});
