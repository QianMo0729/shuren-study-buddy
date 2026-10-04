import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { emptyPersonality, emptyProfile, missingFields, pickProfileInput } from '../shared/profileRules.ts';
import type { Personality, ProfileCard, ProfileInput, RecommendationDimension, RecommendationInfo } from '../shared/types.ts';
import {
  DIMENSION_LABELS, DIMENSION_WEIGHTS, RECOMMENDATION_VERSION, compareRecommendationCards, hardFilter, recommendationFor, weeklyNeedHours,
} from '../server/recommendations.ts';

const consent = { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true };
const profile = (changes: Partial<ProfileInput> = {}): ProfileInput => ({
  ...emptyProfile(), realName: '测试同学', schedule: [0, 1, 2], planTags: ['期末复习备考'],
  studyType: 'quiet', places: ['library'], privacyConsent: { ...consent },
  ...changes,
});
const traits = (changes: Partial<Personality>): Personality => ({ ...emptyPersonality(), ...changes });
const score = (a: ProfileInput, b = a) => {
  const result = recommendationFor(a, b);
  assert.ok(result, 'fixture must pass the hard filters');
  return result;
};
const dimension = (result: RecommendationInfo, key: RecommendationDimension['key']) => result.dimensions.find((item) => item.key === key)!;
const card = (id: number, recommendation: RecommendationInfo) => ({ id, recommendation } as ProfileCard);

/** 一位各项都填写完整的同学 */
const complete = (changes: Partial<ProfileInput> = {}) => profile({
  subjects: ['线性代数'], goalDeadline: '2026-12-20', studyFormat: 'offline', frequency: 'weekly3', duration: 'short',
  personality: traits({ talk: 2, noise: 1, punctual: 5, plan: 4, social: 2, needSupervision: 3, giveSupervision: 3 }),
  mbti: 'INTJ', interests: ['reading', 'music'], expectedPlaces: ['library'], dislikeTags: ['late'],
  ...changes,
});

// ---------- 契约 ----------

test('exports the rules-v2 contract: version, seven weighted dimensions summing to 100 and Chinese labels', () => {
  assert.equal(RECOMMENDATION_VERSION, 'rules-v2');
  assert.deepEqual(DIMENSION_WEIGHTS, { time: 30, content: 22, personality: 20, style: 10, places: 8, rhythm: 6, interests: 4 });
  assert.equal(Object.values(DIMENSION_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100);
  assert.deepEqual(DIMENSION_LABELS, {
    time: '共同时间', content: '学习内容', personality: '学习性格', style: '学习方式', places: '学习地点', rhythm: '学习节奏', interests: '兴趣',
  });
  const result = score(complete());
  assert.equal(result.version, 'rules-v2');
  assert.deepEqual(result.dimensions.map((item) => [item.key, item.label, item.weight]),
    Object.entries(DIMENSION_WEIGHTS).map(([key, weight]) => [key, DIMENSION_LABELS[key as RecommendationDimension['key']], weight]));
});

test('weekly study need is sessions × hours, with a 4-hour estimate when either answer is missing', () => {
  assert.equal(weeklyNeedHours(profile()), 4);
  assert.equal(weeklyNeedHours(profile({ frequency: 'daily' })), 4);
  assert.equal(weeklyNeedHours(profile({ duration: 'long' })), 4);
  assert.equal(weeklyNeedHours(profile({ frequency: 'daily', duration: 'long' })), 22.5);
  assert.equal(weeklyNeedHours(profile({ frequency: 'weekly3', duration: 'medium' })), 12);
  assert.equal(weeklyNeedHours(profile({ frequency: 'weekly1', duration: 'short' })), 2.25);
  assert.equal(weeklyNeedHours(profile({ frequency: 'irregular', duration: 'medium' })), 4.5);
  assert.equal(weeklyNeedHours(profile({ frequency: 'constructor', duration: 'toString' })), 4);
});

// ---------- 性质 4：硬条件 ----------

test('no common time means no recommendation, including mutually incompatible expected schedules', () => {
  assert.equal(recommendationFor(profile({ schedule: [0] }), profile({ schedule: [1] })), null);
  assert.equal(recommendationFor(profile({ schedule: [] }), profile()), null);
  assert.equal(recommendationFor(profile({ schedule: [0, 1], expectedSchedule: [1] }), profile({ schedule: [0, 1], expectedSchedule: [0] })), null);
  assert.equal(recommendationFor(profile({ expectedSchedule: [40] }), profile()), null);
  assert.deepEqual(hardFilter(profile({ schedule: [0] }), profile({ schedule: [1] })), { reason: 'time' });
  assert.equal(hardFilter(profile(), profile()), null);
});

test('buddy gender preference is a hard filter applied in both directions; unknown gender never satisfies it', () => {
  const wantsFemale = profile({ gender: 'male', buddyGender: 'female' });
  const female = profile({ gender: 'female' });
  assert.ok(recommendationFor(wantsFemale, female));
  assert.ok(recommendationFor(female, wantsFemale));
  for (const other of [profile({ gender: 'male' }), profile({ gender: '' }), profile({ gender: 'other' })]) {
    assert.deepEqual(hardFilter(wantsFemale, other), { reason: 'gender' });
    assert.deepEqual(hardFilter(other, wantsFemale), { reason: 'gender' });
    assert.equal(recommendationFor(wantsFemale, other), null);
    assert.equal(recommendationFor(other, wantsFemale), null);
  }
  // 对方要求男生，而我是女生：即使我不限，也不会推荐
  const wantsMale = profile({ gender: 'female', buddyGender: 'male' });
  assert.equal(recommendationFor(profile({ gender: 'female', buddyGender: 'any' }), wantsMale), null);
  assert.ok(recommendationFor(profile({ gender: 'male', buddyGender: 'any' }), wantsMale));
  assert.ok(recommendationFor(profile({ buddyGender: 'any' }), profile({ buddyGender: '' })));
});

test('offline and online study formats exclude each other in both directions; "both" or blank is compatible', () => {
  const offline = profile({ studyFormat: 'offline' });
  const online = profile({ studyFormat: 'online' });
  assert.deepEqual(hardFilter(offline, online), { reason: 'format' });
  assert.deepEqual(hardFilter(online, offline), { reason: 'format' });
  assert.equal(recommendationFor(offline, online), null);
  assert.equal(recommendationFor(online, offline), null);
  for (const flexible of [profile({ studyFormat: 'both' }), profile({ studyFormat: '' })]) {
    assert.ok(recommendationFor(offline, flexible));
    assert.ok(recommendationFor(flexible, online));
  }
});

// ---------- 性质 1、8：时间 ----------

test('both actual and expected availability constrain overlap, and invalid/duplicate slots cannot inflate it', () => {
  const a = profile({ schedule: [0, 1, 1, -1, 63, 1.5, NaN], expectedSchedule: [0, 1] });
  const b = profile({ schedule: [1, 2], expectedSchedule: [1] });
  const result = score(a, b);
  assert.deepEqual(result.commonSlots, [1]);
  assert.equal(result.overlapHours, 2);
  assert.deepEqual(result, score(profile({ schedule: [0, 1] }), profile({ schedule: [1] })));
});

test('someone with a superset of my availability is never penalized for being more available', () => {
  const me = profile({ schedule: [0, 1, 2], frequency: 'weekly3', duration: 'long' });
  const sameTime = score(me, profile({ schedule: [0, 1, 2] }));
  const moreFree = score(me, profile({ schedule: Array.from({ length: 30 }, (_, i) => i) }));
  assert.ok(moreFree.score >= sameTime.score);
  assert.equal(dimension(moreFree, 'time').forMe, dimension(sameTime, 'time').forMe);
  assert.equal(dimension(moreFree, 'time').forThem, dimension(sameTime, 'time').forThem);
  // 共同时间越多（直到满足需求）越好
  const wider = profile({ schedule: [0, 1, 2, 3, 4, 5], frequency: 'weekly3', duration: 'long' });
  assert.ok(score(wider, profile({ schedule: [0, 1, 2, 3, 4, 5, 10, 11] })).score > score(wider, profile({ schedule: [0, 1, 2] })).score);
  // 时间满足程度 = 计分小时 / 我的每周需求，封顶 1
  assert.equal(dimension(sameTime, 'time').forMe, 0.3333);
  assert.equal(dimension(score(profile({ schedule: [0, 1, 2] })), 'time').forMe, 1);
});

test('overnight slots show their real 8 hours but earn no more time credit than a 2-hour slot', () => {
  const daytime = score(profile({ schedule: [0] }));
  const overnight = score(profile({ schedule: [8] }));
  assert.equal(daytime.overlapHours, 2);
  assert.equal(overnight.overlapHours, 8);
  assert.equal(dimension(daytime, 'time').forMe, 0.5);
  assert.equal(dimension(overnight, 'time').forMe, 0.5);
  assert.equal(daytime.score, overnight.score);
  const needy = { frequency: 'daily', duration: 'long' };
  assert.equal(dimension(score(profile({ schedule: [8, 17], ...needy })), 'time').forMe, dimension(score(profile({ schedule: [0, 9], ...needy })), 'time').forMe);
  assert.ok(score(profile({ schedule: [0, 1] })).score > daytime.score);
});

// ---------- 性质 2、3：学习内容 ----------

test('choosing several goals that include the shared one never lowers content', () => {
  const me = profile({ planTags: ['考研'] });
  const single = score(me, profile({ planTags: ['考研'] }));
  const several = score(me, profile({ planTags: ['考研', '语言考试', '技能自学'] }));
  assert.equal(dimension(several, 'content').similarity, dimension(single, 'content').similarity);
  assert.equal(several.score, single.score);
  const subjects = profile({ planTags: ['考研'], subjects: ['线性代数'] });
  assert.equal(dimension(score(subjects, profile({ planTags: ['考研'], subjects: ['线性代数', '雅思', 'Python'] })), 'content').similarity,
    dimension(score(subjects, profile({ planTags: ['考研'], subjects: ['线性代数'] })), 'content').similarity);
  // 目标大类用 overlap coefficient，而不是 Dice
  assert.equal(dimension(score(profile({ planTags: ['考研', '语言考试'] }), profile({ planTags: ['考研'] })), 'content').similarity, 0.8);
});

test('same subject beats same goal category with different subjects, which beats different categories', () => {
  const me = profile({ planTags: ['语言考试'], subjects: ['雅思'] });
  const sameSubject = score(me, profile({ planTags: ['语言考试'], subjects: ['IELTS'] }));
  const sameCategory = score(me, profile({ planTags: ['语言考试'], subjects: ['托福'] }));
  const differentCategory = score(me, profile({ planTags: ['考研'], subjects: ['考研数学一'] }));
  const content = (result: RecommendationInfo) => dimension(result, 'content').similarity!;
  assert.equal(content(sameSubject), 1);
  assert.equal(content(sameCategory), 0.5);
  assert.equal(content(differentCategory), 0);
  assert.ok(sameSubject.score > sameCategory.score && sameCategory.score > differentCategory.score);
  assert.ok(sameSubject.reasons.some((text) => text.includes('都在准备 雅思')));
  assert.ok(sameCategory.cautions.some((text) => text.includes('具体科目不同')));
});

test('subjects match through normalization, synonyms and containment, without accidental substrings', () => {
  const content = (x: string[], y: string[]) => dimension(score(profile({ subjects: x }), profile({ subjects: y })), 'content').similarity;
  assert.equal(content(['线代'], ['线性代数']), 1);
  assert.equal(content(['线性代数'], ['线性代数II']), 1);
  assert.equal(content(['线代'], ['线性代数（下）']), 1);
  assert.equal(content(['  ＧＲＥ  '], ['gre']), 1);
  assert.equal(content(['CS 231n'], ['cs231n']), 1);
  assert.equal(content(['雅思'], ['ielts 口语']), 1);
  assert.equal(content(['GRE'], ['progress report']), 0.5);
  assert.equal(content(['数'], ['数学分析']), 0.5);
  // 部分科目重合：0.75 + 0.25 × 共同科目数 / 较少一方的科目数
  assert.equal(content(['线代', '雅思'], ['线性代数', '托福', '模电']), 0.875);
  assert.equal(content(['线代', '线性代数'], ['线性代数']), 1);
});

test('missing subjects fall back to 80% of goal overlap with a reminder; close deadlines add a small bonus', () => {
  const noSubjects = score(profile(), profile({ subjects: ['线性代数'] }));
  assert.equal(dimension(noSubjects, 'content').similarity, 0.8);
  assert.ok(noSubjects.cautions.some((text) => text.includes('未填写具体科目，建议确认是否学同一门课')));
  assert.equal(dimension(score(profile({ planTags: ['考研'] }), profile({ planTags: ['语言考试'] })), 'content').similarity, 0);
  const near = score(profile({ subjects: ['雅思'], goalDeadline: '2026-12-01' }), profile({ subjects: ['托福'], goalDeadline: '2026-12-20' }));
  assert.equal(dimension(near, 'content').similarity, 0.55);
  assert.ok(near.reasons.some((text) => text.includes('目标日期相近')));
  const far = score(profile({ subjects: ['雅思'], goalDeadline: '2026-12-01' }), profile({ subjects: ['托福'], goalDeadline: '2026-12-30' }));
  assert.equal(dimension(far, 'content').similarity, 0.5);
  const sameSubject = score(profile({ subjects: ['雅思'], goalDeadline: '2026-12-01' }), profile({ subjects: ['雅思'], goalDeadline: '2026-12-02' }));
  assert.equal(dimension(sameSubject, 'content').similarity, 1);
  assert.ok(sameSubject.reasons.includes('目标日期相近，可以一起冲刺'));
  assert.ok(!near.reasons.some((text) => text.includes('冲刺')));
  // 没有共同科目也没有共同目标时，日期再近也不加分
  assert.equal(dimension(score(profile({ planTags: ['考研'], goalDeadline: '2026-12-01' }), profile({ planTags: ['语言考试'], goalDeadline: '2026-12-01' })), 'content').similarity, 0);
});

test('other answers never create a match without matching nonempty normalized supplements', () => {
  const blank = profile({ planTags: ['其他'], interests: ['other'] });
  const blankResult = score(blank);
  assert.equal(dimension(blankResult, 'content').similarity, 0);
  assert.equal(dimension(blankResult, 'interests').similarity, 0);
  const a = { ...blank, goalOther: '  ＡＩ  论文 ', interestsOther: '  模型   制作  ' };
  const b = { ...blank, goalOther: 'ai 论文', interestsOther: '模型 制作' };
  const matching = score(a, b);
  assert.equal(dimension(matching, 'content').similarity, 0.8);
  assert.equal(dimension(matching, 'interests').similarity, 1);
  const different = score(a, { ...b, goalOther: '机器人论文', interestsOther: '陶艺' });
  assert.equal(dimension(different, 'content').similarity, 0);
  assert.equal(dimension(different, 'interests').similarity, 0);
  assert.equal(dimension(score(profile({ interests: ['music', 'reading'] }), profile({ interests: ['music', 'movies'] })), 'interests').similarity, 0.5);
  assert.equal(dimension(score(profile({ interests: ['music'] }), profile({ interests: ['music', 'movies', 'reading'] })), 'interests').similarity, 1);
});

// ---------- 性质 5：学习性格 ----------

test('closer study personalities score higher', () => {
  const me = profile({ personality: traits({ talk: 1, noise: 1, punctual: 5, plan: 5, social: 1 }) });
  const close = score(me, profile({ personality: traits({ talk: 2, noise: 1, punctual: 5, plan: 4, social: 1 }) }));
  const middle = score(me, profile({ personality: traits({ talk: 3, noise: 3, punctual: 3, plan: 3, social: 3 }) }));
  const far = score(me, profile({ personality: traits({ talk: 5, noise: 5, punctual: 1, plan: 1, social: 5 }) }));
  const value = (result: RecommendationInfo) => dimension(result, 'personality').similarity!;
  assert.equal(value(close), 0.9);
  assert.equal(value(middle), 0.5);
  assert.equal(value(far), 0);
  assert.ok(close.score > middle.score && middle.score > far.score);
  assert.ok(close.reasons.some((text) => text.startsWith('学习性格接近：') && text.includes('都需要安静环境')));
  assert.ok(far.cautions.some((text) => text.includes('差别较大')));
});

test('supervision is complementary and directional', () => {
  const needsPush = profile({ personality: traits({ needSupervision: 5, giveSupervision: 1 }) });
  const pusher = profile({ personality: traits({ needSupervision: 1, giveSupervision: 5 }) });
  const result = score(needsPush, pusher);
  assert.equal(dimension(result, 'personality').forMe, 1);
  assert.equal(dimension(result, 'personality').forThem, 1);
  assert.ok(result.reasons.includes('TA 愿意督促你'));
  const lazy = profile({ personality: traits({ needSupervision: 1, giveSupervision: 1 }) });
  const unmet = score(needsPush, lazy);
  assert.equal(dimension(unmet, 'personality').forMe, 0);
  assert.equal(dimension(unmet, 'personality').forThem, 1);
  assert.ok(unmet.cautions.includes('你希望有人督促，但 TA 不太想管别人'));
  const mirrored = score(lazy, needsPush);
  assert.equal(dimension(mirrored, 'personality').forMe, 1);
  assert.equal(dimension(mirrored, 'personality').forThem, 0);
  assert.ok(result.score > unmet.score);
  // 只有一个方向可比时，另一方向按中性计，覆盖度只算一半
  const oneWay = score(profile({ personality: traits({ needSupervision: 5 }) }), profile({ personality: traits({ giveSupervision: 2 }) }));
  assert.equal(dimension(oneWay, 'personality').forMe, 0.25);
  assert.equal(dimension(oneWay, 'personality').forThem, 0.5);
  assert.equal(oneWay.coverage, score(profile()).coverage + 10);
});

test('dislike conflicts lower the score and explain which red line may be crossed', () => {
  const chatty = profile({ personality: traits({ talk: 5, noise: 4, social: 4 }) });
  const calm = profile({ personality: traits({ talk: 5, noise: 4, social: 4 }) });
  const fine = score(calm, chatty);
  const avoidSocial = score({ ...calm, dislikeTags: ['social'] }, chatty);
  assert.equal(dimension(avoidSocial, 'personality').forMe, round(dimension(fine, 'personality').forMe! * 0.6));
  assert.equal(dimension(avoidSocial, 'personality').forThem, dimension(fine, 'personality').forThem);
  assert.ok(avoidSocial.score < fine.score);
  assert.ok(avoidSocial.cautions[0].startsWith('可能触及你的雷区：过度社交'));
  // TA 的雷区被我触及时，我会收到提醒，分数同样下降
  const theirs = score(chatty, { ...calm, dislikeTags: ['social'] });
  assert.equal(theirs.score, avoidSocial.score);
  assert.ok(theirs.cautions.some((text) => text.startsWith('你可能触及 TA 的雷区')));
  // 雷区按问卷规则判定：沉默对应 talk 1–2 或安静学，迟到对应守时 1–2；每个冲突 × 0.6
  const both = score(profile({ dislikeTags: ['silent', 'late'], personality: traits({ talk: 2, punctual: 2 }) }), profile({ personality: traits({ talk: 2, punctual: 2 }) }));
  assert.equal(dimension(both, 'personality').forMe, 0.36);
  // 没有任何可比的性格信息时以 0.5 为底，冲突仍然生效（不会因为另一方向缺失而被抹掉）
  const noInfo = score(profile({ dislikeTags: ['silent'] }), profile({ studyType: 'quiet' }));
  assert.equal(dimension(noInfo, 'personality').forMe, 0.3);
  assert.equal(dimension(noInfo, 'personality').forThem, 0.5);
  assert.ok(noInfo.score < score(profile(), profile({ studyType: 'quiet' })).score);
  assert.ok(noInfo.cautions.some((text) => text.includes('可能触及你的雷区：全程沉默')));
  // 选项「在自习室吃东西」「其他」不做自动判断
  assert.deepEqual(score(profile({ dislikeTags: ['food', 'other'] }), chatty), score(profile(), chatty));
});

test('MBTI takes part with a small weight; MBTI-only personality counts as half coverage', () => {
  const mbti = (x: string, y: string) => score(profile({ mbti: x }), profile({ mbti: y }));
  assert.equal(dimension(mbti('INFP', 'infp-t'), 'personality').similarity, 1);
  assert.equal(dimension(mbti('INFP', 'INFJ'), 'personality').similarity, 0.6667);
  assert.equal(dimension(mbti('INFP', 'ESTJ'), 'personality').similarity, 0);
  assert.equal(dimension(mbti('INFP', '不清楚'), 'personality').similarity, null);
  assert.equal(mbti('INFP', 'INFP').coverage, score(profile()).coverage + 10);
  const scales = traits({ talk: 3, noise: 3 });
  const withMbti = score(profile({ personality: scales, mbti: 'ENTJ' }), profile({ personality: scales, mbti: 'ISFP' }));
  assert.equal(dimension(withMbti, 'personality').similarity, 0.8);
  assert.equal(withMbti.coverage, score(profile()).coverage + 20);
});

// ---------- 性质 6：缺失按中性计 ----------

test('missing dimensions count as neutral 0.5 and sparse profiles never outrank complete, well-matched ones', () => {
  const sparse = score(profile());
  assert.equal(sparse.coverage, 70);
  for (const key of ['personality', 'rhythm', 'interests'] as const) assert.equal(dimension(sparse, key).similarity, null);
  // (30×1 + 22×0.8 + 20×0.5 + 10×1 + 8×1 + 6×0.5 + 4×0.5) / 100 = 0.806；核心维度都不低于 0.5，无短板惩罚
  assert.equal(sparse.forMe, 81);
  assert.equal(sparse.score, 81);
  assert.notEqual(sparse.tier, 'great', 'only 70/100 of the weight is comparable, so it cannot be 很合拍');
  const me = complete();
  const full = score(me, complete());
  const sparseCandidate = score(me, profile());
  assert.equal(full.coverage, 100);
  assert.ok(full.score > sparseCandidate.score);
  assert.ok(full.score >= 95);
  const cards = [card(1, sparseCandidate), card(2, full)];
  assert.deepEqual(cards.sort(compareRecommendationCards).map((item) => item.id), [2, 1]);
  // 只回答一方的选填项不会改变分数；双方都答且不一致才会降低
  assert.equal(score(profile({ frequency: 'daily', interests: ['music'] }), profile()).score, sparse.score);
  const mismatch = score(profile({ frequency: 'daily', duration: 'short', interests: ['music'] }), profile({ frequency: 'weekly1', duration: 'long', interests: ['reading'] }));
  assert.equal(dimension(mismatch, 'rhythm').similarity, 0.25);
  assert.equal(dimension(mismatch, 'interests').similarity, 0);
  assert.ok(mismatch.score < sparse.score);
});

// ---------- 性质 7：互惠 ----------

test('reciprocity: one-sided satisfaction is discounted, and the score is symmetric under swapping', () => {
  const a = profile({ frequency: 'weekly1', duration: 'short', expectedPlaces: ['library'], places: ['dorm'],
    personality: traits({ needSupervision: 5, giveSupervision: 1 }) });
  const b = profile({ frequency: 'daily', duration: 'long', expectedPlaces: ['cafe'], places: ['library'],
    personality: traits({ needSupervision: 5, giveSupervision: 5 }) });
  const ab = score(a, b);
  const ba = score(b, a);
  assert.ok(ab.forMe > ab.forThem);
  assert.ok(ab.score < ab.forMe, 'B satisfies A but not the other way round, so the mutual score stays below forMe');
  assert.ok(ab.score >= ab.forThem);
  assert.equal(ab.score, ba.score);
  assert.equal(ab.forMe, ba.forThem);
  assert.equal(ab.forThem, ba.forMe);
  assert.equal(ab.tier, ba.tier);
  assert.equal(ab.coverage, ba.coverage);
  for (const item of ab.dimensions) {
    const mirror = dimension(ba, item.key);
    assert.equal(item.forMe, mirror.forThem);
    assert.equal(item.forThem, mirror.forMe);
    assert.equal(item.similarity, mirror.similarity);
  }
  assert.equal(dimension(ab, 'time').forMe, 1);
  assert.equal(dimension(ab, 'places').forMe, 1);
  assert.equal(dimension(ab, 'places').forThem, 0.25);
  assert.equal(dimension(ab, 'personality').forMe, 1);
  assert.equal(dimension(ab, 'personality').forThem, 0);
  // 双方都满意时总分才高：对方也满意的组合排在前面
  const mutual = score(a, profile({ frequency: 'weekly1', duration: 'short', expectedPlaces: ['dorm'], places: ['library'],
    personality: traits({ needSupervision: 1, giveSupervision: 5 }) }));
  assert.ok(mutual.forThem > ab.forThem);
  assert.ok(mutual.score > ab.score);
  assert.ok(Math.abs(mutual.score - mutual.forMe) <= 1);
});

// ---------- 其余维度 ----------

test('study style uses the symmetric v2 matrix', () => {
  const style = (x: string, y: string) => dimension(score(profile({ studyType: x }), profile({ studyType: y })), 'style').similarity;
  assert.equal(style('quiet', 'quiet'), 1);
  assert.equal(style('flexible', 'discuss'), 0.7);
  assert.equal(style('checkin', 'flexible'), 0.7);
  assert.equal(style('quiet', 'checkin'), 0.5);
  assert.equal(style('discuss', 'checkin'), 0.5);
  assert.equal(style('quiet', 'discuss'), 0.15);
  assert.equal(style('discuss', 'quiet'), 0.15);
  assert.ok(score(profile({ studyType: 'quiet' }), profile({ studyType: 'discuss' })).cautions.some((text) => text.includes('学习方式差别较大')));
});

test('places compare each expectation with the other side’s actual places, with wildcards and online formats', () => {
  const places = (a: Partial<ProfileInput>, b: Partial<ProfileInput>) => dimension(score(profile(a), profile(b)), 'places');
  assert.equal(places({ places: ['any'] }, { places: ['library'] }).similarity, 1);
  assert.equal(places({ places: ['library'] }, { places: ['cafe'] }).similarity, 0.25);
  const expectation = places({ places: ['library'], expectedPlaces: ['dorm'] }, { places: ['library'] });
  assert.equal(expectation.forMe, 0.25);
  assert.equal(expectation.forThem, 1);
  assert.equal(places({ places: ['dorm'], expectedPlaces: ['library'] }, { places: ['library'] }).forMe, 1);
  assert.equal(places({ places: [], placesOther: '  Ａ栋 自习室 ' }, { places: [], placesOther: 'a栋 自习室' }).similarity, 1);
  assert.equal(places({ places: [], placesOther: 'A栋' }, { places: [], placesOther: 'B栋' }).similarity, 0.25);
  assert.equal(places({ places: ['library'], studyFormat: 'online' }, { places: ['cafe'], studyFormat: 'online' }).similarity, 1);
  assert.equal(places({ places: ['library'], studyFormat: 'online' }, { places: ['cafe'], studyFormat: 'both' }).similarity, 1);
  assert.equal(places({ places: ['library'], studyFormat: 'offline' }, { places: ['cafe'], studyFormat: 'both' }).similarity, 0.25);
});

test('rhythm compares only mutually completed subfields with adjacent answers partly compatible', () => {
  const rhythm = (a: Partial<ProfileInput>, b: Partial<ProfileInput>) => dimension(score(profile(a), profile(b)), 'rhythm').similarity;
  assert.equal(rhythm({ frequency: 'daily', duration: 'long' }, { frequency: 'daily' }), 1);
  assert.equal(rhythm({ frequency: 'daily' }, { duration: 'long' }), null);
  assert.equal(rhythm({ frequency: 'daily' }, { frequency: 'weekly3' }), 0.6);
  assert.equal(rhythm({ frequency: 'weekly1' }, { frequency: 'weekly3' }), 0.6);
  assert.equal(rhythm({ frequency: 'daily' }, { frequency: 'weekly1' }), 0.2);
  assert.equal(rhythm({ frequency: 'irregular' }, { frequency: 'daily' }), 0.6);
  assert.equal(rhythm({ duration: 'short' }, { duration: 'medium' }), 0.6);
  assert.equal(rhythm({ duration: 'short' }, { duration: 'long' }), 0.3);
  assert.equal(rhythm({ frequency: 'daily', duration: 'short' }, { frequency: 'daily', duration: 'long' }), 0.65);
});

test('identity, demographics, photos, contacts and free text cannot change scores', () => {
  const a = complete();
  const b = complete({ realName: '不同姓名', studentId: '99999999', gender: 'female', major: '不同院系', grade: 'grad',
    contacts: { showEmail: true, wechat: 'private', qq: '100', phone: '555', other: 'hidden' },
    photoVisibility: 'public', photos: ['different.png'], dislikes: '不匹配的自由文本', expectations: '期待自由文本',
    bio: '任何自我介绍', studyPlan: '自由学习计划补充', goalResearch: '不同科研方向', goalSkills: '不同技能细节',
    traits: ['active'], modes: ['discuss'], sports: ['running'], futurePlan: 'abroad', status: 'open', studyMethods: ['courses'] });
  assert.deepEqual(score(a, b), score(a, complete()));
});

// ---------- 性质 9：确定性与稳定排序 ----------

test('scores and explanations are deterministic, bounded, consistent and do not mutate profiles', () => {
  const cases = [
    profile(), profile({ schedule: [0], interests: ['other'], interestsOther: '摄影' }),
    profile({ schedule: [0, 3, 8], studyType: 'flexible', places: ['any'], expectedPlaces: ['library'], frequency: 'irregular', mbti: 'ENFP' }),
    profile({ schedule: [0, 1, 8], planTags: ['语言考试'], places: ['dorm'], expectedPlaces: ['cafe'], frequency: 'weekly3', duration: 'short', dislikeTags: ['silent'] }),
    complete(), complete({ subjects: ['雅思', '托福'], personality: traits({ talk: 5, social: 5, needSupervision: 5 }), dislikeTags: ['social', 'late'] }),
  ];
  const before = JSON.stringify(cases);
  for (const a of cases) for (const b of cases) {
    const result = score(a, b);
    const mirror = score(b, a);
    assert.deepEqual(result, score(a, b));
    assert.equal(result.score, mirror.score);
    assert.ok(Number.isInteger(result.score) && result.score >= 0 && result.score <= 100);
    assert.ok(Number.isInteger(result.forMe) && Number.isInteger(result.forThem));
    assert.ok(result.score <= Math.max(result.forMe, result.forThem) && result.score >= Math.min(result.forMe, result.forThem) - 1);
    // 很合拍：总分 ≥ 80、核心维度（时间 / 内容 / 性格）都不低于 0.6、可比较信息覆盖 ≥ 80；否则按总分分为较合拍 / 可以聊聊
    const coreOk = result.dimensions.every((d) => !['time', 'content', 'personality'].includes(d.key) || d.similarity === null || d.similarity >= 0.6);
    const great = result.score >= 80 && coreOk && result.coverage >= 80;
    assert.equal(result.tier, great ? 'great' : result.score >= 65 ? 'good' : 'fair');
    assert.ok(Number.isInteger(result.coverage) && result.coverage >= 30 && result.coverage <= 100);
    assert.ok(result.reasons.length >= 1 && result.reasons.length <= 4);
    assert.ok(result.cautions.length <= 3);
    assert.equal(new Set(result.reasons).size, result.reasons.length);
    for (const item of result.dimensions) {
      assert.ok(item.detail);
      for (const n of [item.similarity, item.forMe, item.forThem]) assert.ok(n === null || (n >= 0 && n <= 1 && round(n) === n));
      assert.equal(item.similarity === null, item.forMe === null);
      assert.equal(item.similarity === null, item.forThem === null);
    }
  }
  assert.equal(JSON.stringify(cases), before);
});

test('stable ordering prioritizes score, then coverage, shared hours and finally numeric user id', () => {
  const base = score(profile());
  const item = (id: number, changes: Partial<RecommendationInfo>) => card(id, { ...base, ...changes });
  const cards = [item(8, { score: 90, coverage: 100, overlapHours: 6 }), item(3, { score: 90, coverage: 100, overlapHours: 6 }),
    item(1, { score: 95, coverage: 85, overlapHours: 2 }), item(2, { score: 90, coverage: 95, overlapHours: 20 }),
    item(4, { score: 90, coverage: 100, overlapHours: 8 })];
  assert.deepEqual([...cards].sort(compareRecommendationCards).map((c) => c.id), [1, 4, 3, 8, 2]);
  assert.deepEqual([...cards].reverse().sort(compareRecommendationCards).map((c) => c.id), [1, 4, 3, 8, 2]);
});

function round(n: number) {
  return Math.round(n * 10_000) / 10_000;
}

// ---------- 演示数据 ----------

test('seeded demo data gives every demo profile v2 answers, an unusable password and community posts', { timeout: 120_000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-seed-'));
  const run = async (...args: string[]) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/seed.ts', ...args], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, NODE_ENV: 'test', DATA_DIR: dir, RESEND_API_KEY: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, output);
    return output;
  };
  try {
    const output = await run();
    let postCount = 0;
    assert.doesNotMatch(output, /\$2[aby]\$/);
    const db = new DatabaseSync(path.join(dir, 'app.db'));
    try {
      const users = db.prepare('SELECT id, email, password_hash, role FROM users').all() as { id: number; email: string; password_hash: string | null; role: string }[];
      const admin = users.find((u) => u.email.startsWith('12310000@'))!;
      const blank = users.find((u) => u.email.startsWith('12210001@'))!;
      assert.equal(admin.role, 'admin');
      assert.equal(admin.password_hash, null);
      assert.equal(blank.password_hash, null);
      const demo = users.filter((u) => u !== admin && u !== blank);
      assert.ok(demo.length >= 20);
      assert.ok(demo.every((u) => /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(u.password_hash ?? '')));
      assert.equal(new Set(demo.map((u) => u.password_hash)).size, demo.length);
      assert.doesNotMatch(output, new RegExp(demo[0].password_hash!.slice(7, 29).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));

      const profiles = (db.prepare('SELECT user_id, data, published FROM profiles').all() as { user_id: number; data: string; published: number }[])
        .map((row) => ({ id: row.user_id, published: row.published, data: pickProfileInput(JSON.parse(row.data)) }));
      assert.equal(profiles.length, demo.length);
      for (const { data, published } of profiles) {
        assert.equal(published, 1);
        assert.deepEqual(missingFields(data), []);
        assert.ok(data.subjects.length >= 1 && data.subjects.length <= 8);
        assert.ok(['offline', 'online', 'both'].includes(data.studyFormat));
        assert.ok(Object.values(data.personality).every((n) => Number.isInteger(n) && n >= 1 && n <= 5));
        assert.ok(data.goalDeadline === '' || /^\d{4}-\d{2}-\d{2}$/.test(data.goalDeadline));
      }
      assert.ok(profiles.some((p) => p.data.goalDeadline));
      let pairs = 0;
      for (const a of profiles) for (const b of profiles) if (a !== b && recommendationFor(a.data, b.data)) pairs++;
      assert.ok(pairs >= profiles.length * 3, `too few recommendable demo pairs: ${pairs}`);

      const posts = db.prepare('SELECT id, user_id, title, body FROM forum_posts WHERE deleted = 0').all() as { id: number; user_id: number; body: string }[];
      assert.ok(posts.length >= 6 && posts.length <= 12);
      postCount = posts.length;
      const demoIds = new Set(demo.map((u) => u.id));
      assert.ok(posts.every((p) => demoIds.has(p.user_id) && p.body.length > 0 && p.body.length <= 2000));
      const comments = db.prepare("SELECT user_id, target_id FROM forum_comments WHERE target_type = 'post'").all() as { user_id: number; target_id: number }[];
      const likes = db.prepare("SELECT user_id, target_id FROM forum_likes WHERE target_type = 'post'").all() as { user_id: number; target_id: number }[];
      const postIds = new Set(posts.map((p) => p.id));
      assert.ok(comments.length >= 4 && comments.every((c) => demoIds.has(c.user_id) && postIds.has(c.target_id)));
      assert.ok(likes.length >= 8 && likes.every((l) => demoIds.has(l.user_id) && postIds.has(l.target_id)));
    } finally { db.close(); }

    assert.match(await run(), /已存在/);
    await run('--reset');
    const again = new DatabaseSync(path.join(dir, 'app.db'));
    try {
      assert.equal((again.prepare('SELECT COUNT(*) n FROM forum_posts').get() as { n: number }).n, postCount);
      assert.ok((again.prepare('SELECT COUNT(*) n FROM users WHERE password_hash IS NOT NULL').get() as { n: number }).n >= 20);
    } finally { again.close(); }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------- 性质 10：各方面都合适才算合拍 ----------

test('a clear weakness in time, content or personality is not averaged away and blocks the 很合拍 tier', () => {
  const me = complete();
  const best = score(me, complete());
  const opposite = score(me, complete({ personality: traits({ talk: 5, noise: 5, punctual: 1, plan: 1, social: 5, needSupervision: 5, giveSupervision: 1 }) }));
  assert.equal(best.tier, 'great');
  assert.ok(best.score - opposite.score >= 15, `opposite personality should cost at least 15 points (got ${best.score} → ${opposite.score})`);
  assert.notEqual(opposite.tier, 'great');
  assert.ok(dimension(opposite, 'personality').similarity! < 0.5);
  // 次要维度只按权重线性扣分：兴趣完全不同最多扣 4 分
  const noInterests = score(me, complete({ interests: ['games'], interestsOther: '' }));
  assert.ok(best.score - noInterests.score <= 4, `${best.score} → ${noInterests.score}`);
});
