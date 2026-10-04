import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyConsent, emptyProfile, effectiveSchedule, hasPrivacyConsent, migrateSchedule, missingFields, pickProfileInput } from '../shared/profileRules.ts';
import { SLOT_COUNT, slotsHours } from '../shared/options.ts';
import type { PrivacyConsent, ProfileInput } from '../shared/types.ts';

const consent: PrivacyConsent = { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true };
const publishable = (): ProfileInput => ({
  ...emptyProfile(), realName: '测试同学', planTags: ['期末复习备考'], places: ['library'],
  schedule: [0], studyType: 'quiet', privacyConsent: { ...consent },
});

test('new profiles default to private photos and no implicit privacy consent', () => {
  const first = emptyProfile();
  const second = emptyProfile();
  assert.equal(first.photoVisibility, 'private');
  assert.equal(first.contacts.showEmail, false);
  assert.equal(hasPrivacyConsent(first), false);
  first.privacyConsent.policy = true;
  first.photos.push('private.jpg');
  assert.equal(second.privacyConsent.policy, false);
  assert.deepEqual(second.photos, []);
});

test('optional demographics, photos, bio, contacts and learning rhythm do not block publication', () => {
  const p = publishable();
  assert.equal(p.gender, '');
  assert.equal(p.major, '');
  assert.equal(p.grade, '');
  assert.equal(p.bio, '');
  assert.deepEqual(p.photos, []);
  assert.deepEqual(missingFields(p), []);
});

test('publication requires a name, recognized goal, location, available time, study style and all four consents', () => {
  assert.deepEqual(new Set(missingFields(emptyProfile()).map((item) => item.key)), new Set(['realName', 'planTags', 'places', 'schedule', 'studyType', 'privacyConsent']));
  assert.ok(missingFields({ ...publishable(), planTags: ['unrecognized'] }).some((item) => item.key === 'planTags'));
  for (const key of Object.keys(consent) as (keyof PrivacyConsent)[]) {
    const p = { ...publishable(), privacyConsent: { ...consent, [key]: false } };
    assert.equal(hasPrivacyConsent(p), false);
    assert.deepEqual(missingFields(p).map((item) => item.key), ['privacyConsent']);
  }
  assert.equal(hasPrivacyConsent({ privacyConsent: { ...consent, policy: 'true' } as unknown as PrivacyConsent }), false);
});

test('expected partner time restricts the comparison without altering actual availability', () => {
  const p = { schedule: [0, 1, 7], expectedSchedule: [1, 2] };
  assert.deepEqual(effectiveSchedule(p), [1]);
  assert.deepEqual(p.schedule, [0, 1, 7]);
  assert.deepEqual(effectiveSchedule({ ...p, expectedSchedule: [] }), p.schedule);
  assert.deepEqual(effectiveSchedule({ ...p, expectedSchedule: [2, 3] }), []);
});

test('old 7x10 availability is migrated only when it fully covers a new 7x9 slot', () => {
  assert.equal(SLOT_COUNT, 63);
  assert.deepEqual(migrateSchedule([1, 2]), [0, 1]);
  assert.deepEqual(migrateSchedule([6]), []); // 18–19 does not cover 18–20.
  assert.deepEqual(migrateSchedule([7]), []); // 19–21 covers neither 18–20 nor 20–22.
  assert.deepEqual(migrateSchedule([6, 7]), [5]);
  assert.deepEqual(migrateSchedule([7, 8]), [6]);
  assert.deepEqual(migrateSchedule([8, 9]), [7]);
  assert.deepEqual(migrateSchedule([11, 61]), [9, 54]);
  assert.deepEqual(migrateSchedule([1, 1, -1, 70, NaN, 1.5]), [0]);
  assert.deepEqual(migrateSchedule([0, 9, 69]), []); // Partial overnight coverage never implies a whole overnight slot.
  assert.equal(slotsHours(migrateSchedule([6, 7, 8, 9])), 6);
});

test('legacy profiles retain content while adopting new goals, study styles and privacy defaults', () => {
  const legacy = {
    realName: '旧同学', major: '自定义院系', bio: '保留这段自我介绍', studyPlan: '保留目标补充',
    studyType: 'talk', planTags: ['雅思', '期末复习', '编程刷题'], schedule: [1, 6, 7],
    photos: ['legacy-photo.jpg'], sports: ['running'], sportsOther: '飞镖', arts: '钢琴',
    traits: ['punctual', 'quiet'], traitsOther: '能坚持', buddyGender: 'female',
    places: ['college', 'online'], photoVisibility: 'public', privacyConsent: consent,
    contacts: { showEmail: true, wechat: 'old-wechat', qq: '123456', phone: '', other: '' },
  } as Partial<ProfileInput>;
  const migrated = pickProfileInput(legacy);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.realName, legacy.realName);
  assert.equal(migrated.major, legacy.major);
  assert.equal(migrated.bio, legacy.bio);
  assert.equal(migrated.studyPlan, legacy.studyPlan);
  assert.equal(migrated.contacts.wechat, 'old-wechat');
  assert.deepEqual(migrated.photos, legacy.photos);
  assert.equal(migrated.studyType, 'discuss');
  assert.deepEqual(migrated.planTags, ['语言考试', '期末复习备考', '技能自学']);
  assert.deepEqual(migrated.schedule, [0, 5]);
  assert.deepEqual(migrated.places, ['teaching']);
  assert.match(migrated.placesOther, /线上连麦/);
  assert.equal(migrated.photoVisibility, 'private');
  assert.deepEqual(migrated.privacyConsent, emptyConsent());
  assert.deepEqual(migrated.interests, ['sports', 'other']);
  assert.equal(migrated.interestsOther, '跑步、飞镖、钢琴');
  assert.equal(migrated.expectations, '守时靠谱；安静陪伴；能坚持；希望女同学');
  assert.deepEqual(migrated.sports, legacy.sports);
  assert.equal(migrated.sportsOther, legacy.sportsOther);
  assert.equal(migrated.arts, legacy.arts);
  assert.deepEqual(migrated.traits, legacy.traits);
  assert.equal(migrated.traitsOther, legacy.traitsOther);
  assert.equal(migrated.buddyGender, legacy.buddyGender);
});

test('legacy details remain editable through other interests without requiring old category selections', () => {
  const migrated = pickProfileInput({ sportsOther: '飞镖', traitsOther: '晚间学习', arts: '', buddyGender: 'any' });
  assert.deepEqual(migrated.interests, ['sports', 'other']);
  assert.equal(migrated.interestsOther, '飞镖');
  assert.equal(migrated.expectations, '晚间学习');
  const empty = pickProfileInput({});
  assert.deepEqual(empty.interests, []);
  assert.equal(empty.interestsOther, '');
  assert.equal(empty.expectations, '');
});

test('schema v2 does not repeat schedule migration or overwrite explicit photo and consent choices', () => {
  const p = { ...publishable(), schedule: [0, 8, 62], photoVisibility: 'public' as const };
  const roundtrip = pickProfileInput(p);
  assert.deepEqual(roundtrip.schedule, p.schedule);
  assert.equal(roundtrip.photoVisibility, 'public');
  assert.deepEqual(roundtrip.privacyConsent, consent);
  assert.equal(hasPrivacyConsent(roundtrip), true);
});
