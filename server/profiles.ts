import crypto from 'node:crypto';
import {
  BUDDY_GENDERS, FUTURE_PLANS, GENDERS, GRADES, MBTIS, MODES, PLACES, SLOT_COUNT, SPORTS, STATUSES, STUDY_TYPES, TRAITS,
  overlapSlots, slotsHours, STUDY_METHODS, FREQUENCIES, DURATIONS, INTERESTS, DISLIKE_OPTIONS, PLAN_PRESETS,
  PERSONALITY_ITEMS, STUDY_FORMATS,
} from '../shared/options.ts';
import { SPECIES } from '../shared/species.ts';
import { emptyProfile, missingFields, pickProfileInput, hasPrivacyConsent } from '../shared/profileRules.ts';
export { emptyProfile, missingFields };
import type { MyProfile, Personality, ProfileCard, ProfileInput, PublicProfile, StudyFormat } from '../shared/types.ts';
import { iso, q } from './db.ts';
import { HttpError } from './auth.ts';
import { matchStateFor } from './matches.ts';

// ---------- 系统随机昵称 ----------

const NICK_WORDS = SPECIES.map((s) => s.zh);
const NICK_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateNickname(): string {
  for (let i = 0; i < 50; i++) {
    const word = NICK_WORDS[crypto.randomInt(NICK_WORDS.length)];
    const letters = Array.from({ length: 3 }, () => NICK_LETTERS[crypto.randomInt(NICK_LETTERS.length)]).join('');
    const nick = `${word}${letters}${crypto.randomInt(10, 100)}`;
    if (!q.get('SELECT 1 FROM profiles WHERE nickname = ?', nick)) return nick;
  }
  return `搭子${Date.now().toString(36).toUpperCase()}`;
}

// ---------- 默认值与清洗 ----------

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const pick = (v: unknown, allowed: { value: string }[]) => (allowed.some((o) => o.value === v) ? String(v) : '');
const pickMany = (v: unknown, allowed: { value: string }[]) =>
  Array.isArray(v) ? [...new Set(v.filter((x) => allowed.some((o) => o.value === x)).map(String))] : [];
const fileName = (v: unknown) => (typeof v === 'string' && /^[a-f0-9]{24}\.(jpg|png|webp)$/.test(v) ? v : null);

export function sanitizeProfile(raw: any): ProfileInput {
  const r = raw ?? {};
  const c = r.contacts ?? {};
  const consent = r.privacyConsent ?? {};
  const slots = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((n) => Number.isInteger(n) && n >= 0 && n < SLOT_COUNT))].sort((a, b) => a - b) : [];
  // 'YYYY-MM-DD' 且是真实存在的日期（2000–2100 年），否则 ''
  const calendarDate = (v: unknown) => {
    const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
    if (!m) return '';
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(y, mo - 1, d));
    return y >= 2000 && y <= 2100 && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? m[0] : '';
  };
  return {
    schemaVersion: 2,
    realName: str(r.realName, 30),
    studentId: String(r.studentId ?? '').replace(/\D/g, '').slice(0, 8),
    gender: pick(r.gender, GENDERS),
    grade: pick(r.grade, GRADES),
    major: str(r.major, 60),
    buddyGender: pick(r.buddyGender, BUDDY_GENDERS) || 'any',
    photos: (Array.isArray(r.photos) ? r.photos : []).map(fileName).filter(Boolean).slice(0, 4) as string[],
    schedule: Array.isArray(r.schedule)
      ? [...new Set(r.schedule.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n < SLOT_COUNT))].sort(
          (a: any, b: any) => a - b,
        ) as number[]
      : [],
    timetable: fileName(r.timetable),
    studyPlan: str(r.studyPlan, 200),
    planTags: (Array.isArray(r.planTags) ? r.planTags : []).map((t: unknown) => str(t, 12)).filter(Boolean).filter((t: string) => PLAN_PRESETS.includes(t)).slice(0, 8),
    mbti: str(r.mbti, 30),
    contacts: {
      showEmail: c.showEmail === true,
      wechat: str(c.wechat, 40),
      qq: str(c.qq, 20).replace(/\D/g, ''),
      phone: str(c.phone, 20).replace(/[^\d+\- ]/g, ''),
      other: str(c.other, 60),
    },
    status: pick(r.status, STATUSES) || 'seeking',
    futurePlan: pick(r.futurePlan, FUTURE_PLANS),
    futurePlanOther: str(r.futurePlanOther, 30),
    bio: str(r.bio, 300),
    studyType: pick(r.studyType, STUDY_TYPES),
    modes: pickMany(r.modes, MODES),
    places: pickMany(r.places, PLACES),
    placesOther: str(r.placesOther, 30),
    traits: pickMany(r.traits, TRAITS),
    traitsOther: str(r.traitsOther, 30),
    dislikes: str(r.dislikes, 120),
    sports: pickMany(r.sports, SPORTS),
    sportsOther: str(r.sportsOther, 30),
    arts: str(r.arts, 60),
    goalResearch: str(r.goalResearch, 200), goalSkills: str(r.goalSkills, 200), goalOther: str(r.goalOther, 200),
    expectedPlaces: pickMany(r.expectedPlaces, PLACES), expectedPlacesOther: str(r.expectedPlacesOther, 60),
    expectedSchedule: slots(r.expectedSchedule), studyMethods: pickMany(r.studyMethods, STUDY_METHODS),
    studyMethodsOther: str(r.studyMethodsOther, 120), frequency: pick(r.frequency, FREQUENCIES), duration: pick(r.duration, DURATIONS),
    expectations: str(r.expectations, 500), dislikeTags: pickMany(r.dislikeTags, DISLIKE_OPTIONS),
    interests: pickMany(r.interests, INTERESTS), interestsOther: str(r.interestsOther, 120),
    photoVisibility: r.photoVisibility === 'public' ? 'public' : 'private',
    privacyConsent: { policy: consent.policy === true, contactExchange: consent.contactExchange === true,
      silentExclusion: consent.silentExclusion === true, withdrawal: consent.withdrawal === true },
    // 具体科目：全角转半角、合并空白、去掉控制字符；忽略大小写与空白后重复的只保留第一个
    subjects: (Array.isArray(r.subjects) ? r.subjects : [])
      .filter((t: unknown) => typeof t === 'string')
      .map((t: string) => t.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/gu, ' ').trim()).map((t: string) => [...t].slice(0, 30).join('').trim())
      .filter((t: string, i: number, all: string[]) => {
        const key = (x: string) => x.toLowerCase().replace(/\s+/gu, '');
        return !!key(t) && all.findIndex((x) => key(x) === key(t)) === i;
      })
      .slice(0, 8),
    goalDeadline: calendarDate(r.goalDeadline),
    studyFormat: (pick(r.studyFormat, STUDY_FORMATS) || '') as StudyFormat,
    // 每题 1–5 的整数，其余一律视为未回答（0）
    personality: Object.fromEntries(PERSONALITY_ITEMS.map((item) => {
      const n = r.personality?.[item.key];
      return [item.key, typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5 ? n : 0];
    })) as unknown as Personality,
  };
}

// ---------- 读取 ----------

interface ProfileRow {
  user_id: number;
  nickname: string;
  data: string;
  published: number;
  published_at: string | null;
  saved_at: string | null;
  taken_down: number;
  taken_down_at: string | null;
  takedown_reason: string | null;
  reviewed_at: string | null;
  views: number;
  email?: string;
}

export function parseData(row: ProfileRow): ProfileInput {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(row.data);
  } catch {}
  return pickProfileInput(parsed as Partial<ProfileInput>);
}

export function getProfileRow(userId: number) {
  return q.get<ProfileRow>('SELECT p.*, u.email FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?', userId);
}

/** 确保有资料行（首次进入编辑页时创建，并分配昵称） */
export function ensureProfile(userId: number): ProfileRow {
  let row = getProfileRow(userId);
  if (!row) {
    q.run('INSERT INTO profiles (user_id, nickname, data) VALUES (?, ?, ?)', userId, generateNickname(), JSON.stringify(emptyProfile()));
    row = getProfileRow(userId)!;
  }
  return row;
}

export function toMyProfile(row: ProfileRow): MyProfile {
  const d = parseData(row);
  d.studentId = row.email?.split('@')[0] ?? d.studentId;
  const favorites = q.get<{ n: number }>('SELECT COUNT(*) n FROM favorites WHERE target_id = ?', row.user_id)!.n;
  const contactViews = q.get<{ n: number }>('SELECT COUNT(*) n FROM contact_views WHERE target_id = ?', row.user_id)!.n;
  return {
    ...d,
    userId: row.user_id,
    nickname: row.nickname,
    email: row.email ?? '',
    published: !!row.published,
    publishedAt: iso(row.published_at),
    savedAt: iso(row.saved_at),
    takenDown: !!row.taken_down,
    takenDownAt: iso(row.taken_down_at),
    takedownReason: row.takedown_reason,
    stats: { views: row.views, favorites, contactViews },
  };
}

export function toCard(row: ProfileRow, d: ProfileInput, me: { id: number; schedule: number[] }): ProfileCard {
  return {
    id: row.user_id,
    nickname: row.nickname,
    major: d.major,
    gender: d.gender,
    grade: d.grade,
    studyType: d.studyType,
    modes: d.modes,
    status: d.status,
    cover: d.photoVisibility === 'public' && hasPrivacyConsent(d) ? d.photos[0] ?? null : null,
    mbti: '',
    studyPlan: d.studyPlan,
    planTags: d.planTags,
    subjects: d.subjects,
    isMe: row.user_id === me.id,
    overlapHours: row.user_id === me.id ? 0 : overlapHoursOf(d.schedule, me.schedule),
    publishedAt: iso(row.published_at),
  };
}

export const overlapHoursOf = (a: number[], b: number[]) => slotsHours(overlapSlots(a, b));

export function toPublic(row: ProfileRow, d: ProfileInput, viewerId: number, mySchedule: number[]): PublicProfile {
  const c = d.contacts;
  const isFavorite = !!q.get('SELECT 1 FROM favorites WHERE user_id = ? AND target_id = ?', viewerId, row.user_id);
  const relation = matchStateFor(viewerId, row.user_id);
  return {
    id: row.user_id,
    nickname: row.nickname,
    gender: d.gender,
    grade: d.grade,
    major: d.major,
    buddyGender: d.buddyGender,
    photos: row.user_id === viewerId || (d.photoVisibility === 'public' && hasPrivacyConsent(d)) ? d.photos : [],
    schedule: d.schedule,
    timetable: null,
    studyPlan: d.studyPlan,
    planTags: d.planTags,
    mbti: d.mbti,
    status: d.status,
    futurePlan: d.futurePlan,
    futurePlanOther: d.futurePlanOther,
    bio: d.bio,
    studyType: d.studyType,
    modes: d.modes,
    places: d.places,
    placesOther: d.placesOther,
    traits: d.traits,
    traitsOther: d.traitsOther,
    dislikes: d.dislikes,
    sports: d.sports,
    sportsOther: d.sportsOther,
    arts: d.arts,
    goalResearch: d.goalResearch, goalSkills: d.goalSkills, goalOther: d.goalOther,
    expectedPlaces: d.expectedPlaces, expectedPlacesOther: d.expectedPlacesOther, expectedSchedule: d.expectedSchedule,
    studyMethods: d.studyMethods, studyMethodsOther: d.studyMethodsOther, frequency: d.frequency, duration: d.duration,
    expectations: d.expectations, dislikeTags: d.dislikeTags, interests: d.interests, interestsOther: d.interestsOther,
    photoVisibility: d.photoVisibility,
    subjects: d.subjects,
    goalDeadline: d.goalDeadline,
    studyFormat: d.studyFormat,
    personality: d.personality,
    publishedAt: iso(row.published_at),
    isMe: row.user_id === viewerId,
    isFavorite,
    hasContacts: !!(c.showEmail || c.wechat || c.qq || c.phone || c.other),
    overlap: row.user_id === viewerId ? [] : overlapSlots(d.schedule, mySchedule),
    mySchedule,
    takenDown: !!row.taken_down,
    matchState: relation.state,
    matchId: relation.matchId,
  };
}

/** 广场上所有已发布的主页 */
export function publishedRows() {
  return q.all<ProfileRow>('SELECT * FROM profiles WHERE published = 1 AND taken_down = 0 ORDER BY published_at DESC');
}

export function mySchedule(userId: number): number[] {
  const row = getProfileRow(userId);
  return row ? parseData(row).schedule : [];
}

/** 资料图片必须是本人上传、且用途匹配（主页照片 / 课表），社区图片和打卡照片不能挪作主页照片 */
export function assertOwnFile(userId: number, name: string | null, kind: 'photo' | 'timetable' = 'photo') {
  if (!name) return;
  const owner = q.get<{ user_id: number; kind: string }>('SELECT user_id, kind FROM uploads WHERE name = ?', name);
  if (!owner || owner.user_id !== userId || owner.kind !== kind) throw new HttpError(400, '图片无效，请重新上传');
}

// Old profiles never consented to the revised visibility rules. Retain their data and
// nickname, migrate slot coordinates, and require review/consent before republishing.
for (const row of q.all<ProfileRow>('SELECT * FROM profiles')) {
  let raw: Partial<ProfileInput>;
  try { raw = JSON.parse(row.data); } catch { raw = {}; }
  if (raw.schemaVersion === 2) continue;
  q.run('UPDATE profiles SET data = ?, published = 0 WHERE user_id = ?', JSON.stringify(pickProfileInput(raw)), row.user_id);
}
