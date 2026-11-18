import type { ActivityConfig, SensitiveCategory } from '../../shared/activity';
import type {
  AdvancedQuery, BuddyStatus, LeaderboardResponse, Role, SeasonInfo, ShurenMember, ChatMessage, ChatSummary, Checkin, CheckinSession, CheckinStats, CheckinVisibility, ContactRequest, ContactReveal, ContentReviewState,
  DeckCard, DeckResponse, FeedbackAction, FeedbackItem, FeedbackResult, ForumComment, IncomingInterest, ForumPost, ForumTargetType, ModerationTargetType,
  MyProfile, NotificationItem, Post, PostSearchQuery, ProfileCard, ProfileDraft, ProfileInput, PublicProfile, QuestionnaireSection, RecommendationResponse, ReportTargetType, SessionUser,
} from '../../shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: any = {},
  ) {
    super(message);
  }
}

const DEVICE_KEY = 'dz-device';
let device: string | null | undefined;

/**
 * 本浏览器的随机编号，随请求发给服务器（服务器只保存它的哈希），用来标记「一台设备登录多个账号」「一部手机替两人打卡」。
 * 网页拿不到 MAC 地址等硬件信息；清除浏览器数据后会换一个新编号。
 */
function deviceId(): string | null {
  if (device !== undefined) return device;
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      const bytes = crypto.getRandomValues(new Uint8Array(18));
      id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem(DEVICE_KEY, id);
    }
    device = id;
  } catch {
    device = null;
  }
  return device;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const id = deviceId();
  if (id) headers['X-Device-Id'] = id;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, '网络连接失败，请检查网络后重试');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth')) window.dispatchEvent(new CustomEvent('dz:unauthorized'));
    throw new ApiError(res.status, data.error ?? '请求失败', data);
  }
  return data as T;
}

// 各功能模块需要额外接口时，可直接复用这些请求函数
export const get = <T>(url: string) => request<T>('GET', url);
export const post = <T>(url: string, body: unknown = {}) => request<T>('POST', url, body);
export const put = <T>(url: string, body: unknown) => request<T>('PUT', url, body);
export const del = <T>(url: string, body?: unknown) => request<T>('DELETE', url, body);
const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) u.set(k, String(v));
  const out = u.toString();
  return out ? `?${out}` : '';
};

export const fileUrl = (name: string | null | undefined) => (name ? `/api/files/${name}` : '');

type CodeResp = { ok: true; devCode?: string };
type Missing = { key: string; label: string }[];

export interface Meta {
  allowedDomains: string[];
  devMode: boolean;
  stats: { profiles: number; posts: number; users: number };
  breakdown: { types: Record<string, number>; topPlans: [string, number][]; categories: Record<string, number>; species: Record<string, number> };
}

export const api = {
  meta: () => get<Meta>('/meta'),

  me: () => get<{ user: SessionUser | null }>('/auth/me'),
  requestActivationCode: (studentId: string) => post<CodeResp & { email: string }>('/auth/request-activation-code', { studentId }),
  verifyActivationCode: (studentId: string, code: string) => post<{ setupToken: string; email: string }>('/auth/verify-activation-code', { studentId, code }),
  activate: (setupToken: string, password: string) => post<{ user: SessionUser }>('/auth/activate', { setupToken, password }),
  login: (email: string, password: string) => post<{ user: SessionUser }>('/auth/login', { email, password }),
  requestResetCode: (email: string) => post<CodeResp>('/auth/request-reset-code', { email }),
  resetPassword: (email: string, code: string, password: string) => post<{ ok: true }>('/auth/reset-password', { email, code, password }),
  logout: () => post<{ ok: true }>('/auth/logout'),
  deleteAccount: (password: string) => del<{ ok: true }>('/auth/account', { password }),
  connections: () => get<{ items: ContactRequest[]; exclusions: { id: number; nickname: string }[] }>('/connections'),
  connection: (userId: number) => get<{ request: ContactRequest | null; contacts: ContactReveal | null }>(`/connections/${userId}`),
  requestConnection: (userId: number, message: string) => post<{ request: ContactRequest; emailStatus: string }>(`/connections/${userId}`, { message }),
  respondConnection: (requestId: number, action: 'accept' | 'reject') => post<{ request: ContactRequest }>(`/connections/${requestId}/respond`, { action }),
  excludeConnection: (userId: number) => post<{ ok: true }>(`/connections/${userId}/exclude`),
  restoreConnection: (userId: number) => del<{ ok: true }>(`/connections/${userId}/exclude`),

  myProfile: () => get<{ profile: MyProfile; missing: Missing }>('/profiles/me'),
  profileDraft: () => get<{ draft: ProfileDraft | null }>('/profiles/me/draft'),
  saveProfileDraft: (profile: ProfileInput, section: QuestionnaireSection) => put<{ draft: ProfileDraft }>('/profiles/me/draft', { profile, section }),
  saveContacts: (contacts: { wechat?: string; qq?: string }) => put<{ contacts: { wechat: string; qq: string } }>('/profiles/me/contacts', contacts),
  saveProfile: (profile: ProfileInput) => put<{ profile: MyProfile; missing: Missing }>('/profiles/me', { profile }),
  publish: () => post<{ ok: true } & ContentReviewState>('/profiles/me/publish'),
  unpublish: () => post<{ ok: true }>('/profiles/me/unpublish'),

  square: (q = '', sort = 'latest') =>
    get<{ items: ProfileCard[]; total: number }>(`/profiles?q=${encodeURIComponent(q)}&sort=${sort}`),
  recommendations: () => get<RecommendationResponse>('/profiles/recommendations'),
  /** 按 ID（系统昵称或末尾编号）查找同学 */
  lookup: (id: string) => get<{ items: ProfileCard[] }>(`/profiles/lookup${qs({ id })}`),
  advancedSearch: (query: AdvancedQuery & { keyword?: string }) =>
    post<{ items: ProfileCard[]; total: number }>('/profiles/search', query),
  favorites: () => get<{ items: ProfileCard[] }>('/profiles/favorites'),
  profile: (id: number) => get<{ profile: PublicProfile }>(`/profiles/${id}`),
  contact: (id: number) => post<{ contacts: ContactReveal }>(`/profiles/${id}/contact`),
  favorite: (id: number) => post<{ isFavorite: boolean }>(`/profiles/${id}/favorite`),

  upload: (dataUrl: string, kind: 'photo' | 'timetable' | 'forum') => post<{ name: string }>('/uploads', { dataUrl, kind }),

  // ---------- 匹配推荐（滑卡） ----------
  match: {
    deck: (limit = 20) => get<DeckResponse>(`/match/deck${qs({ limit })}`),
    /** 按双向契合度排序的列表（不含个性化调整） */
    ranked: (limit = 50) => get<Omit<DeckResponse, 'items'> & { items: DeckCard[] }>(`/match/ranked${qs({ limit })}`),
    feedback: (targetId: number, action: FeedbackAction) => post<FeedbackResult>('/match/feedback', { targetId, action }),
    undoFeedback: (targetId: number) => del<{ ok: true }>(`/match/feedback/${targetId}`),
    feedbackList: (action: FeedbackAction) => get<{ items: FeedbackItem[] }>(`/match/feedback${qs({ action })}`),
    /** 对我选了「感兴趣」、我还没有回应的同学 */
    incoming: () => get<{ items: IncomingInterest[] }>('/match/incoming'),
  },

  // ---------- 私聊 ----------
  chat: {
    list: () => get<{ items: ChatSummary[] }>('/chat'),
    /** after：只取比该 id 新的消息（轮询）；before：取更早的消息（向上翻页） */
    messages: (matchId: number, p: { after?: number; before?: number } = {}) =>
      get<{ summary: ChatSummary; messages: ChatMessage[]; hasMore: boolean }>(`/chat/${matchId}${qs(p)}`),
    /** confirm：命中需要提醒的敏感词时，发送人确认后再发一次 */
    send: (matchId: number, body: string, confirm = false) => post<{ message: ChatMessage }>(`/chat/${matchId}/messages`, { body, ...(confirm ? { confirm } : {}) }),
    read: (matchId: number, lastId: number) => post<{ ok: true }>(`/chat/${matchId}/read`, { lastId }),
    close: (matchId: number) => post<{ ok: true }>(`/chat/${matchId}/close`),
  },

  // ---------- 社区：聊天区 ----------
  forum: {
    posts: (p: { q?: string; mine?: boolean; share?: boolean; before?: number } = {}) => get<{ items: ForumPost[]; hasMore: boolean }>(`/forum/posts${qs(p)}`),
    post: (id: number) => get<{ post: ForumPost }>(`/forum/posts/${id}`),
    create: (b: { title: string; body: string; images: string[]; bonus?: boolean }) => post<{ post: ForumPost }>('/forum/posts', b),
    update: (id: number, b: { title: string; body: string; images: string[] }) => put<{ post: ForumPost }>(`/forum/posts/${id}`, b),
    remove: (id: number) => del<{ ok: true }>(`/forum/posts/${id}`),
    search: (query: PostSearchQuery) => post<{ items: ForumPost[]; total: number }>('/forum/search', query),
    like: (type: ForumTargetType, id: number) => post<{ liked: boolean; likeCount: number }>(`/forum/${type}/${id}/like`),
    comments: (type: ForumTargetType, id: number) => get<{ items: ForumComment[] }>(`/forum/${type}/${id}/comments`),
    comment: (type: ForumTargetType, id: number, body: string) => post<{ comment: ForumComment }>(`/forum/${type}/${id}/comments`, { body }),
    deleteComment: (id: number) => del<{ ok: true }>(`/forum/comments/${id}`),
  },

  // ---------- 社区：学习打卡 ----------
  checkins: {
    /** 打开摄像头后领取的一次性拍照凭证 */
    session: () => post<CheckinSession>('/checkins/session'),
    create: (b: { token: string; image: string; caption: string; visibility: CheckinVisibility; location: { lat: number; lng: number; accuracy: number } }) =>
      post<{ checkin: Checkin; stats: CheckinStats }>('/checkins', b),
    list: (p: { scope?: 'all' | 'buddies' | 'partner' | 'mine'; before?: number } = {}) => get<{ items: Checkin[]; hasMore: boolean }>(`/checkins${qs(p)}`),
    get: (id: number) => get<{ checkin: Checkin }>(`/checkins/${id}`),
    stats: () => get<CheckinStats>('/checkins/stats'),
    remove: (id: number) => del<{ ok: true }>(`/checkins/${id}`),
  },

  posts: (p: { q?: string; category?: string; scope?: string } = {}) =>
    get<{ items: Post[] }>(
      `/posts?q=${encodeURIComponent(p.q ?? '')}&category=${p.category ?? ''}&scope=${p.scope ?? ''}`,
    ),
  post: (id: number) => get<{ post: Post }>(`/posts/${id}`),
  createPost: (b: PostInput) => post<{ post: Post }>('/posts', b),
  updatePost: (id: number, b: PostInput) => put<{ post: Post }>(`/posts/${id}`, b),
  deletePost: (id: number) => del<{ ok: true }>(`/posts/${id}`),
  setPostStatus: (id: number, status: 'open' | 'closed') => post<{ status: string }>(`/posts/${id}/status`, { status }),
  interest: (id: number) => post<{ interested: boolean; interestCount: number }>(`/posts/${id}/interest`),

  // ---------- 搭子打卡活动 ----------
  activity: {
    config: () => get<{ config: ActivityConfig; season: SeasonInfo }>('/activity/config'),
    me: () => get<BuddyStatus>('/activity/me'),
    setCollege: (shurenMember: ShurenMember) => put<BuddyStatus>('/activity/college', { shurenMember }),
    invite: (userId: number, shurenMember?: ShurenMember) => post<BuddyStatus>('/activity/invites', { userId, shurenMember }),
    accept: (inviteId: number, shurenMember?: ShurenMember) => post<BuddyStatus & { matchId: number }>(`/activity/invites/${inviteId}/accept`, { shurenMember }),
    decline: (inviteId: number) => post<BuddyStatus>(`/activity/invites/${inviteId}/decline`),
    cancel: (inviteId: number) => del<BuddyStatus>(`/activity/invites/${inviteId}`),
    unbind: () => post<BuddyStatus>('/activity/unbind'),
    /** 是否在主页上公开「我们是搭子」（两人都打开才显示） */
    showOnProfile: (show: boolean) => put<BuddyStatus>('/activity/pair/profile', { show }),
    leaderboard: () => get<LeaderboardResponse>('/activity/leaderboard'),
    appeal: (checkinId: number, body: string) => post<{ ok: true }>('/activity/appeals', { checkinId, body }),
  },

  notifications: () => get<{ items: NotificationItem[] }>('/notifications'),
  readAll: () => post<{ ok: true }>('/notifications/read-all'),
  report: (b: { targetType: ReportTargetType; targetId: number; reason: string; detail?: string }) => post<{ ok: true }>('/reports', b),

  admin: {
    overview: () => get<AdminOverview>('/admin/overview'),
    profiles: (filter: string, q = '') => get<{ items: AdminProfile[] }>(`/admin/profiles?filter=${filter}&q=${encodeURIComponent(q)}`),
    posts: (filter: string, q = '') => get<{ items: AdminPost[] }>(`/admin/posts?filter=${filter}&q=${encodeURIComponent(q)}`),
    /** 社区内容（聊天区帖子、评论、打卡）的审核列表 */
    content: (type: AdminContentType, filter: string, q = '') =>
      get<{ items: AdminContent[] }>(`/admin/content${qs({ type, filter, q })}`),
    takedown: (type: ModerationTargetType, id: number, reason: string) =>
      post<{ ok: true; emailStatus: string; time: string }>('/admin/takedown', { type, id, reason }),
    restore: (type: ModerationTargetType, id: number) => post<{ ok: true }>('/admin/restore', { type, id }),
    approve: (type: ModerationTargetType, ids: number[]) => post<{ ok: true; count: number }>('/admin/approve', { type, ids }),
    reports: (status = 'open') => get<{ items: AdminReport[] }>(`/admin/reports?status=${status}`),
    dismissReport: (id: number) => post<{ ok: true }>(`/admin/reports/${id}/resolve`),
    /** 线下处理后标记举报为已处理（例如私聊消息，无法撤下） */
    resolveReport: (id: number) => post<{ ok: true }>(`/admin/reports/${id}/resolve`, { status: 'resolved' }),
    logs: () => get<{ items: AdminLog[] }>('/admin/logs'),
    users: (q = '') => get<{ items: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`),
    settings: (cycleDays: number) => put<{ review: ReviewState }>('/admin/settings', { cycleDays }),
    reviewRound: () => post<{ review: ReviewState }>('/admin/review-round'),
    // 搭子打卡活动
    audits: (status: 'pending' | 'done' = 'pending') => get<{ items: AdminAudit[]; reasons: string[] }>(`/admin/audits${qs({ status })}`),
    passAudit: (checkinId: number) => post<{ ok: true }>(`/admin/audits/${checkinId}/pass`),
    invalidate: (checkinId: number, reason: string, note = '') => post<{ ok: true; emailStatus: string }>(`/admin/checkins/${checkinId}/invalidate`, { reason, note }),
    appeals: (status: 'open' | 'all' = 'open') => get<{ items: AdminAppeal[] }>(`/admin/appeals${qs({ status })}`),
    decideAppeal: (id: number, decision: 'upheld' | 'overturned', note: string) => post<{ ok: true }>(`/admin/appeals/${id}`, { decision, note }),
    bonus: (status: 'pending' | 'all' = 'pending') => get<{ items: AdminBonus[] }>(`/admin/bonus${qs({ status })}`),
    decideBonus: (id: number, decision: 'approve' | 'reject', reason = '') => post<{ status: string; points: number }>(`/admin/bonus/${id}`, { decision, reason }),
    board: () => get<{ items: AdminBoardItem[]; through: string | null; season: SeasonInfo; prizePairs: number }>('/admin/board'),
    prizeReview: () => post<{ pairs: number; added: number }>('/admin/board/prize-review'),
    disqualify: (pairId: number, reason: string) => post<{ ok: true }>(`/admin/pairs/${pairId}/disqualify`, { reason }),
    requalify: (pairId: number) => del<{ ok: true }>(`/admin/pairs/${pairId}/disqualify`),
    chatWords: () => get<{ words: Record<SensitiveCategory, string[]> }>('/admin/chat-words'),
    saveChatWords: (words: Record<SensitiveCategory, string[]>) => put<{ words: Record<SensitiveCategory, string[]> }>('/admin/chat-words', { words }),
    testChatWords: (text: string) => post<{ blocked: SensitiveCategory[]; warned: SensitiveCategory[] }>('/admin/chat-words/test', { text }),
    activityConfig: () => get<{ config: ActivityConfig; season: SeasonInfo }>('/admin/activity-config'),
    saveActivityConfig: (config: ActivityConfig) => put<{ config: ActivityConfig; season: SeasonInfo }>('/admin/activity-config', { config }),
    staff: () => get<{ items: AdminStaff[] }>('/admin/staff'),
    collegeRoster: () => get<{ count: number; updatedAt: string | null }>('/admin/college-roster'),
    saveCollegeRoster: (text: string) => put<{ count: number; updatedAt: string | null }>('/admin/college-roster', { text }),
    setRole: (email: string, role: Role) => post<{ ok: true; role: Role }>('/admin/staff', { email, role }),
  },
};

export interface PostInput {
  title: string;
  category: string;
  description: string;
  timeText: string;
  location: string;
  capacity: number;
  tags: string[];
}

export interface ReviewState {
  cycleDays: number;
  lastReviewAt: string | null;
  nextReviewAt: string | null;
  overdue: boolean;
}
export type AdminContentType = 'forum_post' | 'comment' | 'checkin';
export interface AdminOverview {
  stats: {
    users: number; published: number; posts: number; forumPosts: number; checkinsToday: number;
    pendingProfiles: number; pendingPosts: number; pendingCommunity: number; openReports: number; takedowns30d: number;
    buddyPairs: number; pendingAudits: number; openAppeals: number; pendingBonus: number;
  };
  /** 各类社区内容的待审核数 */
  pendingContent: Record<AdminContentType, number>;
  review: ReviewState;
}
export interface AdminProfile extends ContentReviewState {
  id: number; nickname: string; email: string; realName: string; studentId: string; major: string; bio: string; studyPlan: string;
  cover: string | null; photos: string[]; publishedAt: string | null; reviewedAt: string | null; savedAt: string | null;
  takenDown: boolean; takenDownAt: string | null; takedownReason: string | null; reports: number;
}
export interface AdminPost extends ContentReviewState {
  id: number; title: string; category: string; description: string; timeText: string; location: string; authorId: number;
  nickname: string; email: string; status: string; createdAt: string; reviewedAt: string | null; takenDown: boolean;
  takenDownAt: string | null; takedownReason: string | null; reports: number;
}
export interface AdminContent extends ContentReviewState {
  type: AdminContentType; id: number; authorId: number; nickname: string; email: string;
  /** 帖子标题；评论为「评论 · 所属内容」；打卡为「地点 · 盖章时间」 */
  title: string; body: string; image: string | null; images: string[]; link: string | null; createdAt: string; reviewedAt: string | null;
  takenDown: boolean; takenDownAt: string | null; takedownReason: string | null; reports: number;
}
export interface AdminReport {
  id: number; targetType: ReportTargetType; targetId: number; targetLabel: string; reason: string;
  /** 举报详情原文（含举报时留存的内容快照） */
  detail: string;
  /** 举报人填写的补充说明 */
  note: string;
  /** 举报时留存的内容原文（帖子、评论、私聊消息等） */
  snapshot: string | null;
  /** 站内查看链接；私聊消息为 null */
  link: string | null;
  /** 被举报内容的发布者 */
  owner: { id: number; nickname: string; email: string } | null;
  targetState: 'visible' | 'down' | 'deleted';
  status: string; reporter: string; createdAt: string;
}
export interface AdminLog {
  id: number; action: string; targetType: string; targetId: number; targetLabel: string; reason: string; emailStatus: string;
  admin: string; createdAt: string;
}
export interface AdminUser {
  id: number; email: string; role: string; nickname: string; realName: string; studentId: string; major: string; published: boolean;
  createdAt: string; lastLoginAt: string | null;
}

export interface AdminCheckinView {
  id: number; image: string; caption: string; placeLabel: string; stampText: string; stampedAt: string | null;
  /** 定位误差（米）；没有定位的旧打卡为 null */
  accuracy: number | null;
  deleted: boolean; takenDown: boolean; invalid: boolean; invalidReason: string | null; invalidAt: string | null; invalidBy: string;
}
interface AdminPartnerContext {
  partner: { id: number; nickname: string } | null;
  partnerCheckin: AdminCheckinView | null;
  /** 和搭子那次打卡相距多少米；有一方没有定位时为 null */
  distance: number | null;
}
export interface AdminAudit extends AdminPartnerContext {
  checkinId: number; week: string; source: 'random' | 'flag' | 'prize' | 'manual'; sourceLabel: string; flags: string[];
  status: 'pending' | 'valid' | 'invalid'; reviewer: string; reviewedAt: string | null;
  checkin: AdminCheckinView; author: { id: number; nickname: string };
}
export interface AdminAppeal extends AdminPartnerContext {
  id: number; status: 'open' | 'upheld' | 'overturned'; body: string; createdAt: string; decidedBy: string; decidedAt: string | null;
  decisionNote: string | null; author: { id: number; nickname: string }; checkin: AdminCheckinView; canDecide: boolean;
}
export interface AdminBonus {
  id: number; status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; points: number; reason: string | null; week: string; createdAt: string;
  reviewer: string; reviewedAt: string | null;
  post: { id: number; title: string; body: string; images: string[]; deleted: boolean; takenDown: boolean } | null;
  author: { id: number; nickname: string }; partner: { id: number; nickname: string }; pairActive: boolean; approvedPoints: number; seasonMax: number;
}
export interface AdminBoardItem {
  pairId: number; rank: number | null; tied: boolean; total: number; checkinPoints: number; bonusPoints: number; fullWeeks: number; events: number;
  reachedWeek: string | null; weeks: { week: string; count: number; counted: number; points: number }[];
  members: { id: number; nickname: string; realName: string; studentId: string; shuren: ShurenMember | null }[];
  startsOn: string; createdAt: string; ineligible: string | null; strikes: number; disqualified: boolean;
}
export interface AdminStaff {
  id: number; email: string; role: Role; nickname: string; lastLoginAt: string | null; actions7d: number;
}
