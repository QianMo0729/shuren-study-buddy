import { PLAN_PRESETS, SPORTS, TRAITS, optionLabel, overlapSlots } from './options.ts';
import type { Contacts, PrivacyConsent, ProfileInput } from './types.ts';

export const emptyContacts = (): Contacts => ({ showEmail: false, wechat: '', qq: '', phone: '', other: '' });
export const emptyConsent = (): PrivacyConsent => ({ policy: false, contactExchange: false, silentExclusion: false, withdrawal: false });
export const hasPrivacyConsent = (p: Pick<ProfileInput, 'privacyConsent'>) =>
  ['policy', 'contactExchange', 'silentExclusion', 'withdrawal'].every((k) => p.privacyConsent?.[k as keyof PrivacyConsent] === true);

export function emptyProfile(): ProfileInput {
  return {
    schemaVersion: 2,
    realName: '', studentId: '', gender: '', grade: '', major: '', buddyGender: 'any',
    photos: [], schedule: [], timetable: null, studyPlan: '', planTags: [], mbti: '',
    contacts: emptyContacts(), status: 'seeking', futurePlan: '', futurePlanOther: '', bio: '',
    studyType: '', modes: [], places: [], placesOther: '', traits: [], traitsOther: '', dislikes: '',
    sports: [], sportsOther: '', arts: '', goalResearch: '', goalSkills: '', goalOther: '',
    expectedPlaces: [], expectedPlacesOther: '', expectedSchedule: [], studyMethods: [], studyMethodsOther: '',
    frequency: '', duration: '', expectations: '', dislikeTags: [], interests: [], interestsOther: '',
    photoVisibility: 'private', privacyConsent: emptyConsent(),
  };
}

export const PROFILE_KEYS = Object.keys(emptyProfile()) as (keyof ProfileInput)[];

/** Convert old time slots conservatively: only keep new slots fully covered by old availability. */
export function migrateSchedule(old: number[]): number[] {
  const oldPeriods = [[6, 8], [8, 10], [10, 12], [12, 14], [14, 16], [16, 18], [18, 19], [19, 21], [21, 23], [23, 25]];
  const newPeriods = [[8, 10], [10, 12], [12, 14], [14, 16], [16, 18], [18, 20], [20, 22], [22, 24], [0, 8]];
  const hours = new Set<number>();
  for (const slot of old) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= 70) continue;
    const day = Math.floor(slot / 10);
    const [a, b] = oldPeriods[slot % 10];
    for (let h = a; h < b; h++) hours.add((day * 24 + h) % 168);
  }
  return Array.from({ length: 63 }, (_, s) => s).filter((s) => {
    const [a, b] = newPeriods[s % 9];
    const d = Math.floor(s / 9);
    return Array.from({ length: b - a }, (_, i) => d * 24 + a + i).every((h) => hours.has(h));
  });
}

export function pickProfileInput(src: Partial<ProfileInput>): ProfileInput {
  const base = emptyProfile();
  const out = {} as Record<string, unknown>;
  for (const k of PROFILE_KEYS) out[k] = src[k] ?? base[k];
  const p = out as unknown as ProfileInput;
  p.contacts = { ...emptyContacts(), ...src.contacts };
  p.privacyConsent = { ...emptyConsent(), ...src.privacyConsent };
  if (src.schemaVersion !== 2) {
    p.schemaVersion = 2;
    p.schedule = migrateSchedule(Array.isArray(src.schedule) ? src.schedule : []);
    p.studyType = ({ deep: 'quiet', pomodoro: 'flexible', talk: 'discuss', plan: 'checkin' } as Record<string, string>)[p.studyType] ?? p.studyType;
    const goals = p.planTags.map((g) => {
      if (PLAN_PRESETS.includes(g)) return g;
      if (/期末|期中/.test(g)) return '期末复习备考';
      if (/雅思|托福|GRE|四六级/.test(g)) return '语言考试';
      if (/科研|竞赛/.test(g)) return '科研/竞赛项目';
      if (/刷题|编程|CPA/.test(g)) return '技能自学';
      return '其他';
    });
    p.goalOther = p.planTags.filter((g) => !PLAN_PRESETS.includes(g)).join('、');
    p.planTags = [...new Set(goals)];
    p.interestsOther = [...new Set([
      p.interestsOther, ...p.sports.map((value) => optionLabel(SPORTS, value) || value), p.sportsOther, p.arts,
    ].filter(Boolean))].join('、');
    p.interests = [...new Set([
      ...p.interests, ...(p.sports.length || p.sportsOther ? ['sports'] : []), ...(p.interestsOther ? ['other'] : []),
    ])];
    p.places = p.places.map((v) => v === 'college' ? 'teaching' : v).filter((v) => v !== 'online');
    if (src.places?.includes('online')) p.placesOther = [p.placesOther, '线上连麦'].filter(Boolean).join('、');
    p.expectations = [...new Set([
      p.expectations, ...p.traits.map((value) => optionLabel(TRAITS, value) || value), p.traitsOther,
      p.buddyGender === 'male' ? '希望男同学' : p.buddyGender === 'female' ? '希望女同学' : '',
    ].filter(Boolean))].join('；');
    p.photoVisibility = 'private';
    p.privacyConsent = emptyConsent();
  }
  return p;
}

export const effectiveSchedule = (p: Pick<ProfileInput, 'schedule' | 'expectedSchedule'>): number[] =>
  p.expectedSchedule.length ? overlapSlots(p.schedule, p.expectedSchedule) : p.schedule;

/** Required publication fields correspond to questionnaire A–F, not optional demographics. */
export function missingFields(p: ProfileInput): { key: keyof ProfileInput; label: string }[] {
  const m: { key: keyof ProfileInput; label: string }[] = [];
  const need = (ok: boolean, key: keyof ProfileInput, label: string) => !ok && m.push({ key, label });
  need(!!p.realName.trim(), 'realName', '真实姓名');
  need(p.planTags.some((v) => PLAN_PRESETS.includes(v)), 'planTags', '近期学习目标');
  need(p.places.length > 0 || !!p.placesOther.trim(), 'places', '我的学习地点');
  need(p.schedule.length > 0, 'schedule', '我的空闲时间');
  need(!!p.studyType, 'studyType', '和伙伴在一起的主要学习方式');
  need(hasPrivacyConsent(p), 'privacyConsent', '四项隐私同意');
  return m;
}
