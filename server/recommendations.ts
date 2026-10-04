import { DURATIONS, FREQUENCIES, INTERESTS, PLACES, PLAN_PRESETS, SLOT_COUNT, STUDY_METHODS, STUDY_TYPES, slotsHours } from '../shared/options.ts';
import { effectiveSchedule } from '../shared/profileRules.ts';
import type { ProfileCard, ProfileInput, RecommendationDimension, RecommendationInfo } from '../shared/types.ts';

// Versioned, explicit questionnaire rules. These weights describe compatibility, not a probability.
export const RECOMMENDATION_WEIGHTS = { time: 35, goals: 25, style: 15, places: 10, methods: 5, rhythm: 5, interests: 5 } as const;
const round = (n: number) => Math.round(n * 10_000) / 10_000;
const normalizeText = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const options = (values: { value: string }[]) => new Set(values.map((value) => value.value));
const PLACE_VALUES = options(PLACES);
const METHOD_VALUES = options(STUDY_METHODS);
const INTEREST_VALUES = options(INTERESTS);
const GOAL_VALUES = new Set(PLAN_PRESETS);
const STYLE_VALUES = options(STUDY_TYPES);
const FREQUENCY_VALUES = options(FREQUENCIES);
const DURATION_VALUES = options(DURATIONS);

interface AnswerSet { values: Set<string>; count: number; unspecifiedOther: boolean }
interface Comparison { similarity: number | null; common: number; unspecifiedOther: boolean }

/** An unspecified "other" still occupies an answer, but can never intersect another unspecified "other". */
function answerSet(raw: string[], allowed: Set<string>, otherLabel: string, other: string, standaloneOther = false): AnswerSet {
  const selected = new Set(raw.filter((value) => allowed.has(value)));
  const hasOther = selected.delete(otherLabel);
  const values = new Set([...selected].map((value) => `choice:${value}`));
  const detail = normalizeText(other);
  if ((hasOther || standaloneOther) && detail) values.add(`other:${detail}`);
  const unspecifiedOther = hasOther && !detail;
  return { values, count: values.size + Number(unspecifiedOther), unspecifiedOther };
}

function compareSets(a: AnswerSet, b: AnswerSet, wildcard = false): Comparison {
  const unspecifiedOther = a.unspecifiedOther || b.unspecifiedOther;
  if (!a.count || !b.count) return { similarity: null, common: 0, unspecifiedOther };
  const common = [...a.values].filter((value) => b.values.has(value)).length;
  if (wildcard && (a.values.has('choice:any') || b.values.has('choice:any'))) return { similarity: 1, common, unspecifiedOther };
  return { similarity: round(2 * common / (a.count + b.count)), common, unspecifiedOther };
}

function slots(p: ProfileInput): number[] {
  // Defensive deduplication keeps imported profiles from inflating either coverage or overlap hours.
  return [...new Set(effectiveSchedule(p).filter((slot) => Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT))].sort((a, b) => a - b);
}

function dimension(key: RecommendationDimension['key'], label: string, similarity: number | null, detail: string): RecommendationDimension {
  return { key, label, weight: RECOMMENDATION_WEIGHTS[key], similarity: similarity === null ? null : round(similarity), detail };
}

function setDetail(comparison: Comparison, label: string): string {
  if (comparison.similarity === null) return `一方或双方未填写${label}，此项不计入分数。`;
  const note = comparison.unspecifiedOther ? '未补充内容的“其他”不视为相同。' : '';
  return `${label}有 ${comparison.common} 项可确认相同，按双方选项集合的相似程度比较。${note}`;
}

function placeSimilarity(a: ProfileInput, b: ProfileInput): { similarity: number | null; disagreement: boolean; detail: string } {
  const ownA = answerSet(a.places, PLACE_VALUES, 'other', a.placesOther, true);
  const ownB = answerSet(b.places, PLACE_VALUES, 'other', b.placesOther, true);
  const expectedA = answerSet(a.expectedPlaces, PLACE_VALUES, 'other', a.expectedPlacesOther, true);
  const expectedB = answerSet(b.expectedPlaces, PLACE_VALUES, 'other', b.expectedPlacesOther, true);
  const comparisons = [compareSets(ownA, ownB, true).similarity];
  if (expectedA.count) comparisons.push(compareSets(expectedA, ownB, true).similarity);
  if (expectedB.count) comparisons.push(compareSets(expectedB, ownA, true).similarity);
  // Two unrestricted actual-place answers must not erase conflicting explicit expectations.
  if (expectedA.count && expectedB.count) comparisons.push(compareSets(expectedA, expectedB, true).similarity);
  const known = comparisons.filter((value): value is number => value !== null);
  return {
    similarity: known.length ? round(known.reduce((sum, value) => sum + value, 0) / known.length) : null,
    disagreement: known.some((value) => value === 0),
    detail: known.length
      ? `综合双方学习地点和已填写的对方地点期望，共 ${known.length} 项比较；“不限”可兼容已填写地点，自定义地点仅在文字一致时视为相同。`
      : '一方或双方缺少可比较的学习地点，此项不计入分数。',
  };
}

function rhythmSimilarity(a: ProfileInput, b: ProfileInput): { similarity: number | null; detail: string } {
  const comparisons: number[] = [];
  const labels: string[] = [];
  if (FREQUENCY_VALUES.has(a.frequency) && FREQUENCY_VALUES.has(b.frequency)) {
    comparisons.push(a.frequency === b.frequency ? 1 : a.frequency === 'irregular' || b.frequency === 'irregular' ? 0.5 : 0);
    labels.push('频率');
  }
  if (DURATION_VALUES.has(a.duration) && DURATION_VALUES.has(b.duration)) {
    comparisons.push(a.duration === b.duration ? 1 : 0);
    labels.push('单次时长');
  }
  return {
    similarity: comparisons.length ? round(comparisons.reduce((sum, value) => sum + value, 0) / comparisons.length) : null,
    detail: comparisons.length
      ? `仅比较双方均填写的${labels.join('、')}；相同选项完全一致，“不定期”与具体频率部分兼容。`
      : '没有双方均填写的频率或单次时长，此项不计入分数。',
  };
}

/** Symmetric pure score. Profiles without jointly feasible time are never recommended. */
export function recommendationFor(a: ProfileInput, b: ProfileInput): RecommendationInfo | null {
  const timeA = slots(a);
  const timeB = slots(b);
  const bSlots = new Set(timeB);
  const commonSlots = timeA.filter((slot) => bSlots.has(slot));
  if (!commonSlots.length) return null;
  const overlapHours = slotsHours(commonSlots);
  const timeDice = 2 * commonSlots.length / (timeA.length + timeB.length);
  const timeSimilarity = 0.7 * timeDice + 0.3 * Math.min(commonSlots.length / 3, 1);
  const goals = compareSets(answerSet(a.planTags, GOAL_VALUES, '其他', a.goalOther), answerSet(b.planTags, GOAL_VALUES, '其他', b.goalOther));
  const style = STYLE_VALUES.has(a.studyType) && STYLE_VALUES.has(b.studyType)
    ? a.studyType === b.studyType ? 1 : a.studyType === 'flexible' || b.studyType === 'flexible' ? 0.6 : 0
    : null;
  const places = placeSimilarity(a, b);
  const methods = compareSets(answerSet(a.studyMethods, METHOD_VALUES, 'other', a.studyMethodsOther), answerSet(b.studyMethods, METHOD_VALUES, 'other', b.studyMethodsOther));
  const rhythm = rhythmSimilarity(a, b);
  const interests = compareSets(answerSet(a.interests, INTEREST_VALUES, 'other', a.interestsOther), answerSet(b.interests, INTEREST_VALUES, 'other', b.interestsOther));
  const dimensions: RecommendationDimension[] = [
    dimension('time', '共同时间', timeSimilarity, `每周共同 ${commonSlots.length} 个时间格，约 ${overlapHours} 小时；按时间格数量、占双方可用时间的比例评分，通宵不会获得额外权重。`),
    dimension('goals', '近期目标', goals.similarity, setDetail(goals, '近期目标')),
    dimension('style', '学习相处方式', style, style === null ? '缺少可比较的学习相处方式，此项不计入分数。'
      : style === 1 ? '双方偏好的学习相处方式相同。' : style > 0 ? '一方选择灵活安排，与另一方的具体偏好部分兼容。' : '双方偏好的学习相处方式不同，建议先沟通。'),
    dimension('places', '学习地点', places.similarity, places.detail),
    dimension('methods', '学习方法', methods.similarity, setDetail(methods, '学习方法')),
    dimension('rhythm', '学习节奏', rhythm.similarity, rhythm.detail),
    dimension('interests', '兴趣', interests.similarity, setDetail(interests, '兴趣')),
  ];
  const coverage = dimensions.reduce((sum, item) => sum + (item.similarity === null ? 0 : item.weight), 0);
  const score = Math.round(100 * dimensions.reduce((sum, item) => sum + (item.similarity ?? 0) * item.weight, 0) / coverage);
  const reasons = [`每周有 ${commonSlots.length} 个共同时间格，约 ${overlapHours} 小时`];
  const cautions: string[] = [];
  if (commonSlots.length < 3) cautions.push('目前共同时间较少，建议先约定一次具体安排');
  if (timeDice < 0.5) cautions.push('共同时间占双方可用时间的比例偏低');
  if (goals.common) reasons.push(`有 ${goals.common} 项共同近期学习目标`);
  if (goals.similarity !== null && goals.similarity < 0.5) cautions.push('近期学习目标差异较大，先确认能否一起学习');
  if (style === 1) reasons.push('学习相处方式一致');
  else if (style === 0.6) reasons.push('灵活的学习方式可适应对方偏好');
  else if (style === 0) cautions.push('学习相处方式不同，需要先沟通');
  if (places.similarity !== null && places.similarity >= 0.5) reasons.push('学习地点存在兼容选择');
  if (places.disagreement) cautions.push('部分学习地点或地点期望不一致，需要确认');
  if (methods.common) reasons.push(`有 ${methods.common} 项共同学习方法`);
  else if (methods.similarity === 0) cautions.push('暂未确认共同学习方法');
  if (rhythm.similarity === 1) reasons.push('已填写的学习频率或时长一致');
  else if (rhythm.similarity !== null && rhythm.similarity < 1) cautions.push('学习频率或单次时长需要协商');
  if (interests.common) reasons.push(`有 ${interests.common} 项共同兴趣`);
  if (coverage < 100) cautions.push(`部分选填信息尚无法比较，可比较信息覆盖 ${coverage}/100 权重；分数只依据已有信息`);
  return { version: 'rules-v1', score, coverage, overlapHours, commonSlots, reasons, cautions, dimensions };
}

/** Stable across database order and refreshes; coverage distinguishes equally scored sparse answers. */
export function compareRecommendationCards(a: ProfileCard, b: ProfileCard): number {
  const left = a.recommendation!;
  const right = b.recommendation!;
  return right.score - left.score || right.coverage - left.coverage || right.overlapHours - left.overlapHours || a.id - b.id;
}
