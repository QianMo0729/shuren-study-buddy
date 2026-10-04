// 前后端共享的数据结构

export type Role = 'user' | 'admin';

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
  nickname: string | null;
  published: boolean;
  hasProfile: boolean;
  questionnaireComplete: boolean;
  unread: number;
}

export interface Contacts {
  showEmail: boolean;
  wechat: string;
  qq: string;
  phone: string;
  other: string;
}

/** 可编辑的个人资料（本人视角，含隐私字段） */
export interface ProfileInput {
  schemaVersion: number;
  realName: string;
  studentId: string;
  gender: string;
  grade: string;
  major: string; // 专业/院系 id，见 shared/majors.ts
  buddyGender: string;
  photos: string[];
  schedule: number[]; // 被选中的时间格下标
  timetable: string | null;
  studyPlan: string;
  planTags: string[];
  mbti: string;
  contacts: Contacts;
  status: string;
  futurePlan: string;
  futurePlanOther: string;
  bio: string;
  studyType: string;
  modes: string[];
  places: string[];
  placesOther: string;
  traits: string[];
  traitsOther: string;
  dislikes: string;
  sports: string[];
  sportsOther: string;
  arts: string;
  goalResearch: string;
  goalSkills: string;
  goalOther: string;
  expectedPlaces: string[];
  expectedPlacesOther: string;
  expectedSchedule: number[];
  studyMethods: string[];
  studyMethodsOther: string;
  frequency: string;
  duration: string;
  expectations: string;
  dislikeTags: string[];
  interests: string[];
  interestsOther: string;
  photoVisibility: 'private' | 'public';
  privacyConsent: PrivacyConsent;
}

export interface PrivacyConsent {
  policy: boolean;
  contactExchange: boolean;
  silentExclusion: boolean;
  withdrawal: boolean;
}

export interface MyProfile extends ProfileInput {
  userId: number;
  nickname: string;
  email: string;
  published: boolean;
  publishedAt: string | null;
  savedAt: string | null;
  takenDown: boolean;
  takenDownAt: string | null;
  takedownReason: string | null;
  stats: { views: number; favorites: number; contactViews: number };
}

/** 广场卡片 */
export interface ProfileCard {
  id: number;
  nickname: string;
  major: string;
  gender: string;
  grade: string;
  studyType: string;
  modes: string[];
  status: string;
  cover: string | null;
  mbti: string;
  isMe: boolean;
  overlapHours: number;
  publishedAt: string | null;
  match?: MatchInfo;
  recommendation?: RecommendationInfo;
  studyPlan?: string;
  planTags?: string[];
}

export interface RecommendationDimension {
  key: 'time' | 'goals' | 'style' | 'places' | 'methods' | 'rhythm' | 'interests';
  label: string;
  weight: number;
  similarity: number | null;
  detail: string;
}

/** Questionnaire compatibility score, not a probability of a successful match. */
export interface RecommendationInfo {
  version: 'rules-v1';
  score: number;
  coverage: number;
  overlapHours: number;
  commonSlots: number[];
  reasons: string[];
  cautions: string[];
  dimensions: RecommendationDimension[];
}

export interface RecommendationResponse {
  items: ProfileCard[];
  total: number;
  eligibleCount: number;
  state: 'ready' | 'incomplete' | 'unpublished' | 'unavailable' | 'no_overlap' | 'empty';
  missing: { key: string; label: string }[];
}

export interface MatchInfo {
  score: number;
  total: number;
  matched: string[]; // 命中的条件 key 或关键词
  missed: string[];
  snippet?: string;
}

/** 他人主页（公开字段，不含姓名、学号） */
export interface PublicProfile {
  id: number;
  nickname: string;
  gender: string;
  grade: string;
  major: string;
  buddyGender: string;
  photos: string[];
  schedule: number[];
  timetable: string | null;
  studyPlan: string;
  planTags: string[];
  mbti: string;
  status: string;
  futurePlan: string;
  futurePlanOther: string;
  bio: string;
  studyType: string;
  modes: string[];
  places: string[];
  placesOther: string;
  traits: string[];
  traitsOther: string;
  dislikes: string;
  sports: string[];
  sportsOther: string;
  arts: string;
  goalResearch: string;
  goalSkills: string;
  goalOther: string;
  expectedPlaces: string[];
  expectedPlacesOther: string;
  expectedSchedule: number[];
  studyMethods: string[];
  studyMethodsOther: string;
  frequency: string;
  duration: string;
  expectations: string;
  dislikeTags: string[];
  interests: string[];
  interestsOther: string;
  photoVisibility: 'private' | 'public';
  publishedAt: string | null;
  isMe: boolean;
  isFavorite: boolean;
  hasContacts: boolean;
  overlap: number[];
  mySchedule: number[];
  takenDown?: boolean;
}

export interface ContactReveal {
  email: string | null;
  wechat: string;
  qq: string;
  phone: string;
  other: string;
}

export interface ContactRequest {
  id: number;
  requesterId: number;
  recipientId: number;
  status: 'pending' | 'accepted' | 'rejected';
  message: string;
  createdAt: string;
  updatedAt: string;
  other: { id: number; nickname: string };
  direction: 'incoming' | 'outgoing';
}

export interface Post {
  id: number;
  title: string;
  category: string;
  description: string;
  timeText: string;
  location: string;
  capacity: number; // 0 = 不限
  tags: string[];
  status: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
  interestCount: number;
  interested: boolean;
  isMine: boolean;
  author: { id: number; nickname: string; major: string; studyType: string; cover: string | null; published: boolean };
  takenDown?: boolean;
  takedownReason?: string | null;
  interestedUsers?: { id: number; nickname: string; cover: string | null }[];
}

export interface NotificationItem {
  id: number;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  read: boolean;
}

export type CriterionField =
  | 'major'
  | 'college'
  | 'gender'
  | 'grade'
  | 'studyType'
  | 'modes'
  | 'places'
  | 'traits'
  | 'mbti'
  | 'futurePlan'
  | 'sports'
  | 'overlap'
  | 'planTags'
  | 'status'
  | 'studyMethods'
  | 'frequency'
  | 'duration'
  | 'interests'
  | 'expectations'
  | 'expectedPlaces'
  | 'schedule'
  | 'text';

/** 仿知网高级检索：加分（计入过半规则）/ 必须 / 排除 */
export type CriterionMode = 'should' | 'must' | 'not';

export interface Criterion {
  field: CriterionField;
  mode: CriterionMode;
  values: string[];
}

export interface AdvancedQuery {
  criteria: Criterion[];
  matchMode?: 'precise' | 'fuzzy';
  minMatch?: number;
  mutualGender?: boolean;
}
