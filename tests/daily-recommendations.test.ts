import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { emptyProfile, emptyPersonality } from '../shared/profileRules.ts';
import type { ProfileInput } from '../shared/types.ts';

// 独立临时库验证跨日与持久化，不启动 HTTP 服务，也不读取开发者的本地数据。
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-daily-'));
process.env.DATA_DIR = dir;
const { db, q } = await import('../server/db.ts');
const { buildDeck, buildRanked } = await import('../server/matching.ts');
const { beijingDate, nextBeijingMidnight } = await import('../server/dailyRecommendations.ts');
const { runAccountCleanup } = await import('../server/social.ts');

const profile = (patch: Partial<ProfileInput> = {}): ProfileInput => ({
  ...emptyProfile(), realName: '测试同学', studentId: '12619999', gender: 'male', grade: 'y1',
  planTags: ['期末复习备考'], subjects: ['线性代数'], places: ['library'], schedule: [0, 1, 2], studyType: 'quiet',
  personality: { ...emptyPersonality(), talk: 3, noise: 3, punctual: 3, plan: 3, needSupervision: 3, giveSupervision: 3, social: 3 },
  privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true }, ...patch,
});
let number = 0;
function user(patch: Partial<ProfileInput> = {}) {
  const id = Number(q.run('INSERT INTO users (email, activated, password_hash) VALUES (?, 1, ?)', `daily${++number}@mail.sustech.edu.cn`, 'fixture-hash').lastInsertRowid);
  q.run("INSERT INTO profiles (user_id, nickname, data, published, saved_at) VALUES (?, ?, ?, 1, datetime('now'))", id, `每日${id}`, JSON.stringify(profile(patch)));
  return id;
}
const ids = (result: ReturnType<typeof buildDeck>) => result.items.map((item) => item.id);

test('Beijing day boundary, stable daily assignments, recent exposure priority and account cleanup', async (t) => {
  t.after(async () => { db.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const beforeMidnight = new Date('2026-10-07T15:59:59Z');
  const afterMidnight = new Date('2026-10-07T16:00:00Z');
  assert.equal(beijingDate(beforeMidnight), '2026-10-07');
  assert.equal(beijingDate(afterMidnight), '2026-10-08');
  assert.equal(nextBeijingMidnight('2026-10-07'), afterMidnight.toISOString());

  const viewer = user();
  const candidates = Array.from({ length: 12 }, () => user());
  const incompatible = user({ schedule: [30], mode: 'offline' });
  const first = buildDeck(viewer, 1, beforeMidnight);
  assert.equal(first.daily.assigned, 5, 'a small API limit still creates the whole daily assignment once');
  const all = buildRanked(viewer, 99, beforeMidnight);
  assert.equal(all.items.length, 5);
  assert.equal(first.items[0].id, all.items[0].id);
  assert.deepEqual(buildDeck(viewer, 99, beforeMidnight), all, 'separate calls share the persisted assignment');
  assert.ok(!ids(all).includes(incompatible));
  const tomorrow = buildDeck(viewer, 99, afterMidnight);
  assert.equal(tomorrow.items.length, 5);
  assert.ok(ids(tomorrow).every((id) => !ids(all).includes(id)), 'unseen compatible people take priority, including exploration');
  assert.ok(!ids(tomorrow).includes(incompatible), 'recency never relaxes hard conditions');
  assert.ok(ids(tomorrow).every((id) => candidates.includes(id)));

  const removed = tomorrow.items[0].id;
  runAccountCleanup(removed);
  q.run('DELETE FROM users WHERE id = ?', removed);
  const afterDeletion = buildDeck(viewer, 99, afterMidnight);
  assert.equal(afterDeletion.daily.assigned, 5, 'deleted users do not refund their assigned slot');
  assert.equal(afterDeletion.items.length, 4);
  assert.ok(!ids(afterDeletion).includes(removed));
  const newUser = user();
  assert.ok(!ids(buildDeck(viewer, 99, afterMidnight)).includes(newUser));

  runAccountCleanup(viewer);
  assert.equal(q.get<{ n: number }>('SELECT COUNT(*) n FROM daily_recommendation_batches WHERE user_id = ?', viewer)!.n, 0);
  assert.equal(q.get<{ n: number }>('SELECT COUNT(*) n FROM daily_recommendation_items WHERE user_id = ?', viewer)!.n, 0);
});
