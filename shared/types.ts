// 前后端共享的数据结构

export type Role = 'user' | 'admin';

/** 仅极高风险内容暂缓公开，等待管理员复核；其余内容直接发布。 */
export interface ContentReviewState {
  reviewPending: boolean;
  reviewReasons: string[];
}

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
  nickname: string | null;
  published: boolean;
  hasProfile: boolean;
  questionnaireComplete: boolean;
  unread: number;
  /** 私聊中尚未读的消息数（不含自己发出的与系统消息） */
  unreadMessages: number;
}

/** 学习性格：每项 1–5，0 表示未回答。见 shared/options.ts 的 PERSONALITY_ITEMS */
export interface Personality {
  talk: number;
  noise: number;
  punctual: number;
  plan: number;
  needSupervision: number;
  giveSupervision: number;
  social: number;
}
export type PersonalityKey = keyof Personality;

/** ''：未填写（按“都可以”处理） */
export type StudyFormat = '' | 'offline' | 'online' | 'both';

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
  genderVisibility: 'public' | 'private';
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
  /** 本学期课表课程，仅本人可见，不参与匹配评分，最多 30 门标准课程。 */
  semesterCourses: string[];
  /** 本次学习目标的科目（标准课程或考试），最多 3 项。 */
  subjects: string[];
  /** 目标截止日期（考试日等），'' 或 YYYY-MM-DD */
  goalDeadline: string;
  studyFormat: StudyFormat;
  personality: Personality;
}

export type QuestionnaireSection = 'identity' | 'demographics' | 'goals' | 'study' | 'personality' | 'expectations' | 'privacy' | 'review';

/** 自动保存的未提交答案，与已经发布的资料独立存储。 */
export interface ProfileDraft {
  form: ProfileInput;
  section: QuestionnaireSection;
  updatedAt: string;
}

export interface PrivacyConsent {
  policy: boolean;
  contactExchange: boolean;
  silentExclusion: boolean;
  withdrawal: boolean;
}

export interface MyProfile extends ProfileInput, ContentReviewState {
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

/** 仅当前登录者可见的私人备注，绝不写入被备注人的公开资料。 */
export interface PrivateNote {
  remarkName: string;
  note: string;
  updatedAt: string;
}

/** 广场卡片 */
export interface ProfileCard {
  id: number;
  nickname: string;
  remarkName?: string;
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
  subjects?: string[];
}

export type DimensionKey = 'time' | 'content' | 'personality' | 'style' | 'places' | 'rhythm' | 'interests';

export interface RecommendationDimension {
  key: DimensionKey;
  label: string;
  weight: number;
  /** 双向平均的契合程度 0–1；任一方缺少可比信息时为 null（评分时按中性 0.5 计入） */
  similarity: number | null;
  /** 对方满足“我”的程度 0–1（null 同上） */
  forMe: number | null;
  /** “我”满足对方的程度 0–1（null 同上） */
  forThem: number | null;
  detail: string;
}

/** Questionnaire compatibility score, not a probability of a successful match. */
export interface RecommendationInfo {
  version: 'rules-v2';
  /** 双向契合度：forMe 与 forThem 的调和平均，0–100 */
  score: number;
  forMe: number;
  forThem: number;
  tier: 'great' | 'good' | 'fair';
  /** 双方都有可比信息的维度权重之和（0–100） */
  coverage: number;
  overlapHours: number;
  commonSlots: number[];
  reasons: string[];
  cautions: string[];
  dimensions: RecommendationDimension[];
}

// ---------- 滑卡推荐与反馈 ----------

export type FeedbackAction = 'like' | 'dislike' | 'skip';
export type MatchState = 'none' | 'liked' | 'disliked' | 'skipped' | 'matched';

export interface DeckCard extends ProfileCard {
  recommendation: RecommendationInfo;
  /** 结合个人偏好后的排序分 0–100（契合度仍以 recommendation.score 为准） */
  rankScore: number;
  /** 为避免推荐越来越窄而加入的探索位 */
  explore: boolean;
  subjects: string[];
}

export interface DeckResponse {
  items: DeckCard[];
  state: RecommendationResponse['state'];
  missing: { key: string; label: string }[];
  eligibleCount: number;
  /** 今日名单中仍可查看的人数 */
  total: number;
  daily: { date: string; limit: number; assigned: number; remaining: number; resetsAt: string };
  personalization: { samples: number; active: boolean; emphasis: string[] };
}

export interface FeedbackResult {
  action: FeedbackAction;
  matched: boolean;
  matchId: number | null;
}

export interface FeedbackItem {
  targetId: number;
  nickname: string;
  remarkName?: string;
  action: FeedbackAction;
  createdAt: string;
  /** 这条「不感兴趣」是解除配对时自动记下的 */
  closedMatch?: boolean;
}

// ---------- 私聊 ----------

export type ContactState = 'none' | 'pending_outgoing' | 'pending_incoming' | 'accepted' | 'rejected';

export interface ChatSummary {
  matchId: number;
  other: { id: number; nickname: string; cover: string | null; privateNote?: PrivateNote | null };
  status: 'active' | 'closed';
  lastMessage: { body: string; senderId: number | null; createdAt: string; kind: 'text' | 'system' } | null;
  unread: number;
  createdAt: string;
  contactState: ContactState;
}

export interface ChatMessage {
  id: number;
  matchId: number;
  senderId: number | null;
  kind: 'text' | 'system';
  body: string;
  createdAt: string;
  mine: boolean;
}

// ---------- 社区：聊天区帖子、打卡 ----------

export type ForumTargetType = 'post' | 'checkin';

export interface ForumAuthor {
  id: number;
  nickname: string;
  cover: string | null;
  /** 作者主页是否对当前用户可见（决定能否点进主页） */
  profileVisible: boolean;
}

export interface ForumPost extends ContentReviewState {
  id: number;
  title: string;
  body: string;
  images: string[];
  createdAt: string;
  updatedAt: string;
  author: ForumAuthor;
  likeCount: number;
  liked: boolean;
  commentCount: number;
  isMine: boolean;
  takenDown?: boolean;
  takedownReason?: string | null;
  match?: MatchInfo;
}

export interface ForumComment extends ContentReviewState {
  id: number;
  targetType: ForumTargetType;
  targetId: number;
  body: string;
  createdAt: string;
  author: ForumAuthor;
  isMine: boolean;
}

export type CheckinVisibility = 'all' | 'buddies';

export interface Checkin extends ContentReviewState {
  id: number;
  image: string;
  caption: string;
  placeLabel: string;
  /** 服务器盖章时间（ISO） */
  stampedAt: string;
  /** 水印上的北京时间文字 */
  stampText: string;
  visibility: CheckinVisibility;
  author: ForumAuthor;
  likeCount: number;
  liked: boolean;
  commentCount: number;
  isMine: boolean;
  takenDown?: boolean;
  takedownReason?: string | null;
}

export interface CheckinSession {
  token: string;
  expiresAt: string;
  serverTime: string;
}

export interface CheckinStats {
  streak: number;
  total: number;
  checkedInToday: boolean;
}

export type ReportTargetType = 'profile' | 'post' | 'forum_post' | 'comment' | 'checkin' | 'message';
export type ModerationTargetType = 'profile' | 'post' | 'forum_post' | 'comment' | 'checkin';

export interface RecommendationResponse {
  items: ProfileCard[];
  total: number;
  eligibleCount: number;
  state: 'ready' | 'incomplete' | 'unpublished' | 'unavailable' | 'no_overlap' | 'empty' | 'daily_done';
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
export interface PublicProfile extends ContentReviewState {
  id: number;
  nickname: string;
  privateNote?: PrivateNote | null;
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
  subjects: string[];
  goalDeadline: string;
  studyFormat: StudyFormat;
  personality: Personality;
  publishedAt: string | null;
  isMe: boolean;
  isFavorite: boolean;
  hasContacts: boolean;
  overlap: number[];
  mySchedule: number[];
  takenDown?: boolean;
  /** 当前用户对这位同学的反馈状态；matched 表示互相感兴趣、可以私聊 */
  matchState: MatchState;
  matchId: number | null;
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

export interface Post extends ContentReviewState {
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
  | 'text'
  | 'subjects'
  | 'postText';

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

/** 社区帖子的高级检索：postText 检索标题与正文，其余字段检索作者已公开的主页资料 */
export interface PostSearchQuery extends AdvancedQuery {
  keyword?: string;
}
