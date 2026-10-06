import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyProfile } from '../shared/profileRules.ts';
import type { Criterion, ProfileInput } from '../shared/types.ts';
import { POST_SEARCH_FIELDS, advancedMatch, criterionHit, evaluateCriteria, keywordMatch, normalizeQuery, subjectsHit, tokenize } from '../server/search.ts';

const profile: ProfileInput = {
  ...emptyProfile(), major: '计算机科学与技术', gender: 'female', grade: 'y2', studyType: 'quiet',
  bio: '最近在复习线性代数，希望一起刷题。', studyPlan: '托福备考', planTags: ['语言考试'],
  mbti: 'INTJ', schedule: [0, 7], interests: ['sports'], studyMethods: ['practice'],
  frequency: 'weekly1', duration: 'short', status: 'seeking', expectedPlaces: ['library'],
  expectations: '希望搭子守时，可以互相监督',
};
const me = { gender: 'male', schedule: [0, 1] };
const should = (field: Criterion['field'], values: string[]): Criterion => ({ field, values, mode: 'should' });

test('keywords only inspect self-introduction and preserve matching snippets', () => {
  assert.equal(keywordMatch('雅思达人', profile, ['雅思']), null);
  assert.equal(keywordMatch('同学', profile, ['计算机']), null);
  assert.equal(keywordMatch('同学', profile, ['托福']), null);
  assert.equal(keywordMatch('同学', profile, ['语言考试']), null);
  assert.equal(keywordMatch('同学', profile, ['INTJ']), null);
  const hit = keywordMatch('同学', profile, tokenize('线代 线代 雅思'))!;
  assert.equal(hit.info.score, 1);
  assert.equal(hit.info.total, 2);
  assert.deepEqual(hit.info.matched, ['线代·自我介绍']);
  assert.deepEqual(hit.info.missed, ['雅思']);
  assert.match(hit.info.snippet!, /线性代数/);
});

test('precise search requires strictly more than half of optional conditions; fuzzy needs one', () => {
  const twoOfFour = [should('gender', ['female']), should('studyType', ['quiet']), should('grade', ['y4']), should('status', ['busy'])];
  assert.equal(advancedMatch({ criteria: twoOfFour, matchMode: 'precise' }, '', profile, me), null);
  const fuzzy = advancedMatch({ criteria: twoOfFour, matchMode: 'fuzzy' }, '', profile, me)!;
  assert.equal(fuzzy.score, 2);
  assert.equal(fuzzy.total, 4);
  const threeOfFour = [...twoOfFour.slice(0, 3), should('status', ['seeking'])];
  assert.equal(advancedMatch({ criteria: threeOfFour, matchMode: 'precise' }, '', profile, me)?.score, 3);
  assert.equal(advancedMatch({ criteria: [should('grade', ['y4'])], matchMode: 'fuzzy' }, '', profile, me), null);
});

test('must and exclusion are binding in both modes and must does not inflate optional matches', () => {
  for (const matchMode of ['precise', 'fuzzy'] as const) {
    assert.equal(advancedMatch({ matchMode, criteria: [{ field: 'gender', values: ['male'], mode: 'must' }, should('status', ['seeking'])] }, '', profile, me), null);
    assert.equal(advancedMatch({ matchMode, criteria: [{ field: 'gender', values: ['female'], mode: 'not' }, should('status', ['seeking'])] }, '', profile, me), null);
    assert.equal(advancedMatch({ matchMode, criteria: [{ field: 'gender', values: ['female'], mode: 'must' }, should('status', ['busy'])] }, '', profile, me), null);
    assert.ok(advancedMatch({ matchMode, criteria: [{ field: 'gender', values: ['female'], mode: 'must' }] }, '', profile, me));
  }
});

test('new questionnaire fields and free-time slots are independently searchable', () => {
  const criteria = [
    should('planTags', ['语言考试']), should('status', ['seeking']), should('studyMethods', ['practice']),
    should('frequency', ['weekly1']), should('duration', ['short']), should('interests', ['sports']),
    should('expectedPlaces', ['library']), should('expectations', ['守时']), should('schedule', ['7']),
    should('overlap', ['2']), should('text', ['线代']),
  ];
  const hit = advancedMatch({ criteria, matchMode: 'precise' }, '', profile, me)!;
  assert.equal(hit.score, criteria.length);
  assert.equal(hit.total, criteria.length);
  assert.ok(hit.matched.includes('8:schedule'));
  assert.equal(advancedMatch({ criteria: [should('schedule', ['1'])] }, '', profile, me), null);
  assert.equal(advancedMatch({ criteria: [should('overlap', ['3'])] }, '', profile, me), null);
});

test('normalization strips MBTI, unknown/duplicate/empty fields and ignores arbitrary thresholds', () => {
  const normalized = normalizeQuery({
    matchMode: 'fuzzy', minMatch: 0, criteria: [
      { field: 'mbti', values: ['INTJ'] }, { field: '__proto__', values: ['x'] },
      { field: 'gender', values: ['female', 'female'], mode: 'must' }, { field: 'gender', values: ['male'] },
      { field: 'status', values: ['  '] }, { field: 'schedule', values: ['-1', '70', '7', 'NaN', '0'] },
      { field: 'overlap', values: ['Infinity', '-1', '0', '2'] },
    ],
  });
  assert.equal(normalized.matchMode, 'fuzzy');
  assert.equal(normalized.minMatch, undefined);
  assert.deepEqual(normalized.criteria, [
    { field: 'gender', mode: 'must', values: ['female'] },
    { field: 'schedule', mode: 'should', values: ['7', '0'] },
    { field: 'overlap', mode: 'should', values: ['2'] },
  ]);
  assert.equal(normalizeQuery({ matchMode: 'unrecognized' }).matchMode, 'precise');
});

test('gender preference is an optional mutual filter and empty criteria list remains browsable', () => {
  assert.ok(advancedMatch({ criteria: [] }, '', profile, me));
  const femalePreference = { ...profile, buddyGender: 'female' };
  assert.equal(advancedMatch({ criteria: [], mutualGender: true }, '', femalePreference, me), null);
  assert.ok(advancedMatch({ criteria: [], mutualGender: false }, '', femalePreference, me));
});

test('hidden genders cannot be identified through profile or post-author criteria, including exclusion and scoring', () => {
  const hidden: ProfileInput = { ...profile, genderVisibility: 'private' };
  for (const value of ['female', 'male', 'other']) {
    for (const mode of ['must', 'should', 'not'] as const) {
      const criterion: Criterion = { field: 'gender', values: [value], mode };
      assert.equal(criterionHit(criterion, hidden, '', []), false);
      const query = { matchMode: 'fuzzy' as const, criteria: [criterion, should('studyType', ['quiet'])] };
      const female = advancedMatch(query, '', hidden, me);
      const male = advancedMatch(query, '', { ...hidden, gender: 'male' }, me);
      assert.deepEqual(female, male, `hidden gender must not affect ${mode} ${value} search`);
      assert.deepEqual(evaluateCriteria(query, (c) => criterionHit(c, hidden, '', [])), female);
      assert.ok(!female?.matched.some((field) => field.endsWith(':gender')));
    }
  }
  assert.equal(criterionHit(should('gender', ['female']), profile, '', []), true);
  assert.ok(advancedMatch({ criteria: [] }, '', hidden, me));
});

test('subjects criterion normalizes width, case, spacing, synonyms and containment', () => {
  const learner = { ...profile, subjects: ['线性代数II', 'C 语言程序设计', 'IELTS'] };
  for (const value of ['线代', '线性代数', 'c语言', 'Ｃ 语言程序设计', '雅思', '数分、线代']) {
    assert.ok(criterionHit(should('subjects', [value]), learner, '', []), value);
  }
  assert.equal(criterionHit(should('subjects', ['高数']), learner, '', []), false);
  assert.equal(subjectsHit(['线代'], []), false);
  assert.ok(advancedMatch({ criteria: [{ field: 'subjects', mode: 'must', values: ['ielts'] }] }, '', learner, me));
  assert.equal(advancedMatch({ criteria: [{ field: 'subjects', mode: 'not', values: ['雅思'] }] }, '', learner, me), null);
});

test('text conditions accept several words and hit when any of them appears', () => {
  assert.ok(criterionHit(should('text', ['雅思 线代']), profile, '', []));
  assert.ok(criterionHit(should('expectations', ['准时、监督']), profile, '', []));
  assert.equal(criterionHit(should('text', ['雅思 托福']), profile, '', []), false);
  // postText 不属于主页资料
  assert.equal(criterionHit(should('postText', ['线代']), profile, '', []), false);
});

test('people search keeps subjects but drops post-only fields; post search keeps postText and author fields only', () => {
  const raw = { criteria: [
    { field: 'subjects', values: ['线代'] }, { field: 'postText', values: ['晚霞'] }, { field: 'overlap', values: ['2'] },
    { field: 'gender', values: ['female'] },
  ] };
  assert.deepEqual(normalizeQuery(raw).criteria.map((c) => c.field), ['subjects', 'overlap', 'gender']);
  assert.deepEqual(normalizeQuery(raw, POST_SEARCH_FIELDS).criteria.map((c) => c.field), ['subjects', 'postText', 'gender']);
});

test('shared criteria evaluation: precise majority, fuzzy, must and not', () => {
  const hits: Record<string, boolean> = { gender: true, grade: false, status: false };
  const query = (matchMode: 'precise' | 'fuzzy', extra: Criterion[] = []) => ({
    matchMode, criteria: [should('gender', ['x']), should('grade', ['x']), should('status', ['x']), ...extra],
  });
  const hit = (c: Criterion) => hits[c.field] ?? false;
  assert.equal(evaluateCriteria(query('precise'), hit), null);
  assert.deepEqual(evaluateCriteria(query('fuzzy'), hit), { score: 1, total: 3, matched: ['0:gender'], missed: ['1:grade', '2:status'] });
  // 不可见作者：所有作者条件都“未命中”，因此「排除」不排除，「必须」不通过
  const never = () => false;
  assert.ok(evaluateCriteria({ criteria: [{ field: 'major', mode: 'not', values: ['x'] }] }, never));
  assert.equal(evaluateCriteria({ criteria: [{ field: 'major', mode: 'must', values: ['x'] }] }, never), null);
});
