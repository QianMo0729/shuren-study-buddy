import { SLOT_COUNT, overlapSlots, slotsHours } from '../shared/options.ts';
import { collegeOf } from '../shared/majors.ts';
import type { AdvancedQuery, Criterion, CriterionField, MatchInfo, ProfileInput } from '../shared/types.ts';

import { expand } from '../shared/searchText.ts';
export { expand, tokenize } from '../shared/searchText.ts';

function snippet(text: string, words: string[]) {
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

function criterionHit(c: Criterion, d: ProfileInput, nickname: string, mySchedule: number[]): boolean {
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
    case 'expectations': return v.some((term) => expand(term).some((word) => d.expectations.toLowerCase().includes(word)));
    case 'schedule': return v.some((slot) => d.schedule.includes(Number(slot)));
    case 'overlap': return slotsHours(overlapSlots(d.schedule, mySchedule)) >= Number(v[0] || 1);
    case 'text': return v.some((t) => keywordMatch(nickname, d, [t]) !== null);
    default: return false;
  }
}

const SEARCH_FIELDS = new Set<CriterionField>([
  'major', 'college', 'gender', 'grade', 'studyType', 'futurePlan', 'modes', 'places', 'traits', 'sports',
  'planTags', 'status', 'studyMethods', 'frequency', 'duration', 'interests', 'expectedPlaces', 'expectations',
  'schedule', 'overlap', 'text',
]);

export function normalizeQuery(raw: any): AdvancedQuery {
  const seen = new Set<CriterionField>();
  const criteria: Criterion[] = (Array.isArray(raw?.criteria) ? raw.criteria : [])
    .map((c: any) => ({
      field: String(c?.field ?? '') as CriterionField,
      mode: ['must', 'not'].includes(c?.mode) ? c.mode : 'should',
      values: [...new Set((Array.isArray(c?.values) ? c.values : []).map((x: unknown) => String(x).trim().slice(0, 80)).filter(Boolean))].slice(0, SLOT_COUNT) as string[],
    }))
    .filter((c: Criterion) => {
      if (!SEARCH_FIELDS.has(c.field) || seen.has(c.field)) return false;
      if (c.field === 'schedule') c.values = c.values.filter((v) => /^\d+$/.test(v) && Number(v) < SLOT_COUNT);
      if (c.field === 'overlap') c.values = c.values.filter((v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 168).slice(0, 1);
      if (!c.values.length) return false;
      seen.add(c.field);
      return true;
    })
    .slice(0, SEARCH_FIELDS.size);
  return { criteria, matchMode: raw?.matchMode === 'fuzzy' ? 'fuzzy' : 'precise', mutualGender: !!raw?.mutualGender };
}

/** 必须与排除始终生效；精确检索需命中过半加分项，模糊检索需命中至少一项。 */
export function advancedMatch(
  query: AdvancedQuery,
  nickname: string,
  d: ProfileInput,
  me: { gender: string; schedule: number[] },
): MatchInfo | null {
  if (query.mutualGender && d.buddyGender && d.buddyGender !== 'any' && me.gender && d.buddyGender !== me.gender) return null;
  const matched: string[] = [];
  const missed: string[] = [];
  let shouldCount = 0;
  let shouldHits = 0;
  for (const [i, c] of query.criteria.entries()) {
    const hit = criterionHit(c, d, nickname, me.schedule);
    if (c.mode === 'not') {
      if (hit) return null;
      continue;
    }
    if (c.mode === 'must' && !hit) return null;
    if (c.mode === 'should') {
      shouldCount++;
      if (hit) shouldHits++;
    }
    (hit ? matched : missed).push(`${i}:${c.field}`);
  }
  const threshold = query.matchMode === 'fuzzy' ? 1 : Math.floor(shouldCount / 2) + 1;
  if (shouldCount > 0 && shouldHits < threshold) return null;
  return { score: matched.length, total: matched.length + missed.length, matched, missed };
}
