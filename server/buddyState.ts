// 搭子绑定的只读查询。只依赖数据层，主页、私聊、推荐都可以直接引用，不会形成循环依赖。
// 绑定、解绑等操作在 server/buddies.ts。
import { isShurenStudentId } from '../shared/activity.ts';
import type { BuddyRelation, ShurenMember } from '../shared/types.ts';
import './activityTables.ts';
import { isContactEligible, isExcluded } from './connections.ts';
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
  /** 两人各自是否同意在主页上公开「我们是搭子」 */
  show_a: number;
  show_b: number;
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

/**
 * 主页上公开的搭子：两人都同意公开，且搭子的主页对这位访客可见（已发布、未被撤下、彼此没有互相排除）时才返回。
 * 否则为 null，主页上只显示「已有搭子」。
 */
export function publicBuddyOf(uid: number, viewerId: number): { id: number; nickname: string } | null {
  const pair = activePairOf(uid);
  if (!pair || !pair.show_a || !pair.show_b) return null;
  const partnerId = partnerOf(pair, uid);
  if (partnerId !== viewerId && isExcluded(partnerId, viewerId)) return null;
  const row = q.get<{ nickname: string }>(
    `SELECT p.nickname FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE p.user_id = ? AND p.published = 1 AND p.taken_down = 0 AND u.activated = 1 AND u.password_hash IS NOT NULL`, partnerId,
  );
  return row ? { id: partnerId, nickname: row.nickname } : null;
}

/** 登录邮箱里的学号 */
export const studentIdOf = (uid: number) => q.get<{ email: string }>('SELECT email FROM users WHERE id = ?', uid)?.email.split('@')[0] ?? '';

/**
 * 是否为树仁书院学生：只按登录邮箱里的学号号段判断（shared/activity.ts 的 SHUREN_CLASS_RANGE：前六位 1xx126–1xx130），号段以外的都是「否」。
 * 本人填写的答案和导入的书院名单都不再参与判断。
 */
export const shurenOf = (uid: number): ShurenMember => (isShurenStudentId(studentIdOf(uid)) ? 'yes' : 'no');

export const isDisqualified = (uid: number) => !!q.get('SELECT 1 FROM activity_disqualified WHERE user_id = ?', uid);
