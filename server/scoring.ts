// 打卡积分：相同事件打卡判定、每周阶梯计分、Bonus、评奖资格与搭子榜（含并列规则）。
// 积分不单独存表，每次都从打卡记录算出来：打卡被判无效、撤下或解绑后，结果自动更新。
import { addDays, beijingDay, captionLength, mondayOf, type ActivityConfig } from '../shared/activity.ts';
import { activityConfig } from './activityConfig.ts';
import { type PairRow, shurenOf } from './buddyState.ts';
import { q } from './db.ts';

export interface EventCheckin {
  id: number;
  userId: number;
  at: number;
  date: string;
  device: string | null;
}

/** 一次相同事件打卡：同一天、两人各一次有效打卡、时间差不超过时间窗 */
export interface SameEvent {
  date: string;
  a: EventCheckin;
  b: EventCheckin;
  gapMs: number;
}

export interface WeekScore {
  week: string;
  /** 当周相同事件打卡天数（未封顶） */
  count: number;
  /** 计入的次数（封顶后） */
  counted: number;
  points: number;
}

export interface PairScore {
  pairId: number;
  weeks: WeekScore[];
  checkinPoints: number;
  bonusPoints: number;
  total: number;
  fullWeeks: number;
  events: number;
  /** 最后一次加分所在的周（周一）；用于并列时比较谁先达到最终分数。没有得分时为 null */
  reachedWeek: string | null;
}

const toMs = (sqlite: string) => Date.parse(`${sqlite.replace(' ', 'T')}Z`);

/** 两人在日期范围内能参与计分的打卡：未删除、未撤下、未判无效、说明字数达标 */
export function scoringCheckins(userIds: number[], from: string, to: string, config = activityConfig()): EventCheckin[] {
  if (!userIds.length || from > to) return [];
  const marks = userIds.map(() => '?').join(',');
  return q.all<{ id: number; user_id: number; stamped_at: string; local_date: string; caption: string; device_hash: string | null }>(
    `SELECT id, user_id, stamped_at, local_date, caption, device_hash FROM checkins
     WHERE user_id IN (${marks}) AND deleted = 0 AND taken_down = 0 AND invalid = 0 AND local_date BETWEEN ? AND ?
     ORDER BY stamped_at, id`,
    ...userIds, from, to,
  )
    .filter((row) => captionLength(row.caption) >= config.captionMin)
    .map((row) => ({ id: row.id, userId: row.user_id, at: toMs(row.stamped_at), date: row.local_date, device: row.device_hash }));
}

/** 每天最多一次：取当天时间差最小的一对 */
export function sameEvents(pair: Pick<PairRow, 'user_a' | 'user_b'>, from: string, to: string, config = activityConfig()): SameEvent[] {
  const byDate = new Map<string, { a: EventCheckin[]; b: EventCheckin[] }>();
  for (const c of scoringCheckins([pair.user_a, pair.user_b], from, to, config)) {
    let day = byDate.get(c.date);
    if (!day) byDate.set(c.date, (day = { a: [], b: [] }));
    (c.userId === pair.user_a ? day.a : day.b).push(c);
  }
  const windowMs = config.windowMinutes * 60_000;
  const out: SameEvent[] = [];
  for (const [date, { a, b }] of [...byDate].sort(([x], [y]) => x.localeCompare(y))) {
    let best: SameEvent | null = null;
    let j = 0;
    // 两个列表都按时间排好序：双指针找最近的一对
    for (const ca of a) {
      while (j + 1 < b.length && b[j + 1].at <= ca.at) j++;
      for (const cb of [b[j], b[j + 1]]) {
        if (!cb) continue;
        const gap = Math.abs(ca.at - cb.at);
        if (gap <= windowMs && (!best || gap < best.gapMs)) best = { date, a: ca, b: cb, gapMs: gap };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

/** 最近一个已经结束的周日（排名只统计完整的周）；赛季还没有完整的一周时为 null */
export function scoredThrough(now = new Date(), config = activityConfig()): string | null {
  const today = beijingDay(now);
  const lastSunday = addDays(mondayOf(today), -1);
  const through = lastSunday < config.seasonEnd ? lastSunday : config.seasonEnd;
  return through < config.seasonStart ? null : through;
}

/** 组合在 [开始计分日, through] 范围内的积分 */
export function pairScore(pair: PairRow, through: string | null, config = activityConfig()): PairScore {
  const empty: PairScore = { pairId: pair.id, weeks: [], checkinPoints: 0, bonusPoints: 0, total: 0, fullWeeks: 0, events: 0, reachedWeek: null };
  const from = pair.starts_on > config.seasonStart ? pair.starts_on : config.seasonStart;
  if (!through || through < from) return empty;
  const events = sameEvents(pair, from, through, config);
  const perWeek = new Map<string, number>();
  for (const e of events) perWeek.set(mondayOf(e.date), (perWeek.get(mondayOf(e.date)) ?? 0) + 1);
  const weeks: WeekScore[] = [];
  const gains = new Map<string, number>();
  for (let week = mondayOf(from); week <= through; week = addDays(week, 7)) {
    const count = perWeek.get(week) ?? 0;
    const counted = Math.min(count, config.weeklyCap);
    const points = config.ladder[counted] ?? 0;
    weeks.push({ week, count, counted, points });
    if (points) gains.set(week, points);
  }
  const lastWeek = mondayOf(through);
  let bonusPoints = 0;
  for (const claim of q.all<{ week: string; points: number }>(
    "SELECT week, points FROM bonus_claims WHERE pair_id = ? AND status = 'approved' AND week <= ? ORDER BY week, id", pair.id, lastWeek,
  )) {
    const add = Math.min(claim.points, config.bonusSeasonMax - bonusPoints);
    if (add <= 0) continue;
    bonusPoints += add;
    gains.set(claim.week, (gains.get(claim.week) ?? 0) + add);
  }
  const checkinPoints = weeks.reduce((sum, w) => sum + w.points, 0);
  return {
    pairId: pair.id,
    weeks,
    checkinPoints,
    bonusPoints,
    total: checkinPoints + bonusPoints,
    fullWeeks: weeks.filter((w) => w.count >= config.weeklyCap).length,
    events: weeks.reduce((sum, w) => sum + w.counted, 0),
    reachedWeek: [...gains.keys()].sort().at(-1) ?? null,
  };
}

/** 本周进度：只给本组合看次数，不显示分数 */
export function currentWeek(pair: PairRow, now = new Date(), config = activityConfig()) {
  const today = beijingDay(now);
  if (today < config.seasonStart || today > config.seasonEnd || today < pair.starts_on) return null;
  const start = mondayOf(today);
  return { start, end: addDays(start, 6), count: sameEvents(pair, start, today, config).length, cap: config.weeklyCap };
}

// ---------- 评奖资格 ----------

/** 组合在绑定期间被判无效的打卡次数 */
export function strikesOf(pair: PairRow): number {
  return q.get<{ n: number }>(
    'SELECT COUNT(*) n FROM checkins WHERE user_id IN (?, ?) AND invalid = 1 AND created_at >= ?',
    pair.user_a, pair.user_b, pair.created_at,
  )!.n;
}

/** 不能参与评奖的原因；可以参与时为 null */
export function ineligibleReason(pair: PairRow, config: ActivityConfig = activityConfig()): string | null {
  if (q.get('SELECT 1 FROM activity_disqualified WHERE user_id IN (?, ?)', pair.user_a, pair.user_b)) return '经核实存在作弊行为，已取消本赛季评奖资格';
  const strikes = strikesOf(pair);
  if (strikes >= config.strikeLimit) return `无效打卡累计 ${strikes} 次，已取消本赛季评奖资格`;
  if (shurenOf(pair.user_a) !== 'yes' && shurenOf(pair.user_b) !== 'yes') return '至少一方是树仁书院学生才能参与排名';
  return null;
}

// ---------- 搭子榜 ----------

export interface RankedPair extends PairScore {
  pair: PairRow;
  rank: number;
  tied: boolean;
}

/** 并列规则：总分 → 打卡分（不含 Bonus）→ 满勤周数 → 计入的相同事件次数 → 更早达到最终分数；全部相同为并列 */
export function compareScores(x: PairScore, y: PairScore): number {
  return y.total - x.total
    || y.checkinPoints - x.checkinPoints
    || y.fullWeeks - x.fullWeeks
    || y.events - x.events
    || (x.reachedWeek ?? '').localeCompare(y.reachedWeek ?? '');
}

let cache: { key: string; at: number; through: string | null; items: RankedPair[] } | null = null;
const CACHE_MS = 20_000;

/** 打卡、判无效、解绑、Bonus、设置变化后调用，下一次读取榜单时重新计算 */
export function touchScores() {
  cache = null;
}

export function leaderboard(now = new Date()): { through: string | null; items: RankedPair[] } {
  const config = activityConfig();
  const through = scoredThrough(now, config);
  const key = `${through}|${JSON.stringify(config)}`;
  if (cache && cache.key === key && now.getTime() - cache.at < CACHE_MS) return cache;
  const scored = q.all<PairRow>("SELECT * FROM buddy_pairs WHERE status = 'active' ORDER BY id")
    .filter((pair) => !ineligibleReason(pair, config))
    .map((pair) => ({ pair, ...pairScore(pair, through, config) }))
    .filter((entry) => entry.total > 0)
    .sort((x, y) => compareScores(x, y) || x.pair.id - y.pair.id);
  const items: RankedPair[] = [];
  scored.forEach((entry, index) => {
    const previous = items[index - 1];
    const same = previous && compareScores(previous, entry) === 0;
    items.push({ ...entry, rank: same ? previous.rank : index + 1, tied: false });
  });
  for (const item of items) item.tied = items.filter((other) => other.rank === item.rank).length > 1;
  cache = { key, at: now.getTime(), through, items };
  return cache;
}

/** 一周内所有在绑组合的相同事件（抽检与获奖复核用） */
export function weekEvents(week: string, config = activityConfig()): { pair: PairRow; event: SameEvent }[] {
  const end = addDays(week, 6);
  const out: { pair: PairRow; event: SameEvent }[] = [];
  for (const pair of q.all<PairRow>("SELECT * FROM buddy_pairs WHERE status = 'active' AND starts_on <= ?", end)) {
    const from = [week, pair.starts_on, config.seasonStart].sort().at(-1)!;
    const to = end < config.seasonEnd ? end : config.seasonEnd;
    for (const event of sameEvents(pair, from, to, config)) out.push({ pair, event });
  }
  return out;
}

