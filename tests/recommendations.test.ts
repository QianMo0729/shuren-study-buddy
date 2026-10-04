import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyProfile } from '../shared/profileRules.ts';
import type { ProfileCard, ProfileInput, RecommendationDimension, RecommendationInfo } from '../shared/types.ts';
import { compareRecommendationCards, recommendationFor } from '../server/recommendations.ts';

const profile = (changes: Partial<ProfileInput> = {}): ProfileInput => ({
  ...emptyProfile(), realName: '测试同学', schedule: [0, 1, 2], planTags: ['期末复习备考'],
  studyType: 'quiet', places: ['library'], privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true },
  ...changes,
});
const score = (a: ProfileInput, b = a) => {
  const result = recommendationFor(a, b);
  assert.ok(result, 'fixture must have jointly feasible time');
  return result;
};
const dimension = (result: RecommendationInfo, key: RecommendationDimension['key']) => result.dimensions.find((item) => item.key === key)!;

test('no common time means no recommendation, including mutually incompatible expected schedules', () => {
  assert.equal(recommendationFor(profile({ schedule: [0] }), profile({ schedule: [1] })), null);
  assert.equal(recommendationFor(profile({ schedule: [] }), profile()), null);
  assert.equal(recommendationFor(profile({ schedule: [0, 1], expectedSchedule: [1] }), profile({ schedule: [0, 1], expectedSchedule: [0] })), null);
  assert.equal(recommendationFor(profile({ expectedSchedule: [40] }), profile()), null);
});

test('both actual and expected availability constrain overlap, and invalid/duplicate slots cannot inflate it', () => {
  const a = profile({ schedule: [0, 1, 1, -1, 63, 1.5, NaN], expectedSchedule: [0, 1] });
  const b = profile({ schedule: [1, 2], expectedSchedule: [1] });
  const result = score(a, b);
  assert.deepEqual(result.commonSlots, [1]);
  assert.equal(result.overlapHours, 2);
  assert.deepEqual(result, score(profile({ schedule: [0, 1] }), profile({ schedule: [1] })));
});

test('overnight slots show actual hours but earn exactly the same compatibility as one daytime slot', () => {
  const daytime = score(profile({ schedule: [0] }));
  const overnight = score(profile({ schedule: [8] }));
  assert.equal(daytime.overlapHours, 2);
  assert.equal(overnight.overlapHours, 8);
  assert.equal(daytime.score, overnight.score);
  assert.equal(dimension(daytime, 'time').similarity, dimension(overnight, 'time').similarity);
  assert.ok(dimension(score(profile()), 'time').similarity! > dimension(daytime, 'time').similarity!);
});

test('time rewards jointly usable share as well as sufficient common slots', () => {
  const bothFocused = score(profile({ schedule: [0, 1, 2] }));
  const oneBroad = score(profile({ schedule: [0, 1, 2] }), profile({ schedule: [0, 1, 2, 3, 4, 5] }));
  assert.equal(bothFocused.overlapHours, oneBroad.overlapHours);
  assert.ok(dimension(bothFocused, 'time').similarity! > dimension(oneBroad, 'time').similarity!);
  assert.deepEqual(oneBroad, score(profile({ schedule: [0, 1, 2, 3, 4, 5] }), profile({ schedule: [0, 1, 2] })));
});

test('set dimensions use symmetric Dice and ignore duplicate answers', () => {
  const a = profile({ planTags: ['语言考试', '考研', '考研'], studyMethods: ['practice', 'courses'], interests: ['music', 'reading'] });
  const b = profile({ planTags: ['考研', '技能自学'], studyMethods: ['practice'], interests: ['music', 'movies'] });
  const result = score(a, b);
  assert.equal(dimension(result, 'goals').similarity, 0.5);
  assert.equal(dimension(result, 'methods').similarity, 0.6667);
  assert.equal(dimension(result, 'interests').similarity, 0.5);
  assert.deepEqual(result, score(b, a));
});

test('other answers never create a match without matching nonempty normalized supplements', () => {
  const blank = profile({ planTags: ['其他'], studyMethods: ['other'], interests: ['other'] });
  const blankResult = score(blank);
  for (const key of ['goals', 'methods', 'interests'] as const) assert.equal(dimension(blankResult, key).similarity, 0);
  const a = { ...blank, goalOther: '  ＡＩ  论文 ', studyMethodsOther: 'Ｃ＋＋  小组', interestsOther: '  模型   制作  ' };
  const b = { ...blank, goalOther: 'ai 论文', studyMethodsOther: 'c++ 小组', interestsOther: '模型 制作' };
  const matching = score(a, b);
  for (const key of ['goals', 'methods', 'interests'] as const) assert.equal(dimension(matching, key).similarity, 1);
  const different = score(a, { ...b, goalOther: '机器人论文', studyMethodsOther: 'C 小组', interestsOther: '陶艺' });
  for (const key of ['goals', 'methods', 'interests'] as const) assert.equal(dimension(different, key).similarity, 0);
  assert.equal(dimension(score(profile({ studyMethods: ['practice', 'other'] })), 'methods').similarity, 0.5);
});

test('missing optional answers are unknown, while explicit mismatches remain zero and lower the score', () => {
  const baseline = score(profile());
  assert.equal(baseline.coverage, 85);
  assert.equal(baseline.score, 100);
  for (const key of ['methods', 'rhythm', 'interests'] as const) assert.equal(dimension(baseline, key).similarity, null);
  const oneAnswered = score(profile({ studyMethods: ['practice'], frequency: 'daily', interests: ['music'] }), profile());
  assert.equal(oneAnswered.coverage, baseline.coverage);
  assert.equal(oneAnswered.score, baseline.score);
  assert.ok(oneAnswered.cautions.some((text) => text.includes('85/100')));
  const mismatch = score(profile({ studyMethods: ['practice'], frequency: 'daily', interests: ['music'] }),
    profile({ studyMethods: ['courses'], frequency: 'weekly1', interests: ['reading'] }));
  assert.equal(mismatch.coverage, 100);
  assert.equal(mismatch.score, 85);
  for (const key of ['methods', 'rhythm', 'interests'] as const) assert.equal(dimension(mismatch, key).similarity, 0);
});

test('a flexible study style is partly compatible without equating conflicting specific styles', () => {
  const flexible = score(profile({ studyType: 'flexible' }), profile({ studyType: 'discuss' }));
  const conflicting = score(profile({ studyType: 'quiet' }), profile({ studyType: 'discuss' }));
  assert.equal(dimension(flexible, 'style').similarity, 0.6);
  assert.equal(dimension(conflicting, 'style').similarity, 0);
  assert.equal(dimension(score(profile({ studyType: 'flexible' })), 'style').similarity, 1);
  assert.ok(flexible.score > conflicting.score);
  assert.ok(conflicting.cautions.some((text) => text.includes('相处方式不同')));
});

test('place wildcard remains symmetric while both directions of expectations affect compatibility', () => {
  const a = profile({ places: ['any'] });
  const b = profile({ places: ['library'] });
  assert.equal(dimension(score(a, b), 'places').similarity, 1);
  const specificConflict = score(profile({ places: ['library'], expectedPlaces: ['dorm'] }), profile({ places: ['library'] }));
  assert.equal(dimension(specificConflict, 'places').similarity, 0.5);
  const conflictingExpectations = score(profile({ places: ['any'], expectedPlaces: ['library'] }), profile({ places: ['any'], expectedPlaces: ['cafe'] }));
  assert.equal(dimension(conflictingExpectations, 'places').similarity, 0.75);
  assert.ok(conflictingExpectations.cautions.some((text) => text.includes('地点期望不一致')));
  assert.equal(dimension(score(profile({ places: [], placesOther: '  Ａ栋 自习室 ' }), profile({ places: [], placesOther: 'a栋 自习室' })), 'places').similarity, 1);
  assert.equal(dimension(score(profile({ places: [], placesOther: 'A栋' }), profile({ places: [], placesOther: 'B栋' })), 'places').similarity, 0);
});

test('rhythm compares only mutually completed subfields and irregular frequency is partial compatibility', () => {
  const frequencyOnly = score(profile({ frequency: 'daily', duration: 'long' }), profile({ frequency: 'daily' }));
  assert.equal(dimension(frequencyOnly, 'rhythm').similarity, 1);
  const oppositeParts = score(profile({ frequency: 'daily' }), profile({ duration: 'long' }));
  assert.equal(dimension(oppositeParts, 'rhythm').similarity, null);
  const irregular = score(profile({ frequency: 'irregular' }), profile({ frequency: 'daily' }));
  assert.equal(dimension(irregular, 'rhythm').similarity, 0.5);
  assert.equal(dimension(score(profile({ frequency: 'daily', duration: 'short' }), profile({ frequency: 'daily', duration: 'long' })), 'rhythm').similarity, 0.5);
});

test('identity, demographics, personality labels, photos, dislikes and free expectations cannot change scores', () => {
  const a = profile();
  const b = profile({ realName: '不同姓名', studentId: '99999999', gender: 'female', major: '不同院系', grade: 'grad',
    buddyGender: 'male', mbti: 'INTJ', contacts: { showEmail: true, wechat: 'private', qq: '100', phone: '555', other: 'hidden' },
    photoVisibility: 'public', photos: ['different.png'], dislikes: '不匹配的自由文本', dislikeTags: ['social'],
    expectations: '期待自由文本', bio: '任何自我介绍', studyPlan: '自由学习计划补充',
    goalResearch: '不同科研方向', goalSkills: '不同技能细节' });
  assert.deepEqual(score(a, b), score(a));
});

test('scores and explanations are deterministic, symmetric, bounded and do not mutate profiles', () => {
  const cases = [
    profile(), profile({ schedule: [0], interests: ['other'], interestsOther: '摄影' }),
    profile({ schedule: [0, 3, 8], studyType: 'flexible', places: ['any'], expectedPlaces: ['library'], frequency: 'irregular' }),
    profile({ schedule: [0, 1, 8], planTags: ['语言考试'], places: ['dorm'], expectedPlaces: ['cafe'], studyMethods: ['practice'], frequency: 'weekly3', duration: 'short' }),
  ];
  const before = JSON.stringify(cases);
  for (const a of cases) for (const b of cases) {
    const result = score(a, b);
    assert.deepEqual(result, score(b, a));
    assert.deepEqual(result, score(a, b));
    assert.equal(result.version, 'rules-v1');
    assert.ok(Number.isInteger(result.score) && result.score >= 0 && result.score <= 100);
    assert.equal(result.dimensions.reduce((total, item) => total + item.weight, 0), 100);
    assert.ok(result.dimensions.every((item) => item.detail && (item.similarity === null || item.similarity >= 0 && item.similarity <= 1)));
    assert.ok(result.reasons.length);
  }
  assert.equal(JSON.stringify(cases), before);
});

test('stable ordering prioritizes score, then coverage, shared hours and finally numeric user id', () => {
  const base = score(profile());
  const card = (id: number, changes: Partial<RecommendationInfo>) => ({ id, recommendation: { ...base, ...changes } } as ProfileCard);
  const cards = [card(8, { score: 90, coverage: 100, overlapHours: 6 }), card(3, { score: 90, coverage: 100, overlapHours: 6 }),
    card(1, { score: 95, coverage: 85, overlapHours: 2 }), card(2, { score: 90, coverage: 95, overlapHours: 20 }),
    card(4, { score: 90, coverage: 100, overlapHours: 8 })];
  assert.deepEqual([...cards].sort(compareRecommendationCards).map((card) => card.id), [1, 4, 3, 8, 2]);
  assert.deepEqual([...cards].reverse().sort(compareRecommendationCards).map((card) => card.id), [1, 4, 3, 8, 2]);
});
