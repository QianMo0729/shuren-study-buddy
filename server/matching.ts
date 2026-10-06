// 匹配推荐：候选集、资格状态、排序（问卷契合度 + 个人偏好）与确定性探索。
// 评分规则见 server/recommendations.ts；偏好模型的数学部分见 server/learning.ts。
import crypto from 'node:crypto';
import { effectiveSchedule, emptyProfile, hasPrivacyConsent, missingFields } from '../shared/profileRules.ts';
import type { DeckCard, DeckResponse, FeedbackAction, ProfileInput, RecommendationInfo } from '../shared/types.ts';
import { getSetting, q, setSetting } from './db.ts';
import {
  type Features, type PreferenceModel, type TrainingSample,
  cloneModel, defaultPrior, emphasis, extractFeatures, fitGlobalPrior, onlineUpdate, parseFeatures, parseModel,
  personalizedScore, predict, serializeModel,
} from './learning.ts';
import { getProfileRow, parseData, toCard } from './profiles.ts';
import { compareRecommendationCards, hardFilter, recommendationFor } from './recommendations.ts';

export type ViewerState = 'ready' | 'incomplete' | 'unavailable' | 'unpublished';

/** 已登录且主页可参与推荐的状态集合 */
const ACTIVE_STATUSES = ['seeking', 'open'];
/** 稍后再看的冷却期 */
export const SKIP_COOLDOWN_DAYS = 3;
/** 全站先验：至少多少条反馈才拟合、之后每新增多少条重算 */
export const GLOBAL_MIN_FEEDBACK = 200;
export const GLOBAL_REFIT_EVERY = 50;
const GLOBAL_MAX_ROWS = 5_000;
const GLOBAL_KEY = 'pref_global_model';
const EVENTS_KEY = 'pref_feedback_events';

interface ProfileRowLike {
  user_id: number;
  nickname: string;
  data: string;
  published: number;
  published_at: string | null;
  saved_at: string | null;
  taken_down: number;
  taken_down_at: string | null;
  takedown_reason: string | null;
  reviewed_at: string | null;
  views: number;
}
export interface ViewerContext {
  uid: number;
  state: ViewerState;
  missing: { key: string; label: string }[];
  data: ProfileInput;
}

/** 观看者能否获得推荐：问卷已保存且必填完整 → 未被撤下且状态可约 → 已发布 */
export function viewerContext(uid: number): ViewerContext {
  const row = getProfileRow(uid);
  const data = row ? parseData(row) : emptyProfile();
  const missing = missingFields(data).map(({ key, label }) => ({ key: String(key), label }));
  let state: ViewerState = 'ready';
  if (missing.length || !row?.saved_at) state = 'incomplete';
  else if (row.taken_down || !ACTIVE_STATUSES.includes(data.status)) state = 'unavailable';
  else if (!row.published) state = 'unpublished';
  return { uid, state, missing, data };
}

// ---------- 偏好模型的存取 ----------

interface GlobalModelRecord { model: PreferenceModel; events: number; rows: number }

function loadGlobal(): GlobalModelRecord | null {
  const raw = getSetting(GLOBAL_KEY, '');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return { model: parseModel(parsed.model, defaultPrior()), events: Number(parsed.events) || 0, rows: Number(parsed.rows) || 0 };
  } catch {
    return null;
  }
}

/** 个人模型的先验：有全站先验时用全站先验，否则用默认先验 */
export function currentPrior(): PreferenceModel {
  return loadGlobal()?.model ?? defaultPrior();
}

export interface UserModel { model: PreferenceModel; prior: PreferenceModel; samples: number }

/** 重建个人模型时最多重放的反馈条数（取最近的） */
const USER_MAX_ROWS = 500;

/**
 * 个人模型 = 从当前先验出发，按时间顺序重放本人所有带特征快照的反馈（在线更新）。
 * 每次都重新计算，因此撤销、改写、解除配对都是精确的，全站先验更新后也不会出现“相对旧先验”的偏差。
 * 规模很小（≤ 500 条 × 14 个特征），比存储增量更可靠。
 */
export function userModel(uid: number): UserModel {
  const prior = currentPrior();
  const rows = q.all<{ features: string; action: FeedbackAction }>(
    `SELECT features, action FROM (
       SELECT features, action, updated_at, target_id FROM match_feedback
       WHERE user_id = ? AND features <> '{}' ORDER BY updated_at DESC, target_id DESC LIMIT ?
     ) ORDER BY updated_at, target_id`,
    uid, USER_MAX_ROWS,
  );
  let model = cloneModel(prior);
  let samples = 0;
  for (const row of rows) {
    const features = parseFeatures(row.features);
    if (!features || (row.action !== 'like' && row.action !== 'dislike' && row.action !== 'skip')) continue;
    model = onlineUpdate(model, prior, features, row.action);
    samples += 1;
  }
  return { model, prior, samples };
}

/** 缓存一份当前个人模型，便于运维查看；排序始终以 userModel() 的实时重建为准 */
function saveUserModel(uid: number, model: PreferenceModel, samples: number) {
  q.run(
    `INSERT INTO preference_models (user_id, weights, samples, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET weights = excluded.weights, samples = excluded.samples, updated_at = excluded.updated_at`,
    uid, serializeModel(model), Math.max(0, samples),
  );
}

/**
 * 反馈已写入 match_feedback 之后调用：重建并缓存个人模型；有特征快照的新反馈计入全站事件数，
 * 必要时在响应之后异步重算全站先验。previous 参数保留以兼容调用方，重放已自动处理改写。
 */
export function learnFromFeedback(uid: number, features: Features | null, _action: FeedbackAction, previous?: { features: Features | null; action: FeedbackAction }) {
  if (!features && !previous?.features) return;
  if (features) setSetting(EVENTS_KEY, String(Number(getSetting(EVENTS_KEY, '0')) + 1));
  const { model, samples } = userModel(uid);
  saveUserModel(uid, model, samples);
  if (features) scheduleGlobalRefit();
}

/** 反馈被删除之后调用（如“撤销上一步”“放回推荐”）：重建并缓存个人模型（解除配对时清空过特征快照，所以总是重建） */
export function unlearnFeedback(uid: number, _features: Features | null, _action: FeedbackAction) {
  const { model, samples } = userModel(uid);
  saveUserModel(uid, model, samples);
}

let refitScheduled = false;
/** 全站先验的重算放到响应之后执行，不阻塞当前请求 */
function scheduleGlobalRefit() {
  if (refitScheduled) return;
  refitScheduled = true;
  setImmediate(() => {
    refitScheduled = false;
    try { maybeRefitGlobalPrior(); } catch (error) { console.error('[match] 全站先验重算失败', error); }
  });
}

/** 全站反馈 ≥ 200 条时拟合全站先验；之后每新增 50 条反馈重算一次（只用最近 5000 条，类型化数组计算，耗时很短） */
export function maybeRefitGlobalPrior(force = false): boolean {
  const events = Number(getSetting(EVENTS_KEY, '0'));
  const current = loadGlobal();
  if (!force && current && events - current.events < GLOBAL_REFIT_EVERY) return false;
  const count = q.get<{ n: number }>("SELECT COUNT(*) n FROM match_feedback WHERE features <> '{}'")!.n;
  if (!force && count < GLOBAL_MIN_FEEDBACK) return false;
  const rows = q.all<{ features: string; action: FeedbackAction }>(
    "SELECT features, action FROM match_feedback WHERE features <> '{}' ORDER BY updated_at DESC, user_id, target_id LIMIT ?", GLOBAL_MAX_ROWS,
  );
  const samples: TrainingSample[] = [];
  for (const row of rows) {
    const features = parseFeatures(row.features);
    if (features && (row.action === 'like' || row.action === 'dislike' || row.action === 'skip')) samples.push({ features, action: row.action });
  }
  if (!samples.length) return false;
  const model = fitGlobalPrior(samples, defaultPrior());
  setSetting(GLOBAL_KEY, JSON.stringify({ model: JSON.parse(serializeModel(model)), events, rows: samples.length, fittedAt: new Date().toISOString() }));
  return true;
}

// ---------- 候选集 ----------

interface Candidate {
  row: ProfileRowLike;
  data: ProfileInput;
  rec: RecommendationInfo;
  features: Features;
}

interface CandidatePool {
  eligibleCount: number;
  candidates: Candidate[];
}

const idSet = (rows: { id: number }[]) => new Set(rows.map((r) => r.id));

/** 资格过滤（含反馈、排除、配对等）后，再经硬条件过滤得到候选人 */
export function candidatePool(viewer: ViewerContext): CandidatePool {
  const uid = viewer.uid;
  const rows = q.all<ProfileRowLike>(
    `SELECT p.* FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE p.published = 1 AND p.taken_down = 0 AND p.saved_at IS NOT NULL AND p.saved_at <> '' AND p.user_id <> ?
       AND u.activated = 1 AND u.password_hash IS NOT NULL AND u.password_hash <> ''
     ORDER BY p.user_id`,
    uid,
  );
  const blocked = new Set<number>([
    // 任一方向的排除
    ...idSet(q.all<{ id: number }>('SELECT CASE WHEN user_id = ? THEN target_id ELSE user_id END AS id FROM exclusions WHERE user_id = ? OR target_id = ?', uid, uid, uid)),
    // 旧版联系申请被拒绝的（从未配对过的同学之间；私聊中的拒绝由配对与反馈状态处理，不应永久屏蔽推荐）
    ...idSet(q.all<{ id: number }>(
      `SELECT CASE WHEN c.requester_id = ? THEN c.recipient_id ELSE c.requester_id END AS id
       FROM contact_requests c WHERE c.status = 'rejected' AND (c.requester_id = ? OR c.recipient_id = ?)
         AND NOT EXISTS (SELECT 1 FROM matches m WHERE (m.user_a = c.requester_id AND m.user_b = c.recipient_id)
                                                  OR (m.user_a = c.recipient_id AND m.user_b = c.requester_id))`, uid, uid, uid,
    )),
    // 我已感兴趣 / 不感兴趣；稍后再看未满冷却期
    ...idSet(q.all<{ id: number }>(
      `SELECT target_id AS id FROM match_feedback
       WHERE user_id = ? AND (action <> 'skip' OR updated_at > datetime('now', ?))`, uid, `-${SKIP_COOLDOWN_DAYS} days`,
    )),
    // 对方已对我不感兴趣（静默）
    ...idSet(q.all<{ id: number }>("SELECT user_id AS id FROM match_feedback WHERE target_id = ? AND action = 'dislike'", uid)),
    // 已有活跃配对
    ...idSet(q.all<{ id: number }>(
      "SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS id FROM matches WHERE status = 'active' AND (user_a = ? OR user_b = ?)", uid, uid, uid,
    )),
  ]);
  let eligibleCount = 0;
  const candidates: Candidate[] = [];
  for (const row of rows) {
    if (blocked.has(row.user_id)) continue;
    const data = parseData(row);
    if (missingFields(data).length || !hasPrivacyConsent(data) || !ACTIVE_STATUSES.includes(data.status)) continue;
    eligibleCount++;
    if (hardFilter(viewer.data, data)) continue;
    const rec = recommendationFor(viewer.data, data);
    if (!rec) continue;
    candidates.push({ row, data, rec, features: extractFeatures(rec, viewer.data, data) });
  }
  return { eligibleCount, candidates };
}

function cardOf(viewer: ViewerContext, c: Candidate, rankScore: number, explore: boolean): DeckCard {
  const me = { id: viewer.uid, schedule: effectiveSchedule(viewer.data) };
  return {
    ...toCard(c.row, c.data, me),
    overlapHours: c.rec.overlapHours,
    recommendation: c.rec,
    rankScore: Math.round(rankScore * 10) / 10,
    explore,
    subjects: c.data.subjects,
  };
}

/** 北京时间日期 YYYY-MM-DD */
export const beijingDate = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

/** 探索位的确定性抽签：同一用户同一天结果相同 */
export function exploreHash(viewerId: number, date: string, candidateId: number): number {
  return crypto.createHash('sha256').update(`${viewerId}:${date}:${candidateId}`).digest().readUInt32BE(0);
}

/** 第 k 个探索位放在第 5k+5 张（下标 5k+4），约占 20% */
export const explorePositions = (limit: number) => Array.from({ length: Math.floor(limit * 0.2) }, (_, k) => 5 * k + 4);

function emptyDeck(viewer: ViewerContext, samples: number, personalization: DeckResponse['personalization']): DeckResponse {
  return { items: [], state: viewer.state, missing: viewer.missing, eligibleCount: 0, total: 0, personalization: { ...personalization, samples } };
}

function personalizationOf(m: UserModel): DeckResponse['personalization'] {
  return { samples: m.samples, active: m.samples >= 5, emphasis: emphasis(m.model, m.prior, m.samples) };
}

/**
 * 滑卡：契合度与个人偏好混合排序，加上约 20% 的确定性探索位。
 *
 * 谁进入这一批、排在第几位，只取决于双方的问卷和我自己做过的选择，并且与返回的 rankScore 一致。
 * 别人的私密状态——谁对我感兴趣、谁最近登录过、谁收到了多少还没回应的「感兴趣」——不参与排序：
 * 只要它们能改变结果，就能通过对比不同的请求反推出来。
 */
export function buildDeck(uid: number, limit: number, now = new Date()): DeckResponse {
  const viewer = viewerContext(uid);
  const m = userModel(uid);
  const personalization = personalizationOf(m);
  if (viewer.state !== 'ready') return emptyDeck(viewer, m.samples, personalization);
  const { eligibleCount, candidates } = candidatePool(viewer);
  const ranked = candidates
    .map((c) => {
      const personal = personalizedScore(c.rec.score, predict(m.model, c.features), m.samples);
      return { personal, card: cardOf(viewer, c, personal, false) };
    })
    .sort((a, b) => b.personal - a.personal || compareRecommendationCards(a.card, b.card));

  const positions = explorePositions(limit);
  const date = beijingDate(now);
  const pool = ranked.slice(limit, 3 * limit)
    .map((entry) => ({ entry, h: exploreHash(uid, date, entry.card.id) }))
    .sort((a, b) => a.h - b.h || a.entry.card.id - b.entry.card.id)
    .slice(0, positions.length)
    .map(({ entry }) => ({ ...entry.card, explore: true }));
  const main = ranked.slice(0, limit - pool.length).map((entry) => entry.card);
  const items: DeckCard[] = [...main];
  pool.forEach((card, k) => items.splice(Math.min(positions[k], items.length), 0, card));

  return {
    items,
    state: candidates.length ? 'ready' : eligibleCount ? 'no_overlap' : 'empty',
    missing: viewer.missing,
    eligibleCount,
    total: candidates.length,
    personalization,
  };
}

/** 列表：只按双向契合度排序（compareRecommendationCards），没有个性化与探索 */
export function buildRanked(uid: number, limit: number): DeckResponse {
  const viewer = viewerContext(uid);
  const m = userModel(uid);
  const personalization = personalizationOf(m);
  if (viewer.state !== 'ready') return emptyDeck(viewer, m.samples, personalization);
  const { eligibleCount, candidates } = candidatePool(viewer);
  const items = candidates.map((c) => cardOf(viewer, c, c.rec.score, false)).sort(compareRecommendationCards);
  return {
    items: items.slice(0, limit),
    state: items.length ? 'ready' : eligibleCount ? 'no_overlap' : 'empty',
    missing: viewer.missing,
    eligibleCount,
    total: items.length,
    personalization,
  };
}

// ---------- 反馈 ----------

export interface FeedbackTarget {
  id: number;
  nickname: string;
  email: string;
  data: ProfileInput;
}

/** 可被反馈的对象：主页已发布、未撤下、问卷完整且同意隐私条款的已激活账号 */
export function feedbackTarget(targetId: number): FeedbackTarget | null {
  const row = q.get<ProfileRowLike & { email: string }>(
    `SELECT p.*, u.email FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE p.user_id = ? AND p.published = 1 AND p.taken_down = 0 AND p.saved_at IS NOT NULL AND p.saved_at <> ''
       AND u.activated = 1 AND u.password_hash IS NOT NULL AND u.password_hash <> ''`,
    targetId,
  );
  if (!row) return null;
  const data = parseData(row);
  if (missingFields(data).length || !hasPrivacyConsent(data)) return null;
  return { id: row.user_id, nickname: row.nickname, email: row.email, data };
}

/** 反馈当时的特征快照；没有共同时间等硬条件不满足时返回 null（不参与学习） */
export function featuresBetween(viewer: ProfileInput, target: ProfileInput): Features | null {
  if (hardFilter(viewer, target)) return null;
  const rec = recommendationFor(viewer, target);
  return rec ? extractFeatures(rec, viewer, target) : null;
}
