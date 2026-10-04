// 个性化推荐的学习部分：特征、逻辑回归偏好模型、在线更新与全站先验拟合。
// 本文件只包含纯函数（不读写数据库），存取模型见 server/matching.ts。
import { collegeOf } from '../shared/majors.ts';
import type { DimensionKey, FeedbackAction, ProfileInput, RecommendationInfo } from '../shared/types.ts';
import { DIMENSION_LABELS, DIMENSION_WEIGHTS } from './recommendations.ts';

export const DIMENSION_KEYS: DimensionKey[] = ['time', 'content', 'personality', 'style', 'places', 'rhythm', 'interests'];

/**
 * 特征全部在 0–1 之间。只使用与“一起学习是否合拍”有关的信息；
 * 性别、照片、年级、昵称等个人属性一律不作为特征，避免模型学到外貌或身份偏好。
 */
export const FEATURE_KEYS = [
  ...DIMENSION_KEYS,
  'type_quiet', 'type_discuss', 'type_checkin', 'type_flexible',
  'talk', 'intensity', 'sameField',
] as const satisfies readonly string[];
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, number>;

export interface PreferenceModel {
  weights: Features;
  bias: number;
}

/** 在线学习率与向先验的 L2 拉力 */
export const ETA = 0.35;
export const LAMBDA = 0.04;
/** 个人模型最多占排序分的比例，以及达到该比例所需的反馈次数 */
export const MAX_BLEND = 0.45;
export const FULL_BLEND_SAMPLES = 20;
/** 个人权重比先验高出该比例，才算“更看重” */
export const EMPHASIS_RATIO = 1.25;
export const EMPHASIS_MIN_SAMPLES = 5;

const LABEL: Record<FeedbackAction, number> = { like: 1, dislike: 0, skip: 0 };
const SAMPLE_WEIGHT: Record<FeedbackAction, number> = { like: 1, dislike: 1, skip: 0.3 };

const INTENSITY: Record<string, number> = { daily: 1, weekly3: 0.75, weekly1: 0.4, irregular: 0.3 };
const STUDY_TYPES = ['quiet', 'discuss', 'checkin', 'flexible'] as const;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);
const round = (n: number) => Math.round(n * 10_000) / 10_000;
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** 同专业，或同一学院 / 系（“其他”类不算同院系） */
export function sameField(a: Pick<ProfileInput, 'major'>, b: Pick<ProfileInput, 'major'>): boolean {
  const ma = a.major.trim();
  const mb = b.major.trim();
  if (!ma || !mb) return false;
  const ca = collegeOf(ma);
  const cb = collegeOf(mb);
  if (ma === mb) return ca !== '其他';
  return !!ca && ca === cb && ca !== '其他';
}

/** 由“我”与候选人的推荐信息生成特征向量 */
export function extractFeatures(rec: RecommendationInfo, me: Pick<ProfileInput, 'major'>, candidate: ProfileInput): Features {
  const dims = new Map(rec.dimensions.map((d) => [d.key, d.similarity]));
  const out = {} as Features;
  for (const key of DIMENSION_KEYS) {
    const s = dims.get(key);
    out[key] = round(s === null || s === undefined ? 0.5 : clamp01(s));
  }
  for (const t of STUDY_TYPES) out[`type_${t}`] = candidate.studyType === t ? 1 : 0;
  const talk = Number(candidate.personality?.talk);
  out.talk = Number.isInteger(talk) && talk >= 1 && talk <= 5 ? round((talk - 1) / 4) : 0.5;
  out.intensity = INTENSITY[candidate.frequency] ?? 0.5;
  out.sameField = sameField(me, candidate) ? 1 : 0;
  return out;
}

/** 校验数据库中的特征快照；缺项或越界返回 null（不参与训练） */
export function parseFeatures(raw: unknown): Features | null {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  const out = {} as Features;
  for (const key of FEATURE_KEYS) {
    const n = (value as Record<string, unknown>)[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) return null;
    out[key] = n;
  }
  return out;
}

/** 默认先验：维度特征按问卷权重（8 × weight / 100），其余为 0，偏置 0 */
export function defaultPrior(): PreferenceModel {
  const weights = {} as Features;
  for (const key of FEATURE_KEYS) weights[key] = 0;
  for (const key of DIMENSION_KEYS) weights[key] = (8 * DIMENSION_WEIGHTS[key]) / 100;
  return { weights, bias: 0 };
}

export const cloneModel = (m: PreferenceModel): PreferenceModel => ({ weights: { ...m.weights }, bias: m.bias });

/** p = σ(b + Σ w_j (x_j − 0.5)) */
export function predict(model: PreferenceModel, x: Features): number {
  let z = model.bias;
  for (const key of FEATURE_KEYS) z += model.weights[key] * (x[key] - 0.5);
  return sigmoid(z);
}

/**
 * 一次在线更新（带向先验的 L2 正则）。
 * direction = −1 时朝反方向走一步，用于撤销或改写此前的一次反馈（近似抵消）。
 */
export function onlineUpdate(model: PreferenceModel, prior: PreferenceModel, x: Features, action: FeedbackAction, direction: 1 | -1 = 1): PreferenceModel {
  const p = predict(model, x);
  const g = (p - LABEL[action]) * SAMPLE_WEIGHT[action] * direction;
  const next = cloneModel(model);
  for (const key of FEATURE_KEYS) {
    const w = model.weights[key];
    next.weights[key] = w - ETA * (g * (x[key] - 0.5) + LAMBDA * (w - prior.weights[key]));
  }
  next.bias = model.bias - ETA * (g + LAMBDA * (model.bias - prior.bias));
  return next;
}

export interface TrainingSample {
  features: Features;
  action: FeedbackAction;
}

/** 全站先验：对全部带特征快照的反馈做批量梯度下降，L2 拉向默认先验 */
export function fitGlobalPrior(samples: TrainingSample[], base: PreferenceModel = defaultPrior(), epochs = 300, rate = 1): PreferenceModel {
  const model = cloneModel(base);
  const total = samples.reduce((sum, s) => sum + SAMPLE_WEIGHT[s.action], 0);
  if (!total) return model;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = {} as Features;
    for (const key of FEATURE_KEYS) grad[key] = 0;
    let gradBias = 0;
    for (const s of samples) {
      const g = (predict(model, s.features) - LABEL[s.action]) * SAMPLE_WEIGHT[s.action];
      for (const key of FEATURE_KEYS) grad[key] += g * (s.features[key] - 0.5);
      gradBias += g;
    }
    for (const key of FEATURE_KEYS) {
      model.weights[key] -= rate * (grad[key] / total + LAMBDA * (model.weights[key] - base.weights[key]));
    }
    model.bias -= rate * (gradBias / total + LAMBDA * (model.bias - base.bias));
  }
  for (const key of FEATURE_KEYS) model.weights[key] = round(model.weights[key]);
  model.bias = round(model.bias);
  return model;
}

/** 个人模型在排序中的占比 α = 0.45 × min(1, samples / 20) */
export const blendWeight = (samples: number) => MAX_BLEND * Math.min(1, Math.max(0, samples) / FULL_BLEND_SAMPLES);

/** 排序分（不含活跃度等加成）：(1 − α) × 契合度 + α × 100p */
export function personalizedScore(score: number, p: number, samples: number): number {
  const alpha = blendWeight(samples);
  return (1 - alpha) * score + alpha * 100 * p;
}

/** 个人权重明显高于先验的维度（中文名，最多 2 个） */
export function emphasis(model: PreferenceModel, prior: PreferenceModel, samples: number): string[] {
  if (samples < EMPHASIS_MIN_SAMPLES) return [];
  return DIMENSION_KEYS
    .map((key) => ({ key, base: prior.weights[key], w: model.weights[key] }))
    .filter((d) => d.base > 0 && d.w > d.base * EMPHASIS_RATIO && d.w - d.base >= 0.05)
    .sort((a, b) => b.w / b.base - a.w / a.base || DIMENSION_KEYS.indexOf(a.key) - DIMENSION_KEYS.indexOf(b.key))
    .slice(0, 2)
    .map((d) => DIMENSION_LABELS[d.key]);
}

/** 存储格式：权重 JSON（含 bias） */
export function serializeModel(model: PreferenceModel): string {
  const out: Record<string, number> = {};
  for (const key of FEATURE_KEYS) out[key] = round(model.weights[key]);
  out.bias = round(model.bias);
  return JSON.stringify(out);
}

/** 读取存储的模型；缺项用 fallback 补齐，非法值视为缺失 */
export function parseModel(raw: unknown, fallback: PreferenceModel): PreferenceModel {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return cloneModel(fallback); }
  }
  const model = cloneModel(fallback);
  if (!value || typeof value !== 'object') return model;
  const src = value as Record<string, unknown>;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1_000;
  for (const key of FEATURE_KEYS) if (ok(src[key])) model.weights[key] = src[key];
  if (ok(src.bias)) model.bias = src.bias;
  return model;
}
