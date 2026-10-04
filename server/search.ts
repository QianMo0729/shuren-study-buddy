import { SLOT_COUNT, overlapSlots, slotsHours } from '../shared/options.ts';
import { collegeOf } from '../shared/majors.ts';
import type { AdvancedQuery, Criterion, CriterionField, MatchInfo, ProfileInput } from '../shared/types.ts';

import { expand, tokenize } from '../shared/searchText.ts';
export { expand, tokenize } from '../shared/searchText.ts';

export function snippet(text: string, words: string[]) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return undefined;
  const start = Math.max(0, at - 16);
  return (start > 0 ? '…' : '') + text.slice(start, start + 60) + (start + 60 < text.length ? '…' : '');
}

/** 关键词仅检索自我介绍；专业、昵称和标签使用独立筛选条件。 */
export function keywordMatch(_nickname: string, d: ProfileInput, tokens: string[]): { info: MatchInfo; weight: number } | null {
  const text = d.bio.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];
  let snip: string | undefined;
  for (const token of tokens) {
    const words = expand(token);
    if (words.some((word) => text.includes(word))) {
      matched.push(`${token}·自我介绍`);
      snip ??= snippet(d.bio, words);
    } else missed.push(token);
  }
  if (!matched.length) return null;
  return { info: { score: matched.length, total: tokens.length, matched, missed, snippet: snip }, weight: matched.length };
}

// ---------- 高级检索 ----------

/** 每个文本条件最多使用的词数（防止超长条件拖慢检索） */
const MAX_TERMS = 16;

/** 文本类条件的值可以一次写多个词（空格、逗号、顿号分隔），命中任意一个即可 */
const textTerms = (values: string[]) => [...new Set(values.flatMap(tokenize))].slice(0, MAX_TERMS);

/** 科目名标准化：全角转半角、忽略大小写与空白（「C 语言」=「c语言」） */
export const normalizeSubject = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');

/** 科目条件：按逗号、顿号等分隔（不按空格，以免拆开「C 语言程序设计」）；同义词扩展，包含关系也算同一科目 */
export function subjectsHit(values: string[], subjects: string[]): boolean {
  if (!subjects.length) return false;
  const mine = subjects.map(normalizeSubject).filter(Boolean);
  const terms = values
    .flatMap((v) => v.split(/[,，、;；/|]+/))
    .map(normalizeSubject)
    .filter(Boolean)
    .slice(0, MAX_TERMS)
    .flatMap((t) => expand(t).map(normalizeSubject));
  return terms.some((t) => mine.some((s) => s.includes(t) || (s.length >= 2 && t.includes(s))));
}

/** 文本是否包含任一关键词（含同义词）；返回命中的同义词列表，供生成摘要 */
export function textHit(text: string, values: string[]): string[] | null {
  const lower = text.toLowerCase();
  const hits = textTerms(values).flatMap(expand).filter((word) => lower.includes(word));
  return hits.length ? hits : null;
}

/**
 * 单个条件是否命中一位同学的主页资料。
 * 同学检索与社区帖子检索（作者条件）共用；'postText' 不属于主页资料，在这里总是未命中。
 */
export function criterionHit(c: Criterion, d: ProfileInput, nickname: string, mySchedule: number[]): boolean {
  const v = c.values;
  switch (c.field) {
    case 'major': return v.includes(d.major);
    case 'college': return v.includes(collegeOf(d.major));
    case 'gender': return v.includes(d.gender);
    case 'grade': return v.includes(d.grade);
    case 'studyType': return v.includes(d.studyType);
    case 'futurePlan': return v.includes(d.futurePlan);
    case 'modes': return d.modes.some((x) => v.includes(x));
    case 'places': return d.places.some((x) => v.includes(x));
    case 'traits': return d.traits.some((x) => v.includes(x));
    case 'sports': return d.sports.some((x) => v.includes(x));
    case 'planTags': return d.planTags.some((x) => v.includes(x));
    case 'status': return v.includes(d.status);
    case 'studyMethods': return d.studyMethods.some((x) => v.includes(x));
    case 'frequency': return v.includes(d.frequency);
    case 'duration': return v.includes(d.duration);
    case 'interests': return d.interests.some((x) => v.includes(x));
    case 'expectedPlaces': return d.expectedPlaces.some((x) => v.includes(x));
    case 'expectations': return textHit(d.expectations, v) !== null;
    case 'schedule': return v.some((slot) => d.schedule.includes(Number(slot)));
    case 'overlap': return slotsHours(overlapSlots(d.schedule, mySchedule)) >= Number(v[0] || 1);
    case 'text': return textTerms(v).some((t) => keywordMatch(nickname, d, [t]) !== null);
    case 'subjects': return subjectsHit(v, d.subjects);
    default: return false;
  }
}

/** 同学检索可用的条件 */
export const PROFILE_SEARCH_FIELDS: readonly CriterionField[] = [
  'major', 'college', 'gender', 'grade', 'studyType', 'futurePlan', 'modes', 'places', 'traits', 'sports',
  'planTags', 'status', 'studyMethods', 'frequency', 'duration', 'interests', 'expectedPlaces', 'expectations',
  'schedule', 'overlap', 'text', 'subjects',
];

/** 社区帖子检索可用的条件：postText 检索标题与正文，其余检索作者对我可见的主页 */
export const POST_SEARCH_FIELDS: readonly CriterionField[] = [
  'postText', 'major', 'college', 'gender', 'grade', 'studyType', 'places', 'planTags', 'status', 'studyMethods',
  'frequency', 'duration', 'interests', 'subjects', 'text',
];

export function normalizeQuery(raw: any, fields: readonly CriterionField[] = PROFILE_SEARCH_FIELDS): AdvancedQuery {
  const allowed = new Set(fields);
  const seen = new Set<CriterionField>();
  const criteria: Criterion[] = (Array.isArray(raw?.criteria) ? raw.criteria : [])
    .slice(0, 64)
    .map((c: any) => ({
      field: String(c?.field ?? '') as CriterionField,
      mode: ['must', 'not'].includes(c?.mode) ? c.mode : 'should',
      values: [...new Set((Array.isArray(c?.values) ? c.values : []).map((x: unknown) => String(x).trim().slice(0, 80)).filter(Boolean))].slice(0, SLOT_COUNT) as string[],
    }))
    .filter((c: Criterion) => {
      if (!allowed.has(c.field) || seen.has(c.field)) return false;
      if (c.field === 'schedule') c.values = c.values.filter((v) => /^\d+$/.test(v) && Number(v) < SLOT_COUNT);
      if (c.field === 'overlap') c.values = c.values.filter((v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 168).slice(0, 1);
      if (!c.values.length) return false;
      seen.add(c.field);
      return true;
    })
    .slice(0, allowed.size);
  return { criteria, matchMode: raw?.matchMode === 'fuzzy' ? 'fuzzy' : 'precise', mutualGender: !!raw?.mutualGender };
}

/**
 * 仿知网的组合规则：必须与排除始终生效；精确检索需命中过半加分项（floor(n/2)+1），模糊检索需命中至少一项。
 * hit 决定每个条件是否命中，便于同学检索与帖子检索共用同一套规则。
 */
export function evaluateCriteria(query: AdvancedQuery, hit: (c: Criterion) => boolean): MatchInfo | null {
  const matched: string[] = [];
  const missed: string[] = [];
  let shouldCount = 0;
  let shouldHits = 0;
  for (const [i, c] of query.criteria.entries()) {
    const ok = hit(c);
    if (c.mode === 'not') {
      if (ok) return null;
      continue;
    }
    if (c.mode === 'must' && !ok) return null;
    if (c.mode === 'should') {
      shouldCount++;
      if (ok) shouldHits++;
    }
    (ok ? matched : missed).push(`${i}:${c.field}`);
  }
  const threshold = query.matchMode === 'fuzzy' ? 1 : Math.floor(shouldCount / 2) + 1;
  if (shouldCount > 0 && shouldHits < threshold) return null;
  return { score: matched.length, total: matched.length + missed.length, matched, missed };
}

/** 同学检索 */
export function advancedMatch(
  query: AdvancedQuery,
  nickname: string,
  d: ProfileInput,
  me: { gender: string; schedule: number[] },
): MatchInfo | null {
  if (query.mutualGender && d.buddyGender && d.buddyGender !== 'any' && me.gender && d.buddyGender !== me.gender) return null;
  return evaluateCriteria(query, (c) => criterionHit(c, d, nickname, me.schedule));
}
