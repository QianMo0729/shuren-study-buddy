import {
  DURATIONS, FREQUENCIES, INTERESTS, PERIODS, PERSONALITY_ITEMS, PLACES, PLAN_PRESETS, SLOT_COUNT, STUDY_TYPES, SYNONYMS,
  optionLabel, slotPeriod, slotsHours,
} from '../shared/options.ts';
import { effectiveSchedule } from '../shared/profileRules.ts';
import type {
  DimensionKey, Personality, PersonalityKey, ProfileCard, ProfileInput, RecommendationDimension, RecommendationInfo,
} from '../shared/types.ts';

// 匹配算法 rules-v2：显式、可解释、确定性的问卷规则。
// 分数表示「问卷契合程度」，不是配对成功的概率。个性化排序在 server/learning.ts 中另行叠加。

export const RECOMMENDATION_VERSION = 'rules-v2';
export const DIMENSION_WEIGHTS: Record<DimensionKey, number> = { time: 30, content: 22, personality: 20, style: 10, places: 8, rhythm: 6, interests: 4 };
export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  time: '共同时间', content: '学习内容', personality: '学习性格', style: '学习方式', places: '学习地点', rhythm: '学习节奏', interests: '兴趣',
};
const DIMENSION_ORDER = Object.keys(DIMENSION_WEIGHTS) as DimensionKey[];

const round = (n: number) => Math.round(n * 10_000) / 10_000;
const hours = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const normalizeText = (value: string) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const values = (options: { value: string }[]) => new Set(options.map((option) => option.value));
const PLACE_VALUES = values(PLACES);
const INTEREST_VALUES = values(INTERESTS);
const GOAL_VALUES = new Set(PLAN_PRESETS);
const STYLE_VALUES = values(STUDY_TYPES);

// ---------- 选项集合（「其他」只有补充文字标准化后相同才算重合） ----------

interface AnswerSet { values: Set<string>; count: number }

/** 未补充文字的「其他」占一个答案名额，但永远不会与任何答案重合 */
function answerSet(raw: unknown, allowed: Set<string>, otherValue: string, otherText: string, standaloneOther = false): AnswerSet {
  const selected = new Set(list(raw).filter((value) => allowed.has(value)));
  const hasOther = selected.delete(otherValue);
  const out = new Set([...selected].map((value) => `choice:${value}`));
  const detail = normalizeText(otherText);
  if ((hasOther || standaloneOther) && detail) out.add(`other:${detail}`);
  return { values: out, count: out.size + Number(hasOther && !detail) };
}

const common = (a: AnswerSet, b: AnswerSet) => [...a.values].filter((value) => b.values.has(value));

/** overlap coefficient：|A∩B| / min(|A|,|B|)，多选不吃亏；任一方未填为 null */
function overlap(a: AnswerSet, b: AnswerSet): number | null {
  if (!a.count || !b.count) return null;
  return common(a, b).length / Math.min(a.count, b.count);
}

const choiceLabels = (keys: string[], options: { value: string; label: string }[], max = 2) =>
  keys.slice(0, max).map((key) => (key.startsWith('choice:') ? optionLabel(options, key.slice(7)) || key.slice(7) : key.slice(6)));

// ---------- 时间 ----------

function slots(p: ProfileInput): number[] {
  // 去重并剔除非法格，避免导入的数据虚增共同时间
  return [...new Set(effectiveSchedule(p).filter((slot) => Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT))].sort((a, b) => a - b);
}

const SESSIONS_PER_WEEK = new Map([['daily', 5], ['weekly3', 4], ['weekly1', 1.5], ['irregular', 1.5]]);
const SESSION_HOURS = new Map([['short', 1.5], ['medium', 3], ['long', 4.5]]);

/** 每周想一起学习的小时数 = 每周次数 × 单次时长；任一项未填按 2 次 × 2 小时估计 */
export function weeklyNeedHours(p: Pick<ProfileInput, 'frequency' | 'duration'>): number {
  const sessions = SESSIONS_PER_WEEK.get(p.frequency);
  const length = SESSION_HOURS.get(p.duration);
  return sessions !== undefined && length !== undefined ? sessions * length : 4;
}

/** 计分用的共同小时数：通宵格实际 8 小时，但最多按 2 小时计，防止通宵灌水 */
const scoredHours = (commonSlots: number[]) => commonSlots.reduce((sum, slot) => sum + Math.min(PERIODS[slotPeriod(slot)].hours, 2), 0);

// ---------- 硬条件 ----------

const wantsGender = (p: ProfileInput) => (p.buddyGender === 'male' || p.buddyGender === 'female' ? p.buddyGender : null);

function commonSlotsOf(a: ProfileInput, b: ProfileInput): number[] {
  const other = new Set(slots(b));
  return slots(a).filter((slot) => other.has(slot));
}

/** 双向硬条件：性别偏好、线上/线下互斥、有效时间必须有交集。任一不满足即不推荐 */
export function hardFilter(a: ProfileInput, b: ProfileInput): null | { reason: 'gender' | 'format' | 'time' } {
  const wantA = wantsGender(a);
  const wantB = wantsGender(b);
  if ((wantA && b.gender !== wantA) || (wantB && a.gender !== wantB)) return { reason: 'gender' };
  const formats = new Set([a.studyFormat, b.studyFormat]);
  if (formats.has('offline') && formats.has('online')) return { reason: 'format' };
  if (!commonSlotsOf(a, b).length) return { reason: 'time' };
  return null;
}

// ---------- 学习内容：具体科目 ----------

const subjectKey = (raw: string) => String(raw ?? '').normalize('NFKC').toLowerCase().replace(/[\s·•・()（）[\]【】「」『』"'“”‘’_\-—–]+/gu, '');
const SYNONYM_KEYS = SYNONYMS.map((group) => [...new Set(group.map(subjectKey).filter(Boolean))]);

/** 科目本身 + 同义词（线代 = 线性代数，雅思 = ielts） */
function subjectAliases(key: string): string[] {
  const out = new Set([key]);
  for (const group of SYNONYM_KEYS) if (group.includes(key)) group.forEach((alias) => out.add(alias));
  return [...out];
}

/** 包含关系也算同一科目（线性代数 ⊂ 线性代数II）；英文短词要求两侧不是字母，避免 gre ⊂ progress */
function contains(long: string, short: string): boolean {
  if (short.length < 2 || long.length <= short.length) return false;
  const ascii = /^[\x20-\x7e]+$/.test(short);
  for (let i = long.indexOf(short); i >= 0; i = long.indexOf(short, i + 1)) {
    if (!ascii) return true;
    const before = long[i - 1] ?? '';
    const after = long[i + short.length] ?? '';
    if (!/[a-z]/.test(before) && !/[a-z]/.test(after)) return true;
  }
  return false;
}

interface Subject { label: string; aliases: string[] }

function subjectsOf(p: ProfileInput): Subject[] {
  const seen = new Set<string>();
  const out: Subject[] = [];
  for (const label of list(p.subjects)) {
    const key = subjectKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ label: label.trim(), aliases: subjectAliases(key) });
  }
  return out;
}

const sameSubject = (a: Subject, b: Subject) =>
  a.aliases.some((x) => b.aliases.some((y) => x === y || contains(x, y) || contains(y, x)));

const DAY_MS = 86_400_000;
function dayNumber(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!m) return null;
  const time = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(time) ? null : time / DAY_MS;
}

// ---------- 学习性格 ----------

const answered = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;
const SIMILAR_ITEMS = PERSONALITY_ITEMS.filter((item) => item.mode === 'similar');
const personalityOf = (p: ProfileInput): Partial<Personality> => (p.personality && typeof p.personality === 'object' ? p.personality : {});
const trait = (p: ProfileInput, key: PersonalityKey) => {
  const n = personalityOf(p)[key];
  return answered(n) ? n : null;
};

/** 两人都偏向同一端时的自然描述 */
const SHARED_TRAIT: Partial<Record<PersonalityKey, [low: string, high: string]>> = {
  talk: ['都喜欢安静专注', '都喜欢边学边聊'],
  noise: ['都需要安静环境', '都不介意环境嘈杂'],
  punctual: ['对时间都比较随意', '都很守时'],
  plan: ['都比较随性', '都按计划推进'],
  social: ['都只想专心学习', '学习之外也都愿意一起玩'],
};

function mbtiOf(raw: string): string | null {
  const m = /^([EI])([SN])([TF])([JP])(?:-[AT])?$/.exec(String(raw ?? '').normalize('NFKC').trim().toUpperCase());
  return m ? m.slice(1, 5).join('') : null;
}

/** E/I、J/P 各 1 分，S/N、T/F 各 0.5 分，满分 3 */
function mbtiSimilarity(a: ProfileInput, b: ProfileInput): number | null {
  const x = mbtiOf(a.mbti);
  const y = mbtiOf(b.mbti);
  if (!x || !y) return null;
  return (Number(x[0] === y[0]) + Number(x[3] === y[3]) + 0.5 * Number(x[1] === y[1]) + 0.5 * Number(x[2] === y[2])) / 3;
}

const DISLIKE_SHORT: Record<string, string> = { social: '过度社交', silent: '全程沉默', late: '迟到爽约' };

/** a 的雷区（dislikeTags）是否可能被 b 触及 */
function dislikeHits(a: ProfileInput, b: ProfileInput): { tag: string; why: string }[] {
  const tags = new Set(list(a.dislikeTags));
  const talk = trait(b, 'talk');
  const social = trait(b, 'social');
  const punctual = trait(b, 'punctual');
  const hits: { tag: string; why: string }[] = [];
  if (tags.has('social')) {
    const why = talk !== null && talk >= 4 ? 'TA 学习时喜欢边学边聊' : social !== null && social >= 5 ? 'TA 很想在学习之外一起玩'
      : b.studyType === 'discuss' ? 'TA 偏好边学边讨论' : '';
    if (why) hits.push({ tag: 'social', why });
  }
  if (tags.has('silent')) {
    const why = talk !== null && talk <= 2 ? 'TA 学习时几乎不说话' : b.studyType === 'quiet' ? 'TA 偏好各自安静学' : '';
    if (why) hits.push({ tag: 'silent', why });
  }
  if (tags.has('late') && punctual !== null && punctual <= 2) hits.push({ tag: 'late', why: 'TA 对守时要求不高' });
  return hits;
}

interface PersonalityDirection {
  value: number | null;
  /** 该方向信息量：有量表题 1，只有 MBTI 或只有雷区信息 0.5，没有 0 */
  info: number;
  items: number;
  mbti: number | null;
  hits: { tag: string; why: string }[];
}

/** s(A←B)：B 的学习性格满足 A 的程度 */
function personalityToward(a: ProfileInput, b: ProfileInput): PersonalityDirection {
  const scores: number[] = [];
  for (const item of SIMILAR_ITEMS) {
    const x = trait(a, item.key);
    const y = trait(b, item.key);
    if (x !== null && y !== null) scores.push(1 - Math.abs(x - y) / 4);
  }
  const need = trait(a, 'needSupervision');
  const give = trait(b, 'giveSupervision');
  if (need !== null && give !== null) scores.push(1 - Math.max(0, need - give) / 4);
  const likert = scores.length ? scores.reduce((sum, n) => sum + n, 0) / scores.length : null;
  const mbti = mbtiSimilarity(a, b);
  let value = likert !== null ? (mbti !== null ? 0.8 * likert + 0.2 * mbti : likert) : mbti;
  const hits = dislikeHits(a, b);
  if (hits.length) value = (value ?? 0.5) * 0.6 ** hits.length;
  return { value, info: likert !== null ? 1 : value !== null ? 0.5 : 0, items: scores.length, mbti, hits };
}

// ---------- 学习方式、地点、节奏 ----------

const STYLE_PAIRS: Record<string, number> = { 'checkin|quiet': 0.5, 'checkin|discuss': 0.5, 'discuss|quiet': 0.15 };
function styleSimilarity(x: string, y: string): number | null {
  if (!STYLE_VALUES.has(x) || !STYLE_VALUES.has(y)) return null;
  if (x === y) return 1;
  if (x === 'flexible' || y === 'flexible') return 0.7;
  return STYLE_PAIRS[[x, y].sort().join('|')] ?? 0;
}
const styleLabel = (value: string) => optionLabel(STUDY_TYPES, value);

/** s(A←B)：A 期望的地点（没填期望则用 A 自己的地点）与 B 实际地点 */
function placesToward(a: ProfileInput, b: ProfileInput): { value: number | null; shared: string[]; any: boolean } {
  const expected = answerSet(a.expectedPlaces, PLACE_VALUES, 'other', a.expectedPlacesOther, true);
  const wanted = expected.count ? expected : answerSet(a.places, PLACE_VALUES, 'other', a.placesOther, true);
  const actual = answerSet(b.places, PLACE_VALUES, 'other', b.placesOther, true);
  if (!wanted.count || !actual.count) return { value: null, shared: [], any: false };
  if (wanted.values.has('choice:any') || actual.values.has('choice:any')) return { value: 1, shared: [], any: true };
  const shared = common(wanted, actual);
  return { value: shared.length ? 1 : 0.25, shared, any: false };
}

const FREQUENCY_ORDER = ['daily', 'weekly3', 'weekly1'];
const DURATION_ORDER = ['short', 'medium', 'long'];
function frequencySimilarity(x: string, y: string): number | null {
  if (!FREQUENCIES.some((o) => o.value === x) || !FREQUENCIES.some((o) => o.value === y)) return null;
  if (x === y) return 1;
  if (x === 'irregular' || y === 'irregular') return 0.6;
  return Math.abs(FREQUENCY_ORDER.indexOf(x) - FREQUENCY_ORDER.indexOf(y)) === 1 ? 0.6 : 0.2;
}
function durationSimilarity(x: string, y: string): number | null {
  if (!DURATION_ORDER.includes(x) || !DURATION_ORDER.includes(y)) return null;
  if (x === y) return 1;
  return Math.abs(DURATION_ORDER.indexOf(x) - DURATION_ORDER.indexOf(y)) === 1 ? 0.6 : 0.3;
}

// ---------- 汇总 ----------

interface Note { text: string; weight: number }
interface Part {
  forMe: number | null;
  forThem: number | null;
  /** 维度信息量（0–1），只有学习性格可能是部分信息 */
  info?: number;
  detail: string;
  /** 推荐理由：weight 用于在维度内排序（贡献 = 维度权重 × 相似度 × weight） */
  reasons?: Note[];
  /** 提醒：weight 越大越优先 */
  cautions?: Note[];
}

function timePart(a: ProfileInput, b: ProfileInput, commonSlots: number[], overlapHours: number): Part {
  const scored = scoredHours(commonSlots);
  const needA = weeklyNeedHours(a);
  const needB = weeklyNeedHours(b);
  const forMe = Math.min(1, scored / needA);
  const forThem = Math.min(1, scored / needB);
  const overnight = commonSlots.some((slot) => PERIODS[slotPeriod(slot)].hours > 2);
  const reasons: Note[] = [{
    text: forMe >= 1 && forThem >= 1 ? `每周有 ${hours(overlapHours)} 小时共同时间，满足你们的学习时长`
      : forMe >= 1 ? `每周有 ${hours(overlapHours)} 小时共同时间，满足你的学习时长`
      : `每周有 ${hours(overlapHours)} 小时共同时间`,
    weight: 1,
  }];
  const cautions: Note[] = [];
  if (forMe < 0.5) {
    const lead = overnight ? `每周共同时间按计分规则约 ${hours(scored)} 小时（通宵格最多按 2 小时计）` : `每周共同时间约 ${hours(scored)} 小时`;
    cautions.push({ text: `${lead}，少于你计划的 ${hours(needA)} 小时`, weight: 8 });
  } else if (forThem < 0.5) {
    cautions.push({ text: `TA 计划每周学约 ${hours(needB)} 小时，共同时间可能不够 TA 用`, weight: 4 });
  }
  return {
    forMe, forThem, reasons, cautions,
    detail: `每周共同 ${commonSlots.length} 个时间格，约 ${hours(overlapHours)} 小时${overnight ? '（通宵格计分时最多按 2 小时）' : ''}。`
      + `按你每周约 ${hours(needA)} 小时、TA 约 ${hours(needB)} 小时的学习需求分别计算满足程度；比你更有空不会扣分。`,
  };
}

function contentPart(a: ProfileInput, b: ProfileInput): Part {
  const goalsA = answerSet(a.planTags, GOAL_VALUES, '其他', a.goalOther);
  const goalsB = answerSet(b.planTags, GOAL_VALUES, '其他', b.goalOther);
  const goalOverlap = overlap(goalsA, goalsB);
  const sharedGoals = common(goalsA, goalsB);
  const subjectsA = subjectsOf(a);
  const subjectsB = subjectsOf(b);
  const matchedA = subjectsA.filter((x) => subjectsB.some((y) => sameSubject(x, y)));
  const matchedB = subjectsB.filter((y) => subjectsA.some((x) => sameSubject(x, y)));
  const sharedSubjects = Math.min(matchedA.length, matchedB.length);
  const reasons: Note[] = [];
  const cautions: Note[] = [];
  let value: number | null;
  let detail: string;
  const goalText = goalOverlap === null ? '' : `近期目标重合 ${Math.round(goalOverlap * 100)}%`;
  if (subjectsA.length && subjectsB.length) {
    if (sharedSubjects) {
      const subjOverlap = sharedSubjects / Math.min(subjectsA.length, subjectsB.length);
      value = 0.75 + 0.25 * subjOverlap;
      detail = `共同科目：${matchedA.map((s) => s.label).join('、')}（同义词与包含关系也算同一科目）。`;
      reasons.push({ text: `都在准备 ${matchedA.slice(0, 2).map((s) => s.label).join('、')}`, weight: 1 });
    } else {
      value = 0.5 * (goalOverlap ?? 0);
      detail = `双方都填写了具体科目但没有相同科目，按同类目标的一半计分${goalText ? `（${goalText}）` : ''}。`;
      cautions.push({ text: `具体科目不同：TA 在学 ${subjectsB.slice(0, 2).map((s) => s.label).join('、')}`, weight: 5 });
    }
  } else if (goalOverlap === null) {
    value = null;
    detail = '一方或双方缺少可比较的学习目标，此项按中性计入。';
  } else {
    value = 0.8 * goalOverlap;
    const who = !subjectsA.length && !subjectsB.length ? '双方都' : !subjectsA.length ? '你还' : 'TA ';
    detail = `${who}未填写具体科目，只比较目标大类（${goalText}，按 80% 折算）。`;
    cautions.push({ text: `${who}未填写具体科目，建议确认是否学同一门课`, weight: 3 });
  }
  if (value !== null && !sharedSubjects && sharedGoals.length) {
    reasons.push({ text: `近期目标相同：${choiceLabels(sharedGoals, PLAN_PRESETS.map((p) => ({ value: p, label: p }))).join('、')}`, weight: 0.8 });
  }
  const dayA = dayNumber(a.goalDeadline);
  const dayB = dayNumber(b.goalDeadline);
  if (value !== null && dayA !== null && dayB !== null && (sharedSubjects || sharedGoals.length)) {
    const gap = Math.abs(dayA - dayB);
    if (gap <= 21) {
      value = Math.min(1, value + 0.05);
      const when = gap === 0 ? '目标日期是同一天' : `目标日期相差 ${gap} 天`;
      detail += `${when}，加 0.05。`;
      reasons.push({ text: sharedSubjects ? `${gap === 0 ? '目标日期是同一天' : '目标日期相近'}，可以一起冲刺` : `${gap === 0 ? '目标日期是同一天' : `目标日期相近（相差 ${gap} 天）`}`, weight: 0.9 });
    } else if (gap > 60) {
      cautions.push({ text: `你们的目标日期相差 ${gap} 天，冲刺节奏可能不同`, weight: 1 });
    }
  }
  return { forMe: value, forThem: value, detail, reasons, cautions };
}

function personalityPart(a: ProfileInput, b: ProfileInput): Part {
  const me = personalityToward(a, b);
  const them = personalityToward(b, a);
  if (me.value === null && them.value === null) {
    return { forMe: null, forThem: null, info: 0, detail: '一方或双方未填写学习性格与 MBTI，此项按中性计入。' };
  }
  const reasons: Note[] = [];
  const cautions: Note[] = [];
  const phrases: string[] = [];
  for (const item of SIMILAR_ITEMS) {
    const x = trait(a, item.key);
    const y = trait(b, item.key);
    if (x === null || y === null) continue;
    const pair = SHARED_TRAIT[item.key]!;
    if (Math.abs(x - y) <= 1 && x <= 2 && y <= 2) phrases.push(pair[0]);
    else if (Math.abs(x - y) <= 1 && x >= 4 && y >= 4) phrases.push(pair[1]);
    else if (Math.abs(x - y) >= 3) {
      const side = (n: number) => (n <= 2 ? item.low : item.high);
      cautions.push({ text: `${item.label}差别较大：你偏「${side(x)}」，TA 偏「${side(y)}」`, weight: 2 });
    }
  }
  if (phrases.length && me.value !== null && me.value >= 0.7) reasons.push({ text: `学习性格接近：${phrases.slice(0, 2).join('、')}`, weight: 1 });
  const needA = trait(a, 'needSupervision');
  const giveB = trait(b, 'giveSupervision');
  const needB = trait(b, 'needSupervision');
  const giveA = trait(a, 'giveSupervision');
  if (needA !== null && needA >= 4 && giveB !== null && giveB >= 4) reasons.push({ text: 'TA 愿意督促你', weight: 0.95 });
  else if (needA !== null && needA >= 4 && giveB !== null && giveB <= 2) cautions.push({ text: '你希望有人督促，但 TA 不太想管别人', weight: 6 });
  if (needB !== null && needB >= 4 && giveA !== null && giveA <= 2) cautions.push({ text: 'TA 希望有人督促，而你不太想管别人', weight: 1.5 });
  if (me.hits.length) {
    cautions.push({ text: `可能触及你的雷区：${me.hits.map((hit) => `${DISLIKE_SHORT[hit.tag]}（${hit.why}）`).join('；')}`, weight: 10 });
  }
  if (them.hits.length) cautions.push({ text: `你可能触及 TA 的雷区：${them.hits.map((hit) => DISLIKE_SHORT[hit.tag]).join('、')}`, weight: 1.8 });
  const describe = (d: PersonalityDirection) => d.items ? `${d.items} 道题可比较${d.mbti !== null ? '，含 MBTI' : ''}` : d.mbti !== null ? '只有 MBTI' : d.hits.length ? '只有雷区信息' : '没有可比信息';
  const partial = me.info + them.info < 2;
  return {
    // 一个方向缺少信息时按中性 0.5 计，保留另一方向（例如监督互补、雷区）的信号
    forMe: me.value ?? 0.5,
    forThem: them.value ?? 0.5,
    info: (me.info + them.info) / 2,
    reasons,
    cautions,
    detail: `对你：${describe(me)}；对 TA：${describe(them)}。相似题越接近越好，「需要被督促」由对方「愿意督促」来满足（方向性）；`
      + `有量表时 MBTI 只占 20%。${me.hits.length + them.hits.length ? `触及雷区的每一项使该方向 × 0.6。` : ''}${partial ? '信息不完整，覆盖度按部分计入。' : ''}`,
  };
}

function stylePart(a: ProfileInput, b: ProfileInput): Part {
  const value = styleSimilarity(a.studyType, b.studyType);
  if (value === null) return { forMe: null, forThem: null, detail: '缺少可比较的学习方式，此项按中性计入。' };
  const reasons: Note[] = [];
  const cautions: Note[] = [];
  if (value === 1) reasons.push({ text: `学习方式一致：${styleLabel(a.studyType)}`, weight: 0.9 });
  else if (value === 0.7) reasons.push({ text: b.studyType === 'flexible' ? 'TA 的学习方式灵活，可以配合你' : '你的学习方式灵活，可以配合 TA', weight: 0.6 });
  else cautions.push({ text: `学习方式${value < 0.3 ? '差别较大' : '不完全相同'}：你偏「${styleLabel(a.studyType)}」，TA 偏「${styleLabel(b.studyType)}」`, weight: value < 0.3 ? 5 : 1.2 });
  return {
    forMe: value, forThem: value, reasons, cautions,
    detail: '相同 100%；「灵活」与任意方式 70%；监督打卡与安静学或讨论 50%；安静学与边学边讨论 15%。',
  };
}

function placesPart(a: ProfileInput, b: ProfileInput): Part {
  // 硬条件已排除「线下 × 线上」；只要有一方只接受线上，两人就会在线上学习，地点不再构成限制
  if (a.studyFormat === 'online' || b.studyFormat === 'online') {
    return {
      forMe: 1, forThem: 1, detail: '线上一起学，学习地点不受限制。',
      reasons: [{
        text: a.studyFormat === 'online' && b.studyFormat === 'online' ? '都希望线上一起学'
          : a.studyFormat === 'online' ? 'TA 也可以线上一起学' : 'TA 希望线上一起学，地点不受限',
        weight: 0.7,
      }],
    };
  }
  const me = placesToward(a, b);
  const them = placesToward(b, a);
  if (me.value === null || them.value === null) return { forMe: null, forThem: null, detail: '一方或双方缺少可比较的学习地点，此项按中性计入。' };
  const reasons: Note[] = [];
  const cautions: Note[] = [];
  if (me.shared.length) reasons.push({ text: `常去同样的地点：${choiceLabels(me.shared, PLACES).join('、')}`, weight: 0.8 });
  else if (me.any && them.value === 1) reasons.push({ text: '学习地点不限，容易约', weight: 0.5 });
  if (me.value < 1) cautions.push({ text: 'TA 常去的学习地点和你期望的不同，见面地点需要商量', weight: 2.5 });
  else if (them.value < 1) cautions.push({ text: '你常去的地点不是 TA 期望的，见面地点可以商量', weight: 1 });
  return {
    forMe: me.value, forThem: them.value, reasons, cautions,
    detail: '分别比较你期望的地点与 TA 的实际地点、TA 期望的地点与你的实际地点（没填期望时用自己的地点）；有交集或「不限」100%，否则 25%（地点可商量）。',
  };
}

function rhythmPart(a: ProfileInput, b: ProfileInput): Part {
  const parts = [frequencySimilarity(a.frequency, b.frequency), durationSimilarity(a.duration, b.duration)].filter((n): n is number => n !== null);
  if (!parts.length) return { forMe: null, forThem: null, detail: '没有双方都填写的学习频率或单次时长，此项按中性计入。' };
  const value = parts.reduce((sum, n) => sum + n, 0) / parts.length;
  const reasons: Note[] = [];
  const cautions: Note[] = [];
  if (value === 1) {
    // value 为 1 说明双方都填写的每一项都相同
    const same = [frequencySimilarity(a.frequency, b.frequency) === 1 ? optionLabel(FREQUENCIES, a.frequency) : '',
      durationSimilarity(a.duration, b.duration) === 1 ? `每次${optionLabel(DURATIONS, a.duration)}` : ''].filter(Boolean);
    reasons.push({ text: `学习节奏一致：${same.join(' · ')}`, weight: 0.6 });
  } else if (value <= 0.4) cautions.push({ text: '学习频率或单次时长差别较大，需要协商', weight: 1.5 });
  return {
    forMe: value, forThem: value, reasons, cautions,
    detail: '只比较双方都填写的项：频率相同 100%、相邻或「不定期」60%、其余 20%；时长相同 100%、相邻 60%、其余 30%。',
  };
}

function interestsPart(a: ProfileInput, b: ProfileInput): Part {
  const x = answerSet(a.interests, INTEREST_VALUES, 'other', a.interestsOther);
  const y = answerSet(b.interests, INTEREST_VALUES, 'other', b.interestsOther);
  const value = overlap(x, y);
  if (value === null) return { forMe: null, forThem: null, detail: '一方或双方未填写兴趣，此项按中性计入。' };
  const shared = common(x, y);
  return {
    forMe: value, forThem: value,
    reasons: shared.length ? [{ text: `都喜欢${choiceLabels(shared, INTERESTS).join('、')}`, weight: 0.5 }] : [],
    detail: `有 ${shared.length} 项共同兴趣，按「共同项 ÷ 较少一方的选项数」计算；未补充内容的「其他」不算相同。`,
  };
}

/**
 * 核心维度（共同时间、学习内容、学习性格）低于 0.6 时额外乘以惩罚系数 0.6 + (2/3)s（s = 0 时 ×0.6，s = 0.6 时恢复为 ×1），
 * 让“时间、内容、性格都合适”才算合拍：核心短板不会被其他维度的高分平均掉；次要维度仍只按权重线性扣分。
 */
const CORE_DIMENSIONS: DimensionKey[] = ['time', 'content', 'personality'];
const CORE_THRESHOLD = 0.6;
const coreFactor = (value: number | null) => (value === null || value >= CORE_THRESHOLD ? 1 : 0.6 + (0.4 / CORE_THRESHOLD) * value);
/** 「很合拍」还要求核心维度都不低于 0.6（缺失不阻止），且可比较信息覆盖至少 80 权重 */
const tierOf = (score: number, coverage: number, dimensions: RecommendationDimension[]): RecommendationInfo['tier'] => {
  const coreOk = dimensions.every((d) => !CORE_DIMENSIONS.includes(d.key) || d.similarity === null || d.similarity >= CORE_THRESHOLD);
  return score >= 80 && coreOk && coverage >= 80 ? 'great' : score >= 65 ? 'good' : 'fair';
};

/**
 * 双向契合度。a 是“我”（查看推荐的人），b 是候选人。硬条件不满足返回 null。
 * 每个维度分别计算 s(A←B)（TA 符合你的期待）与 s(B←A)（你符合 TA 的期待），缺失维度按中性 0.5 计入，
 * 总分取两个方向的调和平均：只有双方都满意才会高分。
 */
export function recommendationFor(a: ProfileInput, b: ProfileInput): RecommendationInfo | null {
  if (hardFilter(a, b)) return null;
  const commonSlots = commonSlotsOf(a, b);
  const overlapHours = slotsHours(commonSlots);
  const parts: Record<DimensionKey, Part> = {
    time: timePart(a, b, commonSlots, overlapHours),
    content: contentPart(a, b),
    personality: personalityPart(a, b),
    style: stylePart(a, b),
    places: placesPart(a, b),
    rhythm: rhythmPart(a, b),
    interests: interestsPart(a, b),
  };
  const dimensions: RecommendationDimension[] = DIMENSION_ORDER.map((key) => {
    const part = parts[key];
    const missing = part.forMe === null || part.forThem === null;
    const forMe = missing ? null : round(part.forMe!);
    const forThem = missing ? null : round(part.forThem!);
    return {
      key, label: DIMENSION_LABELS[key], weight: DIMENSION_WEIGHTS[key],
      similarity: missing ? null : round((forMe! + forThem!) / 2), forMe, forThem, detail: part.detail,
    };
  });
  // 每个方向：加权平均（缺失维度按中性 0.5）× 核心维度短板惩罚
  const satisfaction = (side: 'forMe' | 'forThem') =>
    dimensions.reduce((sum, d) => sum + d.weight * (d[side] ?? 0.5), 0) / 100
    * dimensions.reduce((factor, d) => factor * (CORE_DIMENSIONS.includes(d.key) ? coreFactor(d[side]) : 1), 1);
  const sMe = satisfaction('forMe');
  const sThem = satisfaction('forThem');
  const score = sMe + sThem > 0 ? Math.round(100 * (2 * (sMe * sThem)) / (sMe + sThem)) : 0;
  const coverage = Math.round(dimensions.reduce((sum, d) => sum + (d.similarity === null ? 0 : d.weight * (parts[d.key].info ?? 1)), 0));

  const reasons = dimensions
    .flatMap((d, order) => (d.similarity === null ? [] : (parts[d.key].reasons ?? []).map((note) => ({ ...note, value: d.weight * d.similarity! * note.weight, order }))))
    .sort((x, y) => y.value - x.value || x.order - y.order)
    .map((note) => note.text);
  const cautions = DIMENSION_ORDER
    .flatMap((key, order) => (parts[key].cautions ?? []).map((note) => ({ ...note, order })))
    .sort((x, y) => y.weight - x.weight || x.order - y.order)
    .map((note) => note.text);
  return {
    version: RECOMMENDATION_VERSION,
    score,
    forMe: Math.round(100 * sMe),
    forThem: Math.round(100 * sThem),
    tier: tierOf(score, coverage, dimensions),
    coverage,
    overlapHours,
    commonSlots,
    reasons: [...new Set(reasons)].slice(0, 4),
    cautions: [...new Set(cautions)].slice(0, 3),
    dimensions,
  };
}

/** 稳定排序：契合度 ↓、信息覆盖 ↓、共同小时 ↓、用户 id ↑，与数据库顺序和刷新无关 */
export function compareRecommendationCards(a: ProfileCard, b: ProfileCard): number {
  const left = a.recommendation!;
  const right = b.recommendation!;
  return right.score - left.score || right.coverage - left.coverage || right.overlapHours - left.overlapHours || a.id - b.id;
}
