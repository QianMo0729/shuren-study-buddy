// 每日名单只保存目标 ID 和排序信息；返回卡片时始终重新检查当前可见性与硬条件。
import { db, q } from './db.ts';
import { registerAccountCleanup } from './social.ts';

export const DAILY_RECOMMENDATION_LIMIT = 5;
export const beijingDate = (date = new Date()) => date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
export const nextBeijingMidnight = (date: string) => new Date(Date.parse(`${date}T00:00:00+08:00`) + 86_400_000).toISOString();

db.exec(`
CREATE TABLE IF NOT EXISTS daily_recommendation_batches (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  assigned_count INTEGER NOT NULL CHECK(assigned_count BETWEEN 0 AND 5),
  empty_state TEXT NOT NULL CHECK(empty_state IN ('empty', 'no_overlap')),
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS daily_recommendation_items (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 4),
  target_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rank_score REAL NOT NULL,
  explore INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, position),
  UNIQUE (user_id, day, target_id),
  FOREIGN KEY (user_id, day) REFERENCES daily_recommendation_batches(user_id, day) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_daily_recommendation_exposure ON daily_recommendation_items(user_id, target_id, day);
`);

export interface DailyAssignment { id: number; rankScore: number; explore: boolean }
interface BatchRow { assigned_count: number; empty_state: 'empty' | 'no_overlap' }
export interface DailyBatch extends BatchRow { items: DailyAssignment[] }

export function previousExposureDays(uid: number, date: string): Map<number, string> {
  return new Map(q.all<{ target_id: number; last_day: string }>(
    `SELECT target_id, MAX(day) AS last_day FROM daily_recommendation_items
     WHERE user_id = ? AND day < ? AND target_id IS NOT NULL GROUP BY target_id`, uid, date,
  ).map((row) => [row.target_id, row.last_day]));
}

type Generate = (exclude: Set<number>, need: number) => { items: DailyAssignment[]; emptyState: 'empty' | 'no_overlap' };

/**
 * 当天名单：第一次领取时生成最多五位；名单不满五位时（例如活动初期人少），当天之后再领取会补足空位。
 * 已经推荐过的同学不撤回、不替换；处理（感兴趣 / 不感兴趣 / 稍后再看）、撤销或对方注销都不会退还名额。
 * BEGIN IMMEDIATE 串行化多进程同时领取；唯一键和 position 上限进一步保证每天最多五位。
 */
export function dailyBatch(uid: number, date: string, generate: Generate): DailyBatch {
  db.exec('BEGIN IMMEDIATE');
  try {
    let batch = q.get<BatchRow>('SELECT assigned_count, empty_state FROM daily_recommendation_batches WHERE user_id = ? AND day = ?', uid, date);
    if (!batch) {
      const generated = generate(new Set(), DAILY_RECOMMENDATION_LIMIT);
      const items = generated.items.slice(0, DAILY_RECOMMENDATION_LIMIT);
      q.run('INSERT INTO daily_recommendation_batches (user_id, day, assigned_count, empty_state) VALUES (?, ?, ?, ?)', uid, date, items.length, generated.emptyState);
      items.forEach((item, index) => q.run(
        'INSERT INTO daily_recommendation_items (user_id, day, position, target_id, rank_score, explore) VALUES (?, ?, ?, ?, ?, ?)',
        uid, date, index, item.id, item.rankScore, item.explore ? 1 : 0,
      ));
      batch = { assigned_count: items.length, empty_state: generated.emptyState };
    } else if (batch.assigned_count < DAILY_RECOMMENDATION_LIMIT) {
      const assigned = new Set(q.all<{ target_id: number | null }>(
        'SELECT target_id FROM daily_recommendation_items WHERE user_id = ? AND day = ?', uid, date,
      ).flatMap((row) => (row.target_id === null ? [] : [row.target_id])));
      const need = DAILY_RECOMMENDATION_LIMIT - batch.assigned_count;
      const generated = generate(assigned, need);
      const items = generated.items.filter((item) => !assigned.has(item.id)).slice(0, need);
      items.forEach((item, index) => q.run(
        'INSERT INTO daily_recommendation_items (user_id, day, position, target_id, rank_score, explore) VALUES (?, ?, ?, ?, ?, ?)',
        uid, date, batch!.assigned_count + index, item.id, item.rankScore, item.explore ? 1 : 0,
      ));
      if (items.length) {
        q.run('UPDATE daily_recommendation_batches SET assigned_count = ? WHERE user_id = ? AND day = ?', batch.assigned_count + items.length, uid, date);
        batch = { assigned_count: batch.assigned_count + items.length, empty_state: batch.empty_state };
      } else if (generated.emptyState !== batch.empty_state && batch.assigned_count === 0) {
        q.run('UPDATE daily_recommendation_batches SET empty_state = ? WHERE user_id = ? AND day = ?', generated.emptyState, uid, date);
        batch = { ...batch, empty_state: generated.emptyState };
      }
    }
    const items = q.all<{ target_id: number; rank_score: number; explore: number }>(
      'SELECT target_id, rank_score, explore FROM daily_recommendation_items WHERE user_id = ? AND day = ? AND target_id IS NOT NULL ORDER BY position', uid, date,
    ).map((item) => ({ id: item.target_id, rankScore: item.rank_score, explore: !!item.explore }));
    db.exec('COMMIT');
    return { ...batch, items };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

registerAccountCleanup((uid) => {
  q.run('DELETE FROM daily_recommendation_batches WHERE user_id = ?', uid);
  // 保留对方已使用的名额，清除注销账号的引用。
  q.run('UPDATE daily_recommendation_items SET target_id = NULL WHERE target_id = ?', uid);
});
