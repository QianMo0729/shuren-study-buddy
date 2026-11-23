// Bonus：已绑定搭子的同学在聊天区发「学习分享」帖时申请，审核人员通过后给组合加分。
// 每个组合每周最多申请 bonusWeeklyMax 次，整个赛季最多加 bonusSeasonMax 分（见 shared/activity.ts）。
import { BONUS_MIN_CHARS, BONUS_MIN_CHARS_WITH_IMAGE, beijingDay, captionLength, mondayOf, shortDate } from '../shared/activity.ts';
import type { BonusState } from '../shared/types.ts';
import { HttpError } from './auth.ts';
import { activityConfig } from './activityConfig.ts';
import { activePairOf, pairById, partnerOf } from './buddyState.ts';
import { q, tx } from './db.ts';
import { notify } from './notify.ts';
import { scoringStart, touchScores } from './scoring.ts';

export interface ClaimRow {
  id: number;
  post_id: number;
  pair_id: number;
  user_id: number;
  week: string;
  status: BonusState['status'];
  points: number;
  reason: string | null;
  reviewer_id: number | null;
  reviewed_at: string | null;
  created_at: string;
}

export function bonusContentError(body: string, images: string[]): string | null {
  const chars = captionLength(body);
  if (chars >= BONUS_MIN_CHARS) return null;
  if (chars >= BONUS_MIN_CHARS_WITH_IMAGE && images.length > 0) return null;
  return `申请 Bonus 的学习分享需要正文不少于 ${BONUS_MIN_CHARS} 字，或不少于 ${BONUS_MIN_CHARS_WITH_IMAGE} 字并附至少 1 张笔记图（现在 ${chars} 字）`;
}

const approvedPoints = (pairId: number) =>
  q.get<{ n: number | null }>("SELECT SUM(points) n FROM bonus_claims WHERE pair_id = ? AND status = 'approved'", pairId)!.n ?? 0;

/** 发帖时申请 Bonus；与发帖在同一个事务里，任何一项不满足都不会发出帖子 */
export function createClaim(uid: number, postId: number, body: string, images: string[], now = new Date()) {
  const config = activityConfig();
  const pair = activePairOf(uid);
  if (!pair) throw new HttpError(400, '绑定搭子之后才能申请 Bonus');
  const today = beijingDay(now);
  if (today < config.seasonStart || today > config.seasonEnd) throw new HttpError(400, '现在不在活动赛季内，暂时不能申请 Bonus');
  const start = scoringStart(pair, config);
  if (today < start) throw new HttpError(400, `你们从 ${shortDate(start)} 开始计分，那之后再申请 Bonus`);
  const contentError = bonusContentError(body, images);
  if (contentError) throw new HttpError(400, contentError);
  const week = mondayOf(today);
  const thisWeek = q.get<{ n: number }>(
    "SELECT COUNT(*) n FROM bonus_claims WHERE pair_id = ? AND week = ? AND status IN ('pending', 'approved')", pair.id, week,
  )!.n;
  if (thisWeek >= config.bonusWeeklyMax) throw new HttpError(409, `每个组合每周最多申请 ${config.bonusWeeklyMax} 次 Bonus，本周已经申请过了`);
  if (approvedPoints(pair.id) >= config.bonusSeasonMax) throw new HttpError(409, '你们本赛季的 Bonus 已经加满了');
  q.run('INSERT INTO bonus_claims (post_id, pair_id, user_id, week) VALUES (?, ?, ?, ?)', postId, pair.id, uid, week);
}

export function claimOfPost(postId: number): ClaimRow | undefined {
  return q.get<ClaimRow>('SELECT * FROM bonus_claims WHERE post_id = ?', postId);
}

/** 批量读取帖子的 Bonus 申请 */
export function claimsOfPosts(postIds: number[]): Map<number, ClaimRow> {
  if (!postIds.length) return new Map();
  const marks = postIds.map(() => '?').join(',');
  return new Map(q.all<ClaimRow>(`SELECT * FROM bonus_claims WHERE post_id IN (${marks})`, ...postIds).map((row) => [row.post_id, row]));
}

/** 已通过的学习分享不能再修改；审核中的修改后要重新满足字数要求 */
export function assertPostEditable(postId: number, body: string, images: string[]) {
  const claim = claimOfPost(postId);
  if (!claim) return;
  if (claim.status === 'approved') throw new HttpError(409, '已通过 Bonus 审核的学习分享不能再修改');
  if (claim.status === 'pending') {
    const error = bonusContentError(body, images);
    if (error) throw new HttpError(400, error);
  }
}

/** 删除帖子时撤回还在审核中的申请（已通过的分数保留） */
export function withdrawClaimOfPost(postId: number) {
  q.run("UPDATE bonus_claims SET status = 'withdrawn' WHERE post_id = ? AND status = 'pending'", postId);
}

export function decideClaim(claimId: number, staffId: number, decision: unknown, reason: unknown) {
  if (decision !== 'approve' && decision !== 'reject') throw new HttpError(400, '请选择通过或不通过');
  const text = typeof reason === 'string' ? reason.trim().slice(0, 200) : '';
  if (decision === 'reject' && !text) throw new HttpError(400, '请写明不通过的原因');
  const claim = q.get<ClaimRow>('SELECT * FROM bonus_claims WHERE id = ?', claimId);
  if (!claim) throw new HttpError(404, '申请不存在');
  if (claim.status !== 'pending') throw new HttpError(409, '这条申请已经处理过了');
  const pair = pairById(claim.pair_id);
  if (!pair || pair.status !== 'active') throw new HttpError(409, '这对搭子已经解绑，申请作废');
  const config = activityConfig();
  const room = Math.max(0, config.bonusSeasonMax - approvedPoints(pair.id));
  const points = decision === 'approve' ? Math.min(config.bonusPoints, room) : 0;
  const status = decision === 'approve' && points > 0 ? 'approved' : 'rejected';
  const finalReason = status === 'rejected' ? (text || '本赛季 Bonus 已达上限') : null;
  tx(() => {
    q.run(
      "UPDATE bonus_claims SET status = ?, points = ?, reason = ?, reviewer_id = ?, reviewed_at = datetime('now') WHERE id = ?",
      status, points, finalReason, staffId, claimId,
    );
    const title = q.get<{ title: string; body: string }>('SELECT title, body FROM forum_posts WHERE id = ?', claim.post_id);
    const label = title?.title || (title?.body ?? '').slice(0, 20) || '学习分享';
    q.run(
      "INSERT INTO moderation_logs (admin_id, action, target_type, target_id, target_user_id, target_label, reason) VALUES (?, ?, 'forum_post', ?, ?, ?, ?)",
      staffId, status === 'approved' ? 'bonus_approve' : 'bonus_reject', claim.post_id, claim.user_id, label, finalReason ?? '',
    );
    for (const uid of [claim.user_id, partnerOf(pair, claim.user_id)]) {
      notify(
        uid,
        status === 'approved' ? '学习分享获得 Bonus' : '学习分享的 Bonus 未通过',
        status === 'approved' ? `「${label}」通过审核，你们的搭子积分增加了。` : `「${label}」未通过 Bonus 审核：${finalReason}`,
        `/community/posts/${claim.post_id}`,
      );
    }
  });
  touchScores();
  return { status, points };
}
