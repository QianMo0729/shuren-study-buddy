import { Router } from 'express';
import { beijingDay, weekdayOf } from '../../shared/activity.ts';
import { overlapSlots, slotDay, slotPeriod } from '../../shared/options.ts';
import { hasPrivacyConsent } from '../../shared/profileRules.ts';
import type { BuddyPartner, BuddyStatus, LeaderboardResponse } from '../../shared/types.ts';
import { HttpError, rateLimit, requireUser } from '../auth.ts';
import { activityConfig, seasonInfo } from '../activityConfig.ts';
import { createAppeal } from '../audits.ts';
import { accept, cancelInvite, decline, invite, unbind } from '../buddies.ts';
import { activePairOf, partnerOf, shurenOf } from '../buddyState.ts';
import { isExcluded } from '../connections.ts';
import { iso, q } from '../db.ts';
import { activeMatchBetween } from '../matches.ts';
import { getProfileRow, parseData } from '../profiles.ts';
import { compareCheckins, currentWeek, dayCheckin, ineligibleReason, leaderboard, pairScore, scoringStart, type DayCheckin } from '../scoring.ts';

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

/** 北京时间 HH:mm */
const hm = (ms: number) => new Date(ms + 8 * 3_600_000).toISOString().slice(11, 16);

function statusOf(uid: number): BuddyStatus {
  const now = new Date();
  const config = activityConfig();
  const pair = activePairOf(uid);
  const invites = q.all<{ id: number; from_id: number; to_id: number; created_at: string }>(
    "SELECT id, from_id, to_id, created_at FROM buddy_invites WHERE status = 'pending' AND (from_id = ? OR to_id = ?) ORDER BY id DESC", uid, uid,
  ).filter((row) => !isExcluded(row.from_id, row.to_id)).map((row) => {
    const outgoing = row.from_id === uid;
    return { id: row.id, direction: outgoing ? 'outgoing' as const : 'incoming' as const, other: buddyPartner(outgoing ? row.to_id : row.from_id, uid), createdAt: iso(row.created_at)! };
  });
  const base = { invites, shurenMember: shurenOf(uid), season: seasonInfo(now, config) };
  if (!pair) return { ...base, pair: null, week: null, score: null, rank: null, today: null };

  const partnerId = partnerOf(pair, uid);
  const board = leaderboard(now);
  const mine = board.items.find((item) => item.pair.id === pair.id);
  const ineligible = ineligibleReason(pair);
  const week = currentWeek(pair, now, config);
  const date = beijingDay(now);
  const myCheckin = dayCheckin(uid, date, config);
  const partnerCheckin = dayCheckin(partnerId, date, config);
  const schedule = (id: number) => {
    const row = getProfileRow(id);
    return row ? parseData(row).schedule : [];
  };
  const todayIndex = (weekdayOf(date) + 6) % 7;
  return {
    ...base,
    pair: {
      id: pair.id,
      partner: buddyPartner(partnerId, uid),
      createdAt: iso(pair.created_at)!,
      // 赛季推迟后，早先绑定的组合也从新的赛季第一天开始计分
      startsOn: scoringStart(pair),
      started: date >= scoringStart(pair),
      matchId: activeMatchBetween(uid, partnerId)?.id ?? null,
      ineligible,
      showOnProfile: pair.user_a === uid ? { mine: !!pair.show_a, partner: !!pair.show_b } : { mine: !!pair.show_b, partner: !!pair.show_a },
    },
    // 只返回给本组合看的字段：不带设备、照片指纹等抽检信息
    week: week && {
      start: week.start, end: week.end, count: week.count, cap: week.cap, points: week.points, bonus: week.bonus,
      events: week.events.map((e) => {
        const [me, other] = e.a.userId === uid ? [e.a, e.b] : [e.b, e.a];
        return {
          date: e.date, mine: hm(me.at), theirs: hm(other.at), place: me.place,
          distance: e.distanceM === null ? null : Math.round(e.distanceM / 10) * 10,
          mineReplacement: me.isReplacement || undefined,
          theirsReplacement: other.isReplacement || undefined,
        };
      }),
    },
    score: { total: mine?.total ?? pairScore(pair, board.through).total, through: board.through },
    rank: mine ? { rank: mine.rank, tied: mine.tied, total: board.items.length } : null,
    today: {
      date,
      checkinPolicy: 'first_eligible',
      mine: mineToday(myCheckin),
      partner: partnerToday(partnerCheckin),
      pairOutcome: week && myCheckin?.counts && partnerCheckin?.counts ? compareCheckins(myCheckin, partnerCheckin, config).outcome : null,
      free: overlapSlots(schedule(uid), schedule(partnerId)).filter((slot) => slotDay(slot) === todayIndex).map(slotPeriod),
    },
  };
}

// 只返回界面所需的字段，打卡编号仅本人可见，不发送经纬度。
const mineToday = (c: DayCheckin | null) => (c ? {
  checkinId: c.id, at: new Date(c.at).toISOString(), counts: c.counts, issue: c.issue, isReplacement: c.isReplacement || undefined,
} : null);
function partnerToday(c: DayCheckin | null): NonNullable<BuddyStatus['today']>['partner'] {
  if (!c) return null;
  const at = new Date(c.at).toISOString();
  if (c.issue === 'deleted') return { at, counts: false, place: '', issue: 'deleted' };
  return { at, counts: c.counts, place: c.place, isReplacement: c.isReplacement || undefined };
}

activityRouter.get('/me', (req, res) => {
  res.json(statusOf(req.user!.id));
});

activityRouter.post('/invites', (req, res) => {
  const uid = req.user!.id;
  rateLimit(`buddy-invite:${uid}`, 10, 24 * 3600_000);
  invite(uid, idOf(req.body?.userId));
  res.json(statusOf(uid));
});

activityRouter.post('/invites/:id/accept', (req, res) => {
  const uid = req.user!.id;
  const { matchId } = accept(idOf(req.params.id), uid);
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

/** 是否在主页上公开「我们是搭子」：两人都打开后，双方主页上才显示对方 */
activityRouter.put('/pair/profile', (req, res) => {
  const uid = req.user!.id;
  const show = req.body?.show;
  if (typeof show !== 'boolean') throw new HttpError(400, '请选择是否在主页上显示搭子');
  const pair = activePairOf(uid);
  if (!pair) throw new HttpError(409, '你现在没有搭子');
  q.run(`UPDATE buddy_pairs SET ${pair.user_a === uid ? 'show_a' : 'show_b'} = ? WHERE id = ?`, show ? 1 : 0, pair.id);
  res.json(statusOf(uid));
});

activityRouter.post('/unbind', (req, res) => {
  unbind(req.user!.id);
  res.json(statusOf(req.user!.id));
});

/** 积分与名次：每个组合只能看到自己的名次和总积分，看不到别的组合 */
activityRouter.get('/leaderboard', (req, res) => {
  const uid = req.user!.id;
  rateLimit(`leaderboard:${uid}`, 60, 60_000);
  const board = leaderboard();
  const pair = activePairOf(uid);
  const mine = pair ? board.items.find((item) => item.pair.id === pair.id) : undefined;
  const body: LeaderboardResponse = {
    mine: mine ? { rank: mine.rank, tied: mine.tied, total: mine.total } : null,
    pairs: board.items.length,
    through: board.through,
    season: seasonInfo(),
  };
  res.json(body);
});

activityRouter.post('/appeals', (req, res) => {
  const uid = req.user!.id;
  rateLimit(`appeal:${uid}`, 10, 24 * 3600_000);
  createAppeal(uid, idOf(req.body?.checkinId), req.body?.body);
  res.json({ ok: true });
});

