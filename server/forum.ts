// 社区聊天区：帖子与评论的可见性、作者信息与序列化，并向公共路由（文件访问、举报、评论/点赞）登记。
// 接口在 server/routes/forum.ts；数据表在 server/community.ts。
import { hasPrivacyConsent } from '../shared/profileRules.ts';
import type { ForumAuthor, ForumComment, ForumPost, ForumTargetType, MatchInfo, ProfileInput } from '../shared/types.ts';
import './community.ts';
import { isExcluded } from './connections.ts';
import { iso, q } from './db.ts';
import { getProfileRow, parseData } from './profiles.ts';
import { contentTargetFor, registerContentTarget, registerFileAccess, registerReportTarget } from './social.ts';
import { reviewState } from './autoModeration.ts';

export const FORUM_LIMITS = {
  title: 60,
  body: 2000,
  images: 4,
  comment: 500,
  postsPerDay: 20,
  commentsPerDay: 60,
  pageSize: 20,
} as const;

export interface ForumPostRow {
  auto_held?: number;
  risk_reasons?: string | null;
  id: number;
  user_id: number;
  title: string;
  body: string;
  images: string;
  created_at: string;
  updated_at: string;
  deleted: number;
  taken_down: number;
  taken_down_at: string | null;
  takedown_reason: string | null;
  reviewed_at: string | null;
}

export interface ForumCommentRow {
  auto_held?: number;
  risk_reasons?: string | null;
  id: number;
  target_type: ForumTargetType;
  target_id: number;
  user_id: number;
  body: string;
  created_at: string;
  deleted: number;
  taken_down: number;
  taken_down_at: string | null;
  takedown_reason: string | null;
  reviewed_at: string | null;
}

export interface Viewer {
  id: number;
  role: 'user' | 'admin';
}

/** SQL 片段：`col` 列的用户与当前用户（参数两次）没有互相排除 */
export const notExcludedSql = (col: string) =>
  `NOT EXISTS (SELECT 1 FROM exclusions e WHERE (e.user_id = ? AND e.target_id = ${col}) OR (e.user_id = ${col} AND e.target_id = ?))`;

export const excerpt = (text: string, n = 24) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};

export const parseImages = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

// ---------- 作者信息 ----------

export interface AuthorInfo {
  author: ForumAuthor;
  /** 作者主页对当前用户可见时的资料（用于高级检索的作者条件）；不可见为 null */
  profile: ProfileInput | null;
}

function resolveAuthor(authorId: number, viewerId: number): AuthorInfo {
  const row = getProfileRow(authorId);
  if (!row) return { author: { id: authorId, nickname: '匿名同学', cover: null, profileVisible: false }, profile: null };
  const d = parseData(row);
  const visible = !!row.published && !row.taken_down && hasPrivacyConsent(d) && (authorId === viewerId || !isExcluded(viewerId, authorId));
  return {
    // 只返回系统昵称；封面仅在主页可见且照片公开时返回
    author: { id: authorId, nickname: row.nickname, cover: visible && d.photoVisibility === 'public' ? d.photos[0] ?? null : null, profileVisible: visible },
    profile: visible ? d : null,
  };
}

/** 同一次请求内缓存作者信息，避免列表里重复解析资料 */
export function authorResolver(viewerId: number) {
  const cache = new Map<number, AuthorInfo>();
  return (authorId: number): AuthorInfo => {
    let info = cache.get(authorId);
    if (!info) {
      info = resolveAuthor(authorId, viewerId);
      cache.set(authorId, info);
    }
    return info;
  };
}

export const forumAuthor = (authorId: number, viewerId: number): ForumAuthor => resolveAuthor(authorId, viewerId).author;

// ---------- 点赞数、评论数 ----------

export interface Engagement {
  likeCount: number;
  liked: boolean;
  commentCount: number;
}

/** 批量统计点赞与评论（评论数不含已删除、被撤下及与我互相排除者的评论） */
export function engagementFor(type: ForumTargetType, ids: number[], viewerId: number): Map<number, Engagement> {
  const out = new Map<number, Engagement>(ids.map((id) => [id, { likeCount: 0, liked: false, commentCount: 0 }]));
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id));
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    const marks = chunk.map(() => '?').join(',');
    for (const r of q.all<{ target_id: number; n: number; mine: number }>(
      `SELECT target_id, COUNT(*) n, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) mine FROM forum_likes
       WHERE target_type = ? AND target_id IN (${marks}) GROUP BY target_id`,
      viewerId, type, ...chunk,
    )) {
      const e = out.get(r.target_id)!;
      e.likeCount = r.n;
      e.liked = r.mine > 0;
    }
    for (const r of q.all<{ target_id: number; n: number }>(
      `SELECT c.target_id, COUNT(*) n FROM forum_comments c
       WHERE c.target_type = ? AND c.target_id IN (${marks}) AND c.deleted = 0 AND c.taken_down = 0 AND ${notExcludedSql('c.user_id')}
       GROUP BY c.target_id`,
      type, ...chunk, viewerId, viewerId,
    )) out.get(r.target_id)!.commentCount = r.n;
  }
  return out;
}

// ---------- 帖子 ----------

export function getPostRow(id: number): ForumPostRow | undefined {
  if (!Number.isSafeInteger(id) || id <= 0) return undefined;
  return q.get<ForumPostRow>('SELECT * FROM forum_posts WHERE id = ?', id);
}

/** 对他人：未删除、未撤下、未互相排除。作者本人始终可见（被撤下时显示原因）；管理员可查看被撤下的帖子以便审核 */
export function postVisibleTo(row: ForumPostRow | undefined, viewer: Viewer): row is ForumPostRow {
  if (!row || row.deleted) return false;
  if (row.user_id === viewer.id) return true;
  if (row.taken_down) return viewer.role === 'admin';
  return viewer.role === 'admin' || !isExcluded(viewer.id, row.user_id);
}

/** 评论、点赞、举报使用的可见性：被撤下的帖子对所有人都返回 false（作者本人与管理员由调用方另行判断） */
export function canViewPost(viewerId: number, id: number): boolean {
  const row = getPostRow(id);
  if (!row || row.deleted || row.taken_down) return false;
  return row.user_id === viewerId || !isExcluded(viewerId, row.user_id);
}

export function toForumPosts(rows: ForumPostRow[], viewer: Viewer, resolve = authorResolver(viewer.id), matches?: Map<number, MatchInfo>): ForumPost[] {
  const eng = engagementFor('post', rows.map((r) => r.id), viewer.id);
  return rows.map((r) => {
    const e = eng.get(r.id)!;
    const canSeeModeration = r.user_id === viewer.id || viewer.role === 'admin';
    const post: ForumPost = {
      id: r.id,
      title: r.title,
      body: r.body,
      images: parseImages(r.images),
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
      author: resolve(r.user_id).author,
      likeCount: e.likeCount,
      liked: e.liked,
      commentCount: e.commentCount,
      isMine: r.user_id === viewer.id,
      ...reviewState(r, canSeeModeration),
      takenDown: canSeeModeration && !!r.taken_down && !r.auto_held,
      takedownReason: canSeeModeration && r.taken_down && !r.auto_held ? r.takedown_reason : null,
    };
    const m = matches?.get(r.id);
    if (m) post.match = m;
    return post;
  });
}

export const toForumPost = (row: ForumPostRow, viewer: Viewer) => toForumPosts([row], viewer)[0];

// ---------- 评论 ----------

export function getCommentRow(id: number): ForumCommentRow | undefined {
  if (!Number.isSafeInteger(id) || id <= 0) return undefined;
  return q.get<ForumCommentRow>('SELECT * FROM forum_comments WHERE id = ?', id);
}

export function toForumComment(r: ForumCommentRow, viewerId: number, resolve = authorResolver(viewerId)): ForumComment {
  return {
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    body: r.body,
    createdAt: iso(r.created_at)!,
    author: resolve(r.user_id).author,
    isMine: r.user_id === viewerId,
    ...reviewState(r, r.user_id === viewerId),
  };
}

/** 评论本身可见：未删除、未撤下、评论者与我未互相排除，且所属内容对我可见 */
function commentVisibleTo(r: ForumCommentRow | undefined, viewerId: number): r is ForumCommentRow {
  if (!r || r.deleted || r.taken_down) return false;
  if (r.user_id !== viewerId && isExcluded(viewerId, r.user_id)) return false;
  return contentTargetFor(r.target_type)?.canView(viewerId, r.target_id) ?? false;
}

// ---------- 登记 ----------

const postLabel = (id: number) => {
  const row = getPostRow(id);
  return row ? row.title || excerpt(row.body) : '（已删除）';
};

registerContentTarget('post', {
  canView: canViewPost,
  ownerOf: (id) => getPostRow(id)?.user_id ?? null,
  label: postLabel,
  link: (id) => `/community/posts/${id}`,
});

registerReportTarget('forum_post', {
  canReport: (reporterId, id) => canViewPost(reporterId, id),
  label: postLabel,
  ownerOf: (id) => getPostRow(id)?.user_id ?? null,
  // 作者之后可能修改或删除帖子，举报时留存原文与图片文件名（管理员可直接打开图片；举报处理前这些图片不会被清理）
  snapshot: (id) => {
    const row = getPostRow(id);
    if (!row) return '';
    const images = parseImages(row.images);
    return `${row.title ? `${row.title}\n` : ''}${row.body}${images.length ? `\n图片：${images.join('、')}` : ''}`;
  },
});

registerReportTarget('comment', {
  canReport: (reporterId, id) => commentVisibleTo(getCommentRow(id), reporterId),
  label: (id) => {
    const row = getCommentRow(id);
    return row ? excerpt(row.body) : '（已删除）';
  },
  ownerOf: (id) => getCommentRow(id)?.user_id ?? null,
  snapshot: (id) => getCommentRow(id)?.body ?? '',
});

// 社区图片：只有出现在对我可见的帖子里时才允许读取（本人与管理员在公共路由中已放行）
registerFileAccess('forum', (viewer, ownerId, name) => {
  if (viewer.id !== ownerId && isExcluded(viewer.id, ownerId)) return false;
  return !!q.get(
    'SELECT 1 FROM forum_posts WHERE user_id = ? AND deleted = 0 AND taken_down = 0 AND instr(images, ?) > 0 LIMIT 1',
    ownerId, JSON.stringify(name),
  );
});

export { commentVisibleTo };
