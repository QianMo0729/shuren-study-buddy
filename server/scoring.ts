// 打卡积分：相同事件打卡判定（同一天、时间差在时间窗内、相距不超过规定距离）、每周阶梯计分、Bonus、评奖资格与搭子榜（含并列规则）。
// 积分不单独存表，每次都从打卡记录算出来：打卡被判无效、撤下或解绑后，结果自动更新。
import { addDays, beijingDay, captionLength, mondayOf, type ActivityConfig } from '../shared/activity.ts';
import { distanceM } from '../shared/campusPlaces.ts';
import type { DayCheckinIssue } from '../shared/types.ts';
import { activityConfig } from './activityConfig.ts';
import { type PairRow, shurenOf } from './buddyState.ts';
import { q } from './db.ts';

export interface EventCheckin {
  id: number;
  userId: number;
  at: number;
  date: string;
  device: string | null;
  place: string;
  photoHash: string | null;
  /** 打卡时的定位；没有定位的旧打卡为 null */
  geo: { lat: number; lng: number; accuracy: number } | null;
}

/** 一次相同事件打卡：同一天、两人当天的计分打卡都有效、时间差不超过时间窗、相距不超过规定距离 */
export interface SameEvent {
  date: string;
  a: EventCheckin;
  b: EventCheckin;
  gapMs: number;
  /** 两人相距多少米；不检查距离时为 null */
  distanceM: number | null;
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

interface DayRow {
  id: number;
  user_id: number;
  stamped_at: string;
  local_date: string;
  caption: string;
  device_hash: string | null;
  place_label: string;
  photo_hash: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_accuracy: number | null;
  deleted: number;
  taken_down: number;
  invalid: number;
}

const DAY_COLUMNS = 'id, user_id, stamped_at, local_date, caption, device_hash, place_label, photo_hash, geo_lat, geo_lng, geo_accuracy, deleted, taken_down, invalid';

const geoOf = (row: DayRow) => (row.geo_lat === null || row.geo_lng === null || row.geo_accuracy === null
  ? null
  : { lat: row.geo_lat, lng: row.geo_lng, accuracy: row.geo_accuracy });

/**
 * 当天第一次打卡为什么不能计分；能计分时为 null。
 * 要检查距离时，还必须有定位且误差不超过上限（定位不准就没法核对两人是否在同一处）。
 */
function issueOf(row: DayRow, config: ActivityConfig): DayCheckinIssue | null {
  if (row.deleted) return 'deleted';
  if (row.taken_down) return 'taken_down';
  if (row.invalid) return 'invalid';
  if (captionLength(row.caption) < config.captionMin) return 'caption';
  const geo = geoOf(row);
  if (config.distanceMeters > 0 && (!geo || geo.accuracy > config.accuracyMeters)) return 'location';
  return null;
}

/**
 * 每人每天的计分打卡：当天第一次打卡（含之后删除的，删掉重拍不能换一次）。
 * 它有效（未删除、未撤下、未判无效、说明字数达标、定位够准）才参与计分；当天之后的打卡照常发到社区，但不计分。
 */
export function scoringCheckins(userIds: number[], from: string, to: string, config = activityConfig()): EventCheckin[] {
  if (!userIds.length || from > to) return [];
  const marks = userIds.map(() => '?').join(',');
  const rows = q.all<DayRow>(
    `SELECT ${DAY_COLUMNS} FROM checkins
     WHERE user_id IN (${marks}) AND local_date BETWEEN ? AND ?
     ORDER BY stamped_at, id`,
    ...userIds, from, to,
  );
  const seen = new Set<string>();
  const out: EventCheckin[] = [];
  for (const row of rows) {
    const key = `${row.user_id}|${row.local_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (issueOf(row, config)) continue;
    out.push({
      id: row.id, userId: row.user_id, at: toMs(row.stamped_at), date: row.local_date,
      device: row.device_hash, place: row.place_label, photoHash: row.photo_hash, geo: geoOf(row),
    });
  }
  return out;
}

export interface DayCheckin {
  id: number;
  at: string;
  /** 能参与计分：未删除、未撤下、未判无效、说明字数达标、定位够准 */
  counts: boolean;
  issue: DayCheckinIssue | null;
  place: string;
}

/** 某人某天的计分打卡（当天第一次打卡）；还没打卡时为 null */
export function dayCheckin(uid: number, date: string, config = activityConfig()): DayCheckin | null {
  const row = q.get<DayRow>(
    `SELECT ${DAY_COLUMNS} FROM checkins WHERE user_id = ? AND local_date = ? ORDER BY stamped_at, id LIMIT 1`,
    uid, date,
  );
  if (!row) return null;
  const issue = issueOf(row, config);
  return { id: row.id, at: new Date(toMs(row.stamped_at)).toISOString(), counts: !issue, issue, place: row.place_label };
}

/** 两次打卡相距多少米；有一方没有定位时为 null */
export function checkinDistance(a: Pick<EventCheckin, 'geo'>, b: Pick<EventCheckin, 'geo'>): number | null {
  return a.geo && b.geo ? distanceM(a.geo, b.geo) : null;
}

/** 每人每天只有一次计分打卡，所以每天最多一次相同事件 */
export function sameEvents(pair: Pick<PairRow, 'user_a' | 'user_b'>, from: string, to: string, config = activityConfig()): SameEvent[] {
  const byDate = new Map<string, { a?: EventCheckin; b?: EventCheckin }>();
  for (const c of scoringCheckins([pair.user_a, pair.user_b], from, to, config)) {
    let day = byDate.get(c.date);
    if (!day) byDate.set(c.date, (day = {}));
    if (c.userId === pair.user_a) day.a = c;
    else day.b = c;
  }
  const windowMs = config.windowMinutes * 60_000;
  const out: SameEvent[] = [];
  for (const [date, { a, b }] of [...byDate].sort(([x], [y]) => x.localeCompare(y))) {
    if (!a || !b) continue;
    const gapMs = Math.abs(a.at - b.at);
    if (gapMs > windowMs) continue;
    const distance = checkinDistance(a, b);
    if (config.distanceMeters > 0 && (distance === null || distance > config.distanceMeters)) continue;
    out.push({ date, a, b, gapMs, distanceM: config.distanceMeters > 0 ? distance : null });
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

/**
 * 这个组合实际开始计分的日期。比现在设置的赛季第一天更早绑定的，从赛季第一天开始：赛季改期后跟着改，
 * 也纠正赛季改到周四后、旧代码在那一周周一到周三绑定时存成下一个周一的记录。赛季开始后绑定的，
 * 按绑定时定下的日期（下一个周一），但不早于赛季第一天；赛季第一天往前改时，已经定下的日期不再往后推。
 * 积分、本周进度、Bonus 和抽检都只认这个日期，不要直接用 starts_on。
 */
export function scoringStart(pair: Pick<PairRow, 'starts_on' | 'created_at'>, config = activityConfig()): string {
  // created_at 是 SQLite 的 UTC 时间，换成北京时间的绑定日期
  const boundAt = toMs(pair.created_at);
  if (!Number.isNaN(boundAt) && beijingDay(new Date(boundAt)) < config.seasonStart) return config.seasonStart;
  return pair.starts_on > config.seasonStart ? pair.starts_on : config.seasonStart;
}

/** 组合在 [开始计分日, through] 范围内的积分 */
export function pairScore(pair: PairRow, through: string | null, config = activityConfig()): PairScore {
  const empty: PairScore = { pairId: pair.id, weeks: [], checkinPoints: 0, bonusPoints: 0, total: 0, fullWeeks: 0, events: 0, reachedWeek: null };
  const from = scoringStart(pair, config);
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

/** 本周进度：次数、按阶梯换算的预计得分（周一结算后计入总分）与本周已通过的 Bonus。只给本组合看 */
export function currentWeek(pair: PairRow, now = new Date(), config = activityConfig()) {
  const today = beijingDay(now);
  const pairStart = scoringStart(pair, config);
  if (today < config.seasonStart || today > config.seasonEnd || today < pairStart) return null;
  const start = mondayOf(today);
  // 赛季（或这个组合）在周中开始计分时，这一周只算开始计分之后的打卡
  const from = [start, pairStart].sort().at(-1)!;
  const events = sameEvents(pair, from, today, config);
  const count = events.length;
  let used = 0;
  let bonus = 0;
  for (const claim of q.all<{ week: string; points: number }>(
    "SELECT week, points FROM bonus_claims WHERE pair_id = ? AND status = 'approved' AND week <= ? ORDER BY week, id", pair.id, start,
  )) {
    const add = Math.max(0, Math.min(claim.points, config.bonusSeasonMax - used));
    used += add;
    if (claim.week === start) bonus += add;
  }
  return {
    start, end: addDays(start, 6), count, cap: config.weeklyCap,
    points: config.ladder[Math.min(count, config.weeklyCap)] ?? 0,
    bonus,
    events,
  };
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
  const to = end < config.seasonEnd ? end : config.seasonEnd;
  const out: { pair: PairRow; event: SameEvent }[] = [];
  // 不能用 starts_on 在 SQL 里先筛：赛季开始前绑定的组合，存下的 starts_on 可能晚于实际开始计分日
  for (const pair of q.all<PairRow>("SELECT * FROM buddy_pairs WHERE status = 'active'")) {
    const from = [week, scoringStart(pair, config)].sort().at(-1)!;
    if (from > to) continue;
    for (const event of sameEvents(pair, from, to, config)) out.push({ pair, event });
  }
  return out;
}

