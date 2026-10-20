// 搭子绑定的只读查询。只依赖数据层，主页、私聊、推荐都可以直接引用，不会形成循环依赖。
// 绑定、解绑等操作在 server/buddies.ts。
import type { BuddyRelation, ShurenMember } from '../shared/types.ts';
import './activityTables.ts';
import { isContactEligible } from './connections.ts';
import { q } from './db.ts';

export interface PairRow {
  id: number;
  user_a: number;
  user_b: number;
  status: 'active' | 'ended';
  starts_on: string;
  created_at: string;
  ended_at: string | null;
  ended_by: number | null;
  end_reason: string | null;
}

export interface InviteRow {
  id: number;
  from_id: number;
  to_id: number;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  created_at: string;
  responded_at: string | null;
}

export const partnerOf = (pair: Pick<PairRow, 'user_a' | 'user_b'>, uid: number) => (pair.user_a === uid ? pair.user_b : pair.user_a);

export function activePairOf(uid: number): PairRow | undefined {
  return q.get<PairRow>("SELECT * FROM buddy_pairs WHERE status = 'active' AND (user_a = ? OR user_b = ?) ORDER BY id DESC LIMIT 1", uid, uid);
}

export function activePairBetween(a: number, b: number): PairRow | undefined {
  return q.get<PairRow>("SELECT * FROM buddy_pairs WHERE status = 'active' AND user_a = ? AND user_b = ?", Math.min(a, b), Math.max(a, b));
}

export function pairById(id: number): PairRow | undefined {
  return q.get<PairRow>('SELECT * FROM buddy_pairs WHERE id = ?', id);
}

export const hasActiveBuddy = (uid: number) => !!activePairOf(uid);

/** 所有已经绑定搭子的同学，推荐时不再推给别人 */
export function boundUserIds(): Set<number> {
  const ids = new Set<number>();
  for (const row of q.all<{ user_a: number; user_b: number }>("SELECT user_a, user_b FROM buddy_pairs WHERE status = 'active'")) {
    ids.add(row.user_a);
    ids.add(row.user_b);
  }
  return ids;
}

export function pendingInvite(from: number, to: number): InviteRow | undefined {
  return q.get<InviteRow>("SELECT * FROM buddy_invites WHERE from_id = ? AND to_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1", from, to);
}

/** 当前用户与另一位同学的搭子关系 */
export function relationBetween(viewerId: number, otherId: number): BuddyRelation {
  const mine = activePairOf(viewerId);
  const theirs = activePairOf(otherId);
  if (mine && theirs && mine.id === theirs.id) return { state: 'bound', inviteId: null, otherHasBuddy: false, iHaveBuddy: false };
  const base = { iHaveBuddy: !!mine, otherHasBuddy: !!theirs };
  if (viewerId === otherId) return { state: 'unavailable', inviteId: null, ...base };
  const outgoing = pendingInvite(viewerId, otherId);
  if (outgoing) return { state: 'outgoing', inviteId: outgoing.id, ...base };
  const incoming = pendingInvite(otherId, viewerId);
  if (incoming) return { state: 'incoming', inviteId: incoming.id, ...base };
  if (mine || theirs || !isContactEligible(viewerId) || !isContactEligible(otherId)) return { state: 'unavailable', inviteId: null, ...base };
  return { state: 'none', inviteId: null, ...base };
}

export function shurenOf(uid: number): ShurenMember | null {
  return q.get<{ shuren: ShurenMember }>('SELECT shuren FROM activity_members WHERE user_id = ?', uid)?.shuren ?? null;
}

export function setShuren(uid: number, value: ShurenMember) {
  q.run(
    `INSERT INTO activity_members (user_id, shuren) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET shuren = excluded.shuren, updated_at = datetime('now')`,
    uid, value,
  );
}

export const isDisqualified = (uid: number) => !!q.get('SELECT 1 FROM activity_disqualified WHERE user_id = ?', uid);
