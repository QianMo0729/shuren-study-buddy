// 匹配推荐：候选集、资格状态、排序（问卷契合度 + 个人偏好 + 少量加成）与确定性探索。
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
/** 排序加成：对方已对我感兴趣（不向用户透露）、对方近期活跃、对方长期未登录、对方积压了很多未回应的感兴趣 */
export const BOOST = { likedMe: 6, recentLogin: 2, staleLogin: -10, crowded: -4 } as const;
const CROWDED_PENDING_LIKES = 15;
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
type CandidateRow = ProfileRowLike & { last_login_at: string | null };

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

export function userModel(uid: number): UserModel {
  const prior = currentPrior();
  const row = q.get<{ weights: string; samples: number }>('SELECT weights, samples FROM preference_models WHERE user_id = ?', uid);
  if (!row) return { model: cloneModel(prior), prior, samples: 0 };
  return { model: parseModel(row.weights, prior), prior, samples: Math.max(0, Number(row.samples) || 0) };
}

function saveUserModel(uid: number, model: PreferenceModel, samples: number) {
  q.run(
    `INSERT INTO preference_models (user_id, weights, samples, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET weights = excluded.weights, samples = excluded.samples, updated_at = excluded.updated_at`,
    uid, serializeModel(model), Math.max(0, samples),
  );
}

/**
 * 根据一次反馈更新个人模型。改写同一对象的旧反馈时，先撤回旧反馈的影响，再学习新的（样本数不变）。
 * 没有特征快照（例如没有共同时间、无法计算契合度）的反馈不参与学习。
 */
export function learnFromFeedback(uid: number, features: Features | null, action: FeedbackAction, previous?: { features: Features | null; action: FeedbackAction }) {
  if (!features && !previous?.features) return;
  const { model, prior, samples } = userModel(uid);
  let next = model;
  let count = samples;
  if (previous?.features) {
    next = onlineUpdate(next, prior, previous.features, previous.action, -1);
    count -= 1;
  }
  if (features) {
    next = onlineUpdate(next, prior, features, action);
    count += 1;
    const events = Number(getSetting(EVENTS_KEY, '0')) + 1;
    setSetting(EVENTS_KEY, String(events));
  }
  saveUserModel(uid, next, count);
  if (features) maybeRefitGlobalPrior();
}

/** 撤销一次反馈（如“撤销上一步”“放回推荐”）对个人模型的影响 */
export function unlearnFeedback(uid: number, features: Features | null, action: FeedbackAction) {
  if (!features) return;
  const { model, prior, samples } = userModel(uid);
  if (samples <= 0) return;
  saveUserModel(uid, onlineUpdate(model, prior, features, action, -1), samples - 1);
}

/** 全站反馈 ≥ 200 条时拟合全站先验；之后每新增 50 条反馈重算一次（同步计算，规模很小） */
export function maybeRefitGlobalPrior(force = false): boolean {
  const events = Number(getSetting(EVENTS_KEY, '0'));
  const current = loadGlobal();
  if (!force && current && events - current.events < GLOBAL_REFIT_EVERY) return false;
  const count = q.get<{ n: number }>("SELECT COUNT(*) n FROM match_feedback WHERE features <> '{}'")!.n;
  if (!force && count < GLOBAL_MIN_FEEDBACK) return false;
  // 只用最近的反馈，保证同步拟合的耗时有上限
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
  row: CandidateRow;
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
  const rows = q.all<CandidateRow>(
    `SELECT p.*, u.last_login_at FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE p.published = 1 AND p.taken_down = 0 AND p.saved_at IS NOT NULL AND p.saved_at <> '' AND p.user_id <> ?
       AND u.activated = 1 AND u.password_hash IS NOT NULL AND u.password_hash <> ''
     ORDER BY p.user_id`,
    uid,
  );
  const blocked = new Set<number>([
    // 任一方向的排除
    ...idSet(q.all<{ id: number }>('SELECT CASE WHEN user_id = ? THEN target_id ELSE user_id END AS id FROM exclusions WHERE user_id = ? OR target_id = ?', uid, uid, uid)),
    // 旧版联系申请被拒绝的
    ...idSet(q.all<{ id: number }>(
      `SELECT CASE WHEN requester_id = ? THEN recipient_id ELSE requester_id END AS id
       FROM contact_requests WHERE status = 'rejected' AND (requester_id = ? OR recipient_id = ?)`, uid, uid, uid,
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

const msAgo = (sqlTime: string | null) => (sqlTime ? Date.now() - new Date(`${sqlTime.replace(' ', 'T')}Z`).getTime() : null);
const DAY = 86_400_000;

function emptyDeck(viewer: ViewerContext, samples: number, personalization: DeckResponse['personalization']): DeckResponse {
  return { items: [], state: viewer.state, missing: viewer.missing, eligibleCount: 0, total: 0, personalization: { ...personalization, samples } };
}

function personalizationOf(m: UserModel): DeckResponse['personalization'] {
  return { samples: m.samples, active: m.samples >= 5, emphasis: emphasis(m.model, m.prior, m.samples) };
}

/** 滑卡：契合度与个人偏好混合排序，加上少量加成和约 20% 的确定性探索位 */
export function buildDeck(uid: number, limit: number, now = new Date()): DeckResponse {
  const viewer = viewerContext(uid);
  const m = userModel(uid);
  const personalization = personalizationOf(m);
  if (viewer.state !== 'ready') return emptyDeck(viewer, m.samples, personalization);
  const { eligibleCount, candidates } = candidatePool(viewer);
  const likedMe = idSet(q.all<{ id: number }>("SELECT user_id AS id FROM match_feedback WHERE target_id = ? AND action = 'like'", uid));
  // 对方收到但尚未回应（对方没有给出任何反馈、也没有配对）的“感兴趣”
  const pending = new Map(q.all<{ id: number; n: number }>(
    `SELECT f.target_id AS id, COUNT(*) AS n FROM match_feedback f
     LEFT JOIN match_feedback r ON r.user_id = f.target_id AND r.target_id = f.user_id
     WHERE f.action = 'like' AND r.user_id IS NULL GROUP BY f.target_id`,
  ).map((r) => [r.id, r.n]));
  const scored = candidates.map((c) => {
    const personal = personalizedScore(c.rec.score, predict(m.model, c.features), m.samples);
    let boost = 0;
    if (likedMe.has(c.row.user_id)) boost += BOOST.likedMe;
    const since = msAgo(c.row.last_login_at);
    if (since !== null && since <= 7 * DAY) boost += BOOST.recentLogin;
    else if (since !== null && since > 30 * DAY) boost += BOOST.staleLogin;
    if ((pending.get(c.row.user_id) ?? 0) > CROWDED_PENDING_LIKES) boost += BOOST.crowded;
    // 对外的 rankScore 不含加成，避免从分数推断“对方已对我感兴趣”
    return { c, personal, sortKey: personal + boost };
  });
  const cards = (list: typeof scored) => list.map((s) => ({ s, card: cardOf(viewer, s.c, s.personal, false) }));
  const ranked = cards(scored).sort((a, b) => b.s.sortKey - a.s.sortKey || compareRecommendationCards(a.card, b.card));

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
