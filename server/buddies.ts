// 搭子绑定：邀请、接受、拒绝、撤回、解绑，以及配对关闭、注销时自动解绑。
// 规则：一对一；双方确认才生效；从下一个完整自然周（周一）开始计分；任一方可随时解绑，解绑后组合积分清零。
import { addDays, beijingDay, mondayOf, shortDate, weekdayLabel } from '../shared/activity.ts';
import type { ShurenMember } from '../shared/types.ts';
import { HttpError } from './auth.ts';
import { activityConfig } from './activityConfig.ts';
import {
  type InviteRow, type PairRow, activePairBetween, activePairOf, partnerOf, pendingInvite, setShuren, shurenOf,
} from './buddyState.ts';
import { isContactEligible, isExcluded } from './connections.ts';
import { q, tx } from './db.ts';
import { activeMatchBetween, addSystemMessage, onMatchClosed, openMatch } from './matches.ts';
import { notify } from './notify.ts';
import { touchScores } from './scoring.ts';
import { getProfileRow } from './profiles.ts';
import { registerAccountCleanup } from './social.ts';

/** 每人同时最多发出的待处理邀请 */
export const MAX_OUTGOING_INVITES = 3;
/** 被拒绝后多久才能再次邀请同一位同学 */
const REINVITE_HOURS = 24;

const nicknameOf = (uid: number) => getProfileRow(uid)?.nickname ?? '同学';

/** 绑定后第一个计分日：下一个周一；赛季还没开始时为赛季第一天 */
export function startsOnFor(now = new Date()): string {
  const next = addDays(mondayOf(beijingDay(now)), 7);
  const { seasonStart } = activityConfig();
  return next < seasonStart ? seasonStart : next;
}

export function inviteById(id: number): InviteRow | undefined {
  return q.get<InviteRow>('SELECT * FROM buddy_invites WHERE id = ?', id);
}

/** 本人还没有回答是否为树仁学生时，要求在邀请或接受时一起回答 */
function ensureShuren(uid: number, answer: unknown) {
  if (answer === 'yes' || answer === 'no') setShuren(uid, answer as ShurenMember);
  if (!shurenOf(uid)) throw new HttpError(400, '请先说明你是否为树仁书院学生', { needShuren: true });
}

function assertCanBind(uid: number, other: number) {
  if (uid === other) throw new HttpError(400, '不能和自己绑定');
  if (isExcluded(uid, other) || !isContactEligible(other)) throw new HttpError(404, '该主页暂不可用');
  if (!isContactEligible(uid)) throw new HttpError(403, '请先完成问卷、发布主页并确认隐私同意，再绑定搭子');
  if (activePairOf(uid)) throw new HttpError(409, '你已经有搭子了。如需更换，请先在「我的」里解除绑定');
  if (activePairOf(other)) throw new HttpError(409, '对方已经有搭子了');
}

/** 发出邀请。已有待处理的同向邀请时直接返回它；对方已经邀请了我时提示去接受 */
export function invite(from: number, to: number, shuren?: unknown): InviteRow {
  assertCanBind(from, to);
  ensureShuren(from, shuren);
  const existing = pendingInvite(from, to);
  if (existing) return existing;
  const reverse = pendingInvite(to, from);
  if (reverse) throw new HttpError(409, '对方已经邀请了你，直接接受就可以', { incomingInviteId: reverse.id });
  const declined = q.get<{ responded_at: string }>(
    "SELECT responded_at FROM buddy_invites WHERE from_id = ? AND to_id = ? AND status = 'declined' ORDER BY id DESC LIMIT 1", from, to,
  );
  if (declined && Date.parse(`${declined.responded_at.replace(' ', 'T')}Z`) > Date.now() - REINVITE_HOURS * 3600_000) {
    throw new HttpError(409, '对方刚刚婉拒了邀请，明天再试吧');
  }
  const outgoing = q.get<{ n: number }>("SELECT COUNT(*) n FROM buddy_invites WHERE from_id = ? AND status = 'pending'", from)!.n;
  if (outgoing >= MAX_OUTGOING_INVITES) throw new HttpError(429, `最多同时邀请 ${MAX_OUTGOING_INVITES} 位同学，请先撤回一个邀请或等待回应`);
  return tx(() => {
    const id = Number(q.run('INSERT INTO buddy_invites (from_id, to_id) VALUES (?, ?)', from, to).lastInsertRowid);
    const match = activeMatchBetween(from, to);
    const name = nicknameOf(from);
    if (match) addSystemMessage(match.id, `${name} 邀请你成为学习搭子。`);
    notify(to, '收到搭子邀请', `${name} 邀请你成为学习搭子。接受后你们会一起参加打卡积分活动。`, match ? `/messages/${match.id}` : `/u/${from}`);
    return inviteById(id)!;
  });
}

/** 接受邀请：建立绑定，作废双方其他待处理的邀请，并开启（或重新开启）私聊 */
export function accept(inviteId: number, uid: number, shuren?: unknown): { pair: PairRow; matchId: number } {
  const row = inviteById(inviteId);
  if (!row || row.to_id !== uid) throw new HttpError(404, '邀请不存在');
  if (row.status !== 'pending') throw new HttpError(409, '这个邀请已经处理过了');
  assertCanBind(uid, row.from_id);
  ensureShuren(uid, shuren);
  return tx(() => {
    const startsOn = startsOnFor();
    const [a, b] = row.from_id < uid ? [row.from_id, uid] : [uid, row.from_id];
    const pairId = Number(q.run('INSERT INTO buddy_pairs (user_a, user_b, starts_on) VALUES (?, ?, ?)', a, b, startsOn).lastInsertRowid);
    q.run("UPDATE buddy_invites SET status = 'accepted', responded_at = datetime('now') WHERE id = ?", inviteId);
    q.run(
      `UPDATE buddy_invites SET status = 'cancelled', responded_at = datetime('now')
       WHERE status = 'pending' AND (from_id IN (?, ?) OR to_id IN (?, ?))`, a, b, a, b,
    );
    const { match } = openMatch(a, b);
    addSystemMessage(match.id, `你们已绑定为学习搭子，从 ${shortDate(startsOn)}（${weekdayLabel(startsOn)}）起计分。约好时间，30 分钟内各自拍照打卡就算一次。`);
    touchScores();
    notify(row.from_id, '搭子邀请已接受', `${nicknameOf(uid)} 接受了你的邀请，你们从 ${shortDate(startsOn)} 起开始计分。`, `/messages/${match.id}`);
    return { pair: activePairBetween(a, b)!, matchId: match.id };
  });
}

export function decline(inviteId: number, uid: number) {
  const row = inviteById(inviteId);
  if (!row || row.to_id !== uid) throw new HttpError(404, '邀请不存在');
  if (row.status !== 'pending') return;
  q.run("UPDATE buddy_invites SET status = 'declined', responded_at = datetime('now') WHERE id = ?", inviteId);
  notify(row.from_id, '搭子邀请未被接受', `${nicknameOf(uid)} 暂时没有接受你的搭子邀请。`, null);
}

export function cancelInvite(inviteId: number, uid: number) {
  const row = inviteById(inviteId);
  if (!row || row.from_id !== uid) throw new HttpError(404, '邀请不存在');
  if (row.status !== 'pending') return;
  q.run("UPDATE buddy_invites SET status = 'cancelled', responded_at = datetime('now') WHERE id = ?", inviteId);
}

/** 结束绑定。notifyOther：要通知的另一方（解绑人自己不需要通知） */
function endPair(pair: PairRow, by: number | null, reason: 'unbind' | 'match_closed' | 'account', message: string | null, notifyOther: number | null) {
  q.run(
    "UPDATE buddy_pairs SET status = 'ended', ended_at = datetime('now'), ended_by = ?, end_reason = ? WHERE id = ? AND status = 'active'",
    by, reason, pair.id,
  );
  touchScores();
  const match = activeMatchBetween(pair.user_a, pair.user_b);
  if (match && message) addSystemMessage(match.id, message);
  if (notifyOther !== null) {
    notify(notifyOther, '搭子绑定已解除', '你们的搭子积分已清零。可以在「我的」里邀请新的搭子，新的绑定从下一个周一开始计分。', '/me');
  }
}

/** 主动解绑：立即生效，双方的组合积分清零 */
export function unbind(uid: number) {
  const pair = activePairOf(uid);
  if (!pair) throw new HttpError(404, '你现在没有绑定搭子');
  tx(() => endPair(pair, uid, 'unbind', `${nicknameOf(uid)} 解除了搭子绑定，搭子积分已清零。`, partnerOf(pair, uid)));
}

// 解除配对、排除或改选「不感兴趣」会关闭配对：搭子绑定随之解除，通知另一方（不说明原因）
onMatchClosed((match, closedBy) => {
  const pair = activePairBetween(match.user_a, match.user_b);
  if (!pair) return;
  const other = closedBy === pair.user_a ? pair.user_b : closedBy === pair.user_b ? pair.user_a : null;
  endPair(pair, closedBy, 'match_closed', null, other);
  if (other === null) {
    notify(pair.user_a, '搭子绑定已解除', '你们的搭子积分已清零。', '/me');
    notify(pair.user_b, '搭子绑定已解除', '你们的搭子积分已清零。', '/me');
  }
});

registerAccountCleanup((uid) => {
  const pair = activePairOf(uid);
  if (pair) endPair(pair, uid, 'account', null, partnerOf(pair, uid));
  q.run("UPDATE buddy_invites SET status = 'cancelled', responded_at = datetime('now') WHERE status = 'pending' AND (from_id = ? OR to_id = ?)", uid, uid);
  q.run('DELETE FROM activity_members WHERE user_id = ?', uid);
  q.run('DELETE FROM device_seen WHERE user_id = ?', uid);
});
