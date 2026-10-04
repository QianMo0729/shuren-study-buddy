// 滑卡反馈、互相感兴趣后的配对与私聊消息的数据层。
// 业务规则（推荐排序、个性化学习、私聊接口）分别在 server/matching.ts、server/learning.ts、server/routes/chat.ts。
import type { FeedbackAction, MatchState } from '../shared/types.ts';
import './connections.ts';
import { db, getSetting, q, setSetting, tx } from './db.ts';
import { registerAccountCleanup } from './social.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS match_feedback (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('like', 'dislike', 'skip')),
  -- 反馈当时的特征快照（JSON），供个性化模型训练
  features TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, target_id),
  CHECK (user_id <> target_id)
);
CREATE INDEX IF NOT EXISTS idx_feedback_target ON match_feedback(target_id, action);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed')),
  closed_by INTEGER,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT,
  CHECK (user_a < user_b)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_pair ON matches(user_a, user_b);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'text' CHECK(kind IN ('text', 'system')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id, id);

CREATE TABLE IF NOT EXISTS message_reads (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS preference_models (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  weights TEXT NOT NULL,
  samples INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export interface MatchRow {
  id: number;
  user_a: number;
  user_b: number;
  status: 'active' | 'closed';
  closed_by: number | null;
  closed_at: string | null;
  created_at: string;
  last_message_at: string | null;
}

export interface FeedbackRow {
  user_id: number;
  target_id: number;
  action: FeedbackAction;
  features: string;
  created_at: string;
  updated_at: string;
}

const pair = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);
export const otherOf = (m: MatchRow, uid: number) => (m.user_a === uid ? m.user_b : m.user_a);

export function matchBetween(a: number, b: number): MatchRow | undefined {
  const [x, y] = pair(a, b);
  return q.get<MatchRow>('SELECT * FROM matches WHERE user_a = ? AND user_b = ?', x, y);
}

export function activeMatchBetween(a: number, b: number): MatchRow | undefined {
  const m = matchBetween(a, b);
  return m?.status === 'active' ? m : undefined;
}

/** 仅当 userId 是该配对的一方时返回 */
export function matchForUser(matchId: number, userId: number): MatchRow | undefined {
  const m = q.get<MatchRow>('SELECT * FROM matches WHERE id = ?', matchId);
  return m && (m.user_a === userId || m.user_b === userId) ? m : undefined;
}

export function feedbackOf(userId: number, targetId: number): FeedbackRow | undefined {
  return q.get<FeedbackRow>('SELECT * FROM match_feedback WHERE user_id = ? AND target_id = ?', userId, targetId);
}

export function addSystemMessage(matchId: number, body: string) {
  q.run("INSERT INTO messages (match_id, sender_id, kind, body) VALUES (?, NULL, 'system', ?)", matchId, body);
  q.run("UPDATE matches SET last_message_at = datetime('now') WHERE id = ?", matchId);
}

/**
 * 双方都已“感兴趣”时创建（或重新开启）配对。
 * created 只在这对同学第一次配对时为 true；重新开启已关闭的配对不算新配对，调用方不应再次通知或发邮件。
 */
function ensureMatch(a: number, b: number): { match: MatchRow; created: boolean } {
  const existing = matchBetween(a, b);
  if (existing?.status === 'active') return { match: existing, created: false };
  if (existing) {
    q.run("UPDATE matches SET status = 'active', closed_by = NULL, closed_at = NULL WHERE id = ?", existing.id);
    addSystemMessage(existing.id, '你们再次互相感兴趣，可以继续聊天了。如需联系方式，请重新申请交换。');
    return { match: matchBetween(a, b)!, created: false };
  }
  const [x, y] = pair(a, b);
  const id = Number(q.run('INSERT INTO matches (user_a, user_b) VALUES (?, ?)', x, y).lastInsertRowid);
  addSystemMessage(id, '你们互相感兴趣啦！先打个招呼，聊聊学习目标和时间安排。确认合适后，再决定是否交换联系方式。');
  return { match: q.get<MatchRow>('SELECT * FROM matches WHERE id = ?', id)!, created: true };
}

/**
 * 记录（或改写）一次反馈。like 且对方也 like 过我时，自动建立配对。
 * 不发送通知与邮件，由调用方决定。
 */
export function recordFeedback(
  userId: number,
  targetId: number,
  action: FeedbackAction,
  features: Record<string, number> = {},
): { matched: boolean; matchId: number | null; newlyMatched: boolean } {
  if (userId === targetId) throw new Error('cannot give feedback to self');
  return tx(() => {
    q.run(
      `INSERT INTO match_feedback (user_id, target_id, action, features) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, target_id) DO UPDATE SET action = excluded.action, features = excluded.features, updated_at = datetime('now')`,
      userId, targetId, action, JSON.stringify(features),
    );
    if (action !== 'like') {
      // 对已配对的人改为不感兴趣/跳过，视为解除配对
      const active = activeMatchBetween(userId, targetId);
      if (active) closeMatch(active.id, userId);
      return { matched: false, matchId: null, newlyMatched: false };
    }
    const theirs = feedbackOf(targetId, userId);
    if (theirs?.action !== 'like') return { matched: false, matchId: null, newlyMatched: false };
    const { match, created } = ensureMatch(userId, targetId);
    return { matched: true, matchId: match.id, newlyMatched: created };
  });
}

/** 撤销反馈（例如在设置里把“不感兴趣”的同学放回推荐池）；不会解除已有配对 */
export function removeFeedback(userId: number, targetId: number) {
  q.run('DELETE FROM match_feedback WHERE user_id = ? AND target_id = ?', userId, targetId);
}

/**
 * 关闭配对（解除匹配）。关闭者的反馈改为 dislike，避免再次被推荐；
 * 特征快照清空——这次 dislike 不是在推荐卡片上做出的选择，个性化模型没有学习它，以后撤销时也不应反向学习。
 * 交换联系方式的同意随配对一起失效（待处理与已同意的申请被删除；被拒绝的记录保留，7 天冷却仍然有效），
 * 重新配对后需要重新申请。
 */
export function closeMatch(matchId: number, closedBy: number) {
  const m = q.get<MatchRow>('SELECT * FROM matches WHERE id = ?', matchId);
  if (!m || m.status === 'closed') return;
  q.run("UPDATE matches SET status = 'closed', closed_by = ?, closed_at = datetime('now') WHERE id = ?", closedBy, matchId);
  if (m.user_a === closedBy || m.user_b === closedBy) {
    q.run(
      `INSERT INTO match_feedback (user_id, target_id, action, features) VALUES (?, ?, 'dislike', '{}')
       ON CONFLICT(user_id, target_id) DO UPDATE SET action = 'dislike', features = '{}', updated_at = datetime('now')`,
      closedBy, otherOf(m, closedBy),
    );
  }
  q.run(
    `DELETE FROM contact_requests WHERE status <> 'rejected'
     AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))`,
    m.user_a, m.user_b, m.user_b, m.user_a,
  );
  addSystemMessage(matchId, '配对已解除，聊天已关闭。');
}

export function matchStateFor(viewerId: number, targetId: number): { state: MatchState; matchId: number | null } {
  if (viewerId === targetId) return { state: 'none', matchId: null };
  const active = activeMatchBetween(viewerId, targetId);
  if (active) return { state: 'matched', matchId: active.id };
  const fb = feedbackOf(viewerId, targetId);
  const state: MatchState = fb ? ({ like: 'liked', dislike: 'disliked', skip: 'skipped' } as const)[fb.action] : 'none';
  return { state, matchId: null };
}

/** 对方发来且未读的消息数（含已关闭但仍在私聊列表中的配对；互相排除的配对不计），与私聊列表的未读数一致 */
export function unreadMessageCount(userId: number): number {
  return q.get<{ n: number }>(
    `SELECT COUNT(*) n FROM messages m
     JOIN matches x ON x.id = m.match_id AND (x.user_a = ? OR x.user_b = ?)
     LEFT JOIN message_reads r ON r.match_id = m.match_id AND r.user_id = ?
     WHERE m.kind = 'text' AND m.sender_id IS NOT NULL AND m.sender_id <> ? AND m.id > COALESCE(r.last_read_id, 0)
       AND NOT EXISTS (SELECT 1 FROM exclusions e WHERE (e.user_id = x.user_a AND e.target_id = x.user_b) OR (e.user_id = x.user_b AND e.target_id = x.user_a))`,
    userId, userId, userId, userId,
  )!.n;
}

registerAccountCleanup((uid) => {
  q.run('DELETE FROM match_feedback WHERE user_id = ? OR target_id = ?', uid, uid);
  q.run('DELETE FROM matches WHERE user_a = ? OR user_b = ?', uid, uid);
  q.run('DELETE FROM message_reads WHERE user_id = ?', uid);
  q.run('DELETE FROM preference_models WHERE user_id = ?', uid);
});

// 旧版“联系申请”迁移（只执行一次）：申请视为发起方感兴趣；已接受的申请视为双方感兴趣并建立配对。
// v3 起私聊中的交换申请也写入 contact_requests，因此绝不能在每次启动时重复转换——否则用户撤销或关闭后的选择会被恢复。
const MIGRATION_KEY = 'migrated_contact_requests_v3';
if (!getSetting(MIGRATION_KEY, '')) {
  tx(() => {
    for (const r of q.all<{ requester_id: number; recipient_id: number; status: string }>('SELECT requester_id, recipient_id, status FROM contact_requests')) {
      q.run("INSERT OR IGNORE INTO match_feedback (user_id, target_id, action) VALUES (?, ?, 'like')", r.requester_id, r.recipient_id);
      if (r.status === 'accepted') {
        q.run("INSERT OR IGNORE INTO match_feedback (user_id, target_id, action) VALUES (?, ?, 'like')", r.recipient_id, r.requester_id);
        if (!matchBetween(r.requester_id, r.recipient_id)) {
          const [x, y] = pair(r.requester_id, r.recipient_id);
          const id = Number(q.run('INSERT INTO matches (user_a, user_b) VALUES (?, ?)', x, y).lastInsertRowid);
          addSystemMessage(id, '你们此前已同意交换联系方式，现在也可以在这里聊天。');
        }
      }
    }
    setSetting(MIGRATION_KEY, new Date().toISOString());
  });
}
