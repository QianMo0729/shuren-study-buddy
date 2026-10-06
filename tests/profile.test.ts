import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyConsent, emptyProfile, effectiveSchedule, hasPrivacyConsent, migrateSchedule, missingFields, pickProfileInput } from '../shared/profileRules.ts';
import { SLOT_COUNT, slotsHours } from '../shared/options.ts';
import type { PrivacyConsent, ProfileInput } from '../shared/types.ts';

const consent: PrivacyConsent = { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true };
const publishable = (): ProfileInput => ({
  ...emptyProfile(), realName: '测试同学', gender: 'male', grade: 'y1', planTags: ['期末复习备考'], places: ['library'],
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

test('major, photos, bio, contacts and learning rhythm remain optional after gender and grade are required', () => {
  const p = publishable();
  assert.equal(p.gender, 'male');
  assert.equal(p.major, '');
  assert.equal(p.grade, 'y1');
  assert.equal(p.bio, '');
  assert.deepEqual(p.photos, []);
  assert.deepEqual(missingFields(p), []);
});

test('publication requires a name, gender, grade, recognized goal, location, available time, study style and all four consents', () => {
  assert.deepEqual(new Set(missingFields(emptyProfile()).map((item) => item.key)), new Set(['realName', 'gender', 'grade', 'planTags', 'places', 'schedule', 'studyType', 'privacyConsent']));
  assert.ok(missingFields({ ...publishable(), planTags: ['unrecognized'] }).some((item) => item.key === 'planTags'));
  for (const key of Object.keys(consent) as (keyof PrivacyConsent)[]) {
    const p = { ...publishable(), privacyConsent: { ...consent, [key]: false } };
    assert.equal(hasPrivacyConsent(p), false);
    assert.deepEqual(missingFields(p).map((item) => item.key), ['privacyConsent']);
  }
  assert.equal(hasPrivacyConsent({ privacyConsent: { ...consent, policy: 'true' } as unknown as PrivacyConsent }), false);
});

test('gender accepts only male or female and grade requires a listed value regardless of public visibility', () => {
  for (const gender of ['', 'other', 'unknown']) {
    assert.deepEqual(missingFields({ ...publishable(), gender }), [{ key: 'gender', label: '性别' }]);
  }
  for (const grade of ['', 'y5', 'unknown']) {
    assert.deepEqual(missingFields({ ...publishable(), grade }), [{ key: 'grade', label: '年级' }]);
  }
  for (const gender of ['male', 'female']) {
    for (const grade of ['y1', 'y2', 'y3', 'y4', 'grad']) {
      assert.deepEqual(missingFields({ ...publishable(), gender, grade, genderVisibility: 'private' }), []);
    }
  }
});

test('old profiles keep public gender while explicit private visibility survives normalization', () => {
  assert.equal(emptyProfile().genderVisibility, 'public');
  assert.equal(pickProfileInput({ gender: 'male' }).genderVisibility, 'public');
  assert.equal(pickProfileInput({ schemaVersion: 2, gender: 'female', genderVisibility: 'private' }).genderVisibility, 'private');
  assert.equal(pickProfileInput({ genderVisibility: 'invalid' as ProfileInput['genderVisibility'] }).genderVisibility, 'public');
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

test('v2 questionnaire fields are optional, default safely and never join the required set', () => {
  const p = publishable();
  assert.deepEqual(p.subjects, []);
  assert.deepEqual(p.semesterCourses, []);
  assert.equal(p.goalDeadline, '');
  assert.equal(p.studyFormat, '');
  assert.equal(p.buddyGender, 'any');
  assert.deepEqual(Object.values(p.personality), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(missingFields(p), []);
  const stored = pickProfileInput({ ...publishable(), subjects: undefined, personality: undefined, studyFormat: undefined } as unknown as Partial<ProfileInput>);
  assert.deepEqual(stored.subjects, []);
  assert.deepEqual(stored.semesterCourses, []);
  assert.equal(stored.studyFormat, '');
  assert.deepEqual(stored.personality, { talk: 0, noise: 0, punctual: 0, plan: 0, needSupervision: 0, giveSupervision: 0, social: 0 });
  const partial = pickProfileInput({ ...publishable(), personality: { talk: 4 } as ProfileInput['personality'] });
  assert.equal(partial.personality.talk, 4);
  assert.equal(partial.personality.giveSupervision, 0);
});

test('server sanitization bounds subjects, deadlines, study format, buddy gender and personality answers', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-profile-'));
  process.env.DATA_DIR = dir;
  try {
    const { sanitizeProfile } = await import('../server/profiles.ts');
    const clean = sanitizeProfile({
      ...publishable(),
      subjects: [' ＣＳ１０９ ', 'CS109', 'ＩＥＬＴＳ', 'ielts', 42, '', '   ', '雅思​'],
      goalDeadline: '2026-12-20', studyFormat: 'online', buddyGender: 'female',
      personality: { talk: 3, noise: '4', punctual: 6, plan: 2.5, social: 0, needSupervision: 5, giveSupervision: true, extra: 3 },
    });
    assert.deepEqual(clean.subjects, ['CS109 计算机程序设计基础', '雅思']);
    assert.throws(() => sanitizeProfile({ ...publishable(), subjects: ['任意填写的课程'] }), /请从课程或考试列表中选择/);
    assert.deepEqual(sanitizeProfile({ ...publishable(), subjects: ['原有自由科目'] }, ['原有自由科目']).subjects, ['原有自由科目']);
    const goals = ['雅思', '托福', 'GRE', 'GMAT'];
    assert.throws(() => sanitizeProfile({ ...publishable(), subjects: goals }), /目标科目最多选择 3 项/);
    assert.throws(() => sanitizeProfile({ ...publishable(), subjects: goals }, goals), /目标科目最多选择 3 项/);
    assert.deepEqual(sanitizeProfile({ ...publishable(), subjects: goals }, goals, { draft: true }).subjects, goals);
    assert.throws(() => sanitizeProfile({ ...publishable(), subjects: goals }, [], { draft: true }), /目标科目最多选择 3 项/);
    assert.deepEqual(sanitizeProfile({ ...publishable(), semesterCourses: ['CS109', 'CS109 计算机程序设计基础', 'CS317'] }).semesterCourses,
      ['CS109 计算机程序设计基础', 'CS317 计算机科学与技术前沿讲座 I']);
    for (const semesterCourses of [['雅思'], ['任意课程'], [42], 'CS109']) {
      assert.throws(() => sanitizeProfile({ ...publishable(), semesterCourses }), /本学期课表课程只能从课程目录选择/);
    }
    assert.equal(clean.goalDeadline, '2026-12-20');
    assert.equal(clean.genderVisibility, 'public');
    assert.equal(sanitizeProfile({ ...publishable(), genderVisibility: 'private' }).genderVisibility, 'private');
    assert.equal(sanitizeProfile({ ...publishable(), genderVisibility: 'invalid' }).genderVisibility, 'public');
    assert.equal(clean.studyFormat, 'online');
    assert.equal(clean.buddyGender, 'female');
    assert.deepEqual(clean.personality, { talk: 3, noise: 0, punctual: 0, plan: 0, social: 0, needSupervision: 5, giveSupervision: 0 });
    for (const goalDeadline of ['2026-02-30', '2026-13-01', '1999-12-31', '2101-01-01', 20261220, '2026-12-20T00:00', ' 2026-12-20']) {
      assert.equal(sanitizeProfile({ ...publishable(), goalDeadline }).goalDeadline, '', String(goalDeadline));
    }
    assert.equal(sanitizeProfile({ ...publishable(), goalDeadline: '2028-02-29' }).goalDeadline, '2028-02-29');
    const odd = sanitizeProfile({ ...publishable(), subjects: 'not-a-list', studyFormat: 'hybrid', buddyGender: 'robot', personality: null });
    assert.deepEqual(odd.subjects, []);
    assert.equal(odd.studyFormat, '');
    assert.equal(odd.buddyGender, 'any');
    assert.deepEqual(Object.values(odd.personality), [0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(missingFields(clean), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
