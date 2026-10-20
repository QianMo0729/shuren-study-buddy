import { Router } from 'express';
import { beijingDay } from '../../shared/activity.ts';
import { hasPrivacyConsent } from '../../shared/profileRules.ts';
import type { BuddyPartner, BuddyStatus, LeaderboardResponse } from '../../shared/types.ts';
import { HttpError, rateLimit, requireUser } from '../auth.ts';
import { activityConfig, seasonInfo } from '../activityConfig.ts';
import { createAppeal } from '../audits.ts';
import { accept, cancelInvite, decline, invite, unbind } from '../buddies.ts';
import { activePairOf, partnerOf, setShuren, shurenOf } from '../buddyState.ts';
import { isExcluded } from '../connections.ts';
import { iso, q } from '../db.ts';
import { activeMatchBetween } from '../matches.ts';
import { getProfileRow, parseData } from '../profiles.ts';
import { currentWeek, ineligibleReason, leaderboard } from '../scoring.ts';

// 搭子打卡活动：规则参数（公开）、我的搭子、邀请与解绑、搭子榜、打卡申诉
export const activityRouter = Router();

function idOf(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, '没有找到');
  return id;
}

/** 搭子的昵称与封面；与我互相排除的同学只显示「同学」 */
export function buddyPartner(id: number, viewerId: number): BuddyPartner {
  if (id !== viewerId && isExcluded(id, viewerId)) return { id: 0, nickname: '同学', cover: null };
  const row = getProfileRow(id);
  if (!row) return { id, nickname: '已注销的同学', cover: null };
  const d = parseData(row);
  const visible = !!row.published && !row.taken_down && hasPrivacyConsent(d) && d.photoVisibility === 'public';
  return { id, nickname: row.nickname, cover: visible ? d.photos[0] ?? null : null };
}

/** 规则页、打卡页读取的参数，不需要登录 */
activityRouter.get('/config', (_req, res) => {
  res.json({ config: activityConfig(), season: seasonInfo() });
});

activityRouter.use(requireUser);

function statusOf(uid: number): BuddyStatus {
  const pair = activePairOf(uid);
  const invites = q.all<{ id: number; from_id: number; to_id: number; created_at: string }>(
    "SELECT id, from_id, to_id, created_at FROM buddy_invites WHERE status = 'pending' AND (from_id = ? OR to_id = ?) ORDER BY id DESC", uid, uid,
  ).filter((row) => !isExcluded(row.from_id, row.to_id)).map((row) => {
    const outgoing = row.from_id === uid;
    return { id: row.id, direction: outgoing ? 'outgoing' as const : 'incoming' as const, other: buddyPartner(outgoing ? row.to_id : row.from_id, uid), createdAt: iso(row.created_at)! };
  });
  let rank: BuddyStatus['rank'] = null;
  if (pair) {
    const board = leaderboard();
    const mine = board.items.find((item) => item.pair.id === pair.id);
    if (mine) rank = { rank: mine.rank, tied: mine.tied, total: board.items.length };
  }
  const partnerId = pair ? partnerOf(pair, uid) : 0;
  return {
    pair: pair ? {
      id: pair.id,
      partner: buddyPartner(partnerId, uid),
      createdAt: iso(pair.created_at)!,
      startsOn: pair.starts_on,
      started: beijingDay() >= pair.starts_on,
      matchId: activeMatchBetween(uid, partnerId)?.id ?? null,
      ineligible: ineligibleReason(pair),
    } : null,
    invites,
    week: pair ? currentWeek(pair) : null,
    rank,
    shurenMember: shurenOf(uid),
    season: seasonInfo(),
  };
}

activityRouter.get('/me', (req, res) => {
  res.json(statusOf(req.user!.id));
});

activityRouter.put('/college', (req, res) => {
  const value = req.body?.shurenMember;
  if (value !== 'yes' && value !== 'no') throw new HttpError(400, '请选择是否为树仁书院学生');
  setShuren(req.user!.id, value);
  res.json(statusOf(req.user!.id));
});

activityRouter.post('/invites', (req, res) => {
  const uid = req.user!.id;
  rateLimit(`buddy-invite:${uid}`, 10, 24 * 3600_000);
  invite(uid, idOf(req.body?.userId), req.body?.shurenMember);
  res.json(statusOf(uid));
});

activityRouter.post('/invites/:id/accept', (req, res) => {
  const uid = req.user!.id;
  const { matchId } = accept(idOf(req.params.id), uid, req.body?.shurenMember);
  res.json({ ...statusOf(uid), matchId });
});

activityRouter.post('/invites/:id/decline', (req, res) => {
  decline(idOf(req.params.id), req.user!.id);
  res.json(statusOf(req.user!.id));
});

activityRouter.delete('/invites/:id', (req, res) => {
  cancelInvite(idOf(req.params.id), req.user!.id);
  res.json(statusOf(req.user!.id));
});

activityRouter.post('/unbind', (req, res) => {
  unbind(req.user!.id);
  res.json(statusOf(req.user!.id));
});

/** 搭子榜：只显示名次与两人的昵称，不显示分数 */
activityRouter.get('/leaderboard', (req, res) => {
  const uid = req.user!.id;
  rateLimit(`leaderboard:${uid}`, 60, 60_000);
  const board = leaderboard();
  const body: LeaderboardResponse = {
    through: board.through,
    season: seasonInfo(),
    items: board.items.map((item) => ({
      rank: item.rank,
      tied: item.tied,
      members: [buddyPartner(item.pair.user_a, uid), buddyPartner(item.pair.user_b, uid)],
      mine: item.pair.user_a === uid || item.pair.user_b === uid,
    })),
  };
  res.json(body);
});

activityRouter.post('/appeals', (req, res) => {
  const uid = req.user!.id;
  rateLimit(`appeal:${uid}`, 10, 24 * 3600_000);
  createAppeal(uid, idOf(req.body?.checkinId), req.body?.body);
  res.json({ ok: true });
});

