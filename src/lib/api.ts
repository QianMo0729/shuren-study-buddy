import type {
  AdvancedQuery, ContactRequest, ContactReveal, MyProfile, NotificationItem, Post, ProfileCard, ProfileInput, PublicProfile, RecommendationResponse, SessionUser,
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

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
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

const get = <T>(url: string) => request<T>('GET', url);
const post = <T>(url: string, body: unknown = {}) => request<T>('POST', url, body);
const put = <T>(url: string, body: unknown) => request<T>('PUT', url, body);
const del = <T>(url: string, body?: unknown) => request<T>('DELETE', url, body);

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
  saveProfile: (profile: ProfileInput) => put<{ profile: MyProfile; missing: Missing }>('/profiles/me', { profile }),
  publish: () => post<{ ok: true }>('/profiles/me/publish'),
  unpublish: () => post<{ ok: true }>('/profiles/me/unpublish'),

  square: (q = '', sort = 'latest') =>
    get<{ items: ProfileCard[]; total: number }>(`/profiles?q=${encodeURIComponent(q)}&sort=${sort}`),
  recommendations: () => get<RecommendationResponse>('/profiles/recommendations'),
  advancedSearch: (query: AdvancedQuery & { keyword?: string }) =>
    post<{ items: ProfileCard[]; total: number }>('/profiles/search', query),
  favorites: () => get<{ items: ProfileCard[] }>('/profiles/favorites'),
  profile: (id: number) => get<{ profile: PublicProfile }>(`/profiles/${id}`),
  contact: (id: number) => post<{ contacts: ContactReveal }>(`/profiles/${id}/contact`),
  favorite: (id: number) => post<{ isFavorite: boolean }>(`/profiles/${id}/favorite`),

  upload: (dataUrl: string, kind: 'photo' | 'timetable') => post<{ name: string }>('/uploads', { dataUrl, kind }),

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

  notifications: () => get<{ items: NotificationItem[] }>('/notifications'),
  readAll: () => post<{ ok: true }>('/notifications/read-all'),
  report: (b: { targetType: 'profile' | 'post'; targetId: number; reason: string; detail?: string }) => post<{ ok: true }>('/reports', b),

  admin: {
    overview: () => get<AdminOverview>('/admin/overview'),
    profiles: (filter: string, q = '') => get<{ items: AdminProfile[] }>(`/admin/profiles?filter=${filter}&q=${encodeURIComponent(q)}`),
    posts: (filter: string, q = '') => get<{ items: AdminPost[] }>(`/admin/posts?filter=${filter}&q=${encodeURIComponent(q)}`),
    takedown: (type: 'profile' | 'post', id: number, reason: string) =>
      post<{ ok: true; emailStatus: string; time: string }>('/admin/takedown', { type, id, reason }),
    restore: (type: 'profile' | 'post', id: number) => post<{ ok: true }>('/admin/restore', { type, id }),
    approve: (type: 'profile' | 'post', ids: number[]) => post<{ ok: true }>('/admin/approve', { type, ids }),
    reports: (status = 'open') => get<{ items: AdminReport[] }>(`/admin/reports?status=${status}`),
    dismissReport: (id: number) => post<{ ok: true }>(`/admin/reports/${id}/resolve`),
    logs: () => get<{ items: AdminLog[] }>('/admin/logs'),
    users: (q = '') => get<{ items: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`),
    settings: (cycleDays: number) => put<{ review: ReviewState }>('/admin/settings', { cycleDays }),
    reviewRound: () => post<{ review: ReviewState }>('/admin/review-round'),
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
export interface AdminOverview {
  stats: {
    users: number; published: number; posts: number; pendingProfiles: number; pendingPosts: number; openReports: number; takedowns30d: number;
  };
  review: ReviewState;
}
export interface AdminProfile {
  id: number; nickname: string; email: string; realName: string; studentId: string; major: string; bio: string; studyPlan: string;
  cover: string | null; photos: string[]; publishedAt: string | null; reviewedAt: string | null; savedAt: string | null;
  takenDown: boolean; takenDownAt: string | null; takedownReason: string | null; reports: number;
}
export interface AdminPost {
  id: number; title: string; category: string; description: string; timeText: string; location: string; authorId: number;
  nickname: string; email: string; status: string; createdAt: string; reviewedAt: string | null; takenDown: boolean;
  takenDownAt: string | null; takedownReason: string | null; reports: number;
}
export interface AdminReport {
  id: number; targetType: 'profile' | 'post'; targetId: number; targetLabel: string; reason: string; detail: string; status: string;
  reporter: string; createdAt: string;
}
export interface AdminLog {
  id: number; action: string; targetType: string; targetId: number; targetLabel: string; reason: string; emailStatus: string;
  admin: string; createdAt: string;
}
export interface AdminUser {
  id: number; email: string; role: string; nickname: string; realName: string; studentId: string; major: string; published: boolean;
  createdAt: string; lastLoginAt: string | null;
}
