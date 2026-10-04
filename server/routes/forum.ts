import { Router, type Request } from 'express';
import type { ForumTargetType, MatchInfo } from '../../shared/types.ts';
import { HttpError, rateLimit, requireUser } from '../auth.ts';
import { q } from '../db.ts';
import {
  FORUM_LIMITS, type ForumPostRow, type ForumCommentRow, type Viewer, authorResolver, excerpt, getCommentRow, getPostRow,
  notExcludedSql, postVisibleTo, toForumComment, toForumPost, toForumPosts,
} from '../forum.ts';
import { notify } from '../notify.ts';
import { ensureProfile } from '../profiles.ts';
import { POST_SEARCH_FIELDS, criterionHit, evaluateCriteria, expand, normalizeQuery, snippet, textHit, tokenize } from '../search.ts';
import { contentTargetFor } from '../social.ts';

// 社区聊天区：帖子、评论、点赞与检索。评论与点赞对帖子和打卡通用（通过 contentTargetFor 判断可见性）。
export const forumRouter = Router();
forumRouter.use(requireUser);

const viewerOf = (req: Request): Viewer => ({ id: req.user!.id, role: req.user!.role });

/** 检索时最多扫描的最近帖子数 */
const SCAN_LIMIT = 2000;
const SEARCH_RESULTS = 60;

// ---------- 输入清洗 ----------

// 去掉控制字符与可用于伪装文字方向的 Unicode 控制符，保留换行
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function cleanText(v: unknown, multiline: boolean) {
  let s = typeof v === 'string' ? v : '';
  s = s.replace(/\r\n?/g, '\n').replace(CONTROL, '');
  s = multiline ? s.replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim();
}

const FILE_NAME = /^[a-f0-9]{24}\.(jpg|png|webp)$/;

function sanitizePost(body: any, userId: number) {
  const title = cleanText(body?.title, false);
  const text = cleanText(body?.body, true);
  if (title.length > FORUM_LIMITS.title) throw new HttpError(400, `标题最多 ${FORUM_LIMITS.title} 字`);
  if (!text) throw new HttpError(400, '写点什么再发布吧');
  if (text.length > FORUM_LIMITS.body) throw new HttpError(400, `正文最多 ${FORUM_LIMITS.body} 字`);
  const raw = body?.images ?? [];
  if (!Array.isArray(raw)) throw new HttpError(400, '图片无效，请重新上传');
  const images = [...new Set(raw)];
  if (images.length > FORUM_LIMITS.images) throw new HttpError(400, `最多添加 ${FORUM_LIMITS.images} 张图片`);
  for (const name of images) {
    // 只能使用自己通过「社区图片」上传的文件，不能引用别人的照片或打卡照片
    const owner = typeof name === 'string' && FILE_NAME.test(name)
      ? q.get<{ user_id: number; kind: string }>('SELECT user_id, kind FROM uploads WHERE name = ?', name)
      : undefined;
    if (!owner || owner.user_id !== userId || owner.kind !== 'forum') throw new HttpError(400, '图片无效，请重新上传');
  }
  return { title, body: text, images: images as string[] };
}

function parseId(v: unknown) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function parseType(v: unknown): ForumTargetType {
  if (v !== 'post' && v !== 'checkin') throw new HttpError(404, '内容不存在或已删除');
  return v;
}

/** 对我可见的帖子（未删除；他人被撤下的不显示；排除互相排除的作者） */
const VISIBLE_POSTS = `SELECT p.* FROM forum_posts p
  WHERE p.deleted = 0 AND (p.taken_down = 0 OR p.user_id = ?) AND (p.user_id = ? OR ${notExcludedSql('p.user_id')})`;
const visibleParams = (uid: number) => [uid, uid, uid, uid];

// ---------- 帖子 ----------

interface Ranked {
  row: ForumPostRow;
  score: number;
  match: MatchInfo;
}

function keywordScore(row: Pick<ForumPostRow, 'title' | 'body'>, tokens: string[]): MatchInfo {
  const text = `${row.title}\n${row.body}`.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];
  let snip: string | undefined;
  for (const t of tokens) {
    const words = expand(t);
    if (words.some((w) => text.includes(w))) {
      matched.push(t);
      snip ??= snippet(row.body, words);
    } else missed.push(t);
  }
  return { score: matched.length, total: tokens.length, matched, missed, snippet: snip };
}

/** 命中数降序，再按时间（id）降序 */
const byScore = (a: { score: number; row: { id: number } }, b: { score: number; row: { id: number } }) =>
  b.score - a.score || b.row.id - a.row.id;

forumRouter.get('/posts', (req, res) => {
  const viewer = viewerOf(req);
  const uid = viewer.id;
  rateLimit(`forum-list:${uid}`, 240, 60_000);
  const mine = req.query.mine === '1' || req.query.mine === 'true';
  const before = parseId(req.query.before);
  const tokens = tokenize(String(req.query.q ?? '').slice(0, 100));
  const size = FORUM_LIMITS.pageSize;
  const mineSql = mine ? ' AND p.user_id = ?' : '';
  const mineParams = mine ? [uid] : [];

  if (!tokens.length) {
    const rows = q.all<ForumPostRow>(
      `${VISIBLE_POSTS}${mineSql}${before ? ' AND p.id < ?' : ''} ORDER BY p.id DESC LIMIT ?`,
      ...visibleParams(uid), ...mineParams, ...(before ? [before] : []), size + 1,
    );
    return res.json({ items: toForumPosts(rows.slice(0, size), viewer), hasMore: rows.length > size });
  }

  // 关键词：在标题与正文中检索（含同义词），按命中数、再按时间排序；before 为上一页最后一条的 id
  const ranked: Ranked[] = q
    .all<ForumPostRow>(`${VISIBLE_POSTS}${mineSql} ORDER BY p.id DESC LIMIT ${SCAN_LIMIT}`, ...visibleParams(uid), ...mineParams)
    .map((row) => {
      const match = keywordScore(row, tokens);
      return { row, score: match.score, match };
    })
    .filter((x) => x.score > 0)
    .sort(byScore);
  let rest = ranked;
  if (before) {
    // 游标必须是本次结果中、当前用户看得到的帖子：绝不读取被删除、被撤下或被排除的帖子内容来分页，
    // 否则可以用游标试探隐藏帖子里是否含有某个词
    const at = ranked.findIndex((x) => x.row.id === before);
    if (at < 0) return res.json({ items: [], hasMore: false });
    rest = ranked.slice(at + 1);
  }
  const page = rest.slice(0, size);
  res.json({
    items: toForumPosts(page.map((x) => x.row), viewer, undefined, new Map(page.map((x) => [x.row.id, x.match]))),
    hasMore: rest.length > size,
  });
});

forumRouter.post('/posts', (req, res) => {
  const uid = req.user!.id;
  rateLimit(`forum-post-try:${uid}`, 30, 60_000);
  const p = sanitizePost(req.body, uid);
  rateLimit(`forum-post:${uid}`, 6, 60_000);
  const recent = q.get<{ n: number }>("SELECT COUNT(*) n FROM forum_posts WHERE user_id = ? AND created_at > datetime('now', '-1 day')", uid)!.n;
  if (recent >= FORUM_LIMITS.postsPerDay) throw new HttpError(429, '今天发的帖子有点多啦，明天再来吧');
  ensureProfile(uid); // 作者以系统昵称展示
  const id = Number(
    q.run('INSERT INTO forum_posts (user_id, title, body, images) VALUES (?, ?, ?, ?)', uid, p.title, p.body, JSON.stringify(p.images)).lastInsertRowid,
  );
  res.json({ post: toForumPost(getPostRow(id)!, viewerOf(req)) });
});

forumRouter.get('/posts/:id', (req, res) => {
  const viewer = viewerOf(req);
  const row = getPostRow(parseId(req.params.id));
  if (!postVisibleTo(row, viewer)) throw new HttpError(404, '帖子不存在或已删除');
  res.json({ post: toForumPost(row, viewer) });
});

function ownPost(id: number, userId: number) {
  const row = getPostRow(id);
  if (!row || row.deleted) throw new HttpError(404, '帖子不存在或已删除');
  if (row.user_id !== userId) throw new HttpError(403, '只能修改自己发布的帖子');
  return row;
}

forumRouter.put('/posts/:id', (req, res) => {
  const uid = req.user!.id;
  rateLimit(`forum-edit:${uid}`, 30, 3600_000);
  const row = ownPost(parseId(req.params.id), uid);
  const p = sanitizePost(req.body, uid);
  // 修改后重新进入待审核
  q.run(
    "UPDATE forum_posts SET title = ?, body = ?, images = ?, updated_at = datetime('now'), reviewed_at = NULL WHERE id = ?",
    p.title, p.body, JSON.stringify(p.images), row.id,
  );
  res.json({ post: toForumPost(getPostRow(row.id)!, viewerOf(req)) });
});

forumRouter.delete('/posts/:id', (req, res) => {
  const row = ownPost(parseId(req.params.id), req.user!.id);
  q.run('UPDATE forum_posts SET deleted = 1 WHERE id = ?', row.id);
  res.json({ ok: true });
});

// ---------- 高级检索 ----------

forumRouter.post('/search', (req, res) => {
  const viewer = viewerOf(req);
  const uid = viewer.id;
  rateLimit(`forum-search:${uid}`, 60, 60_000);
  const query = normalizeQuery(req.body, POST_SEARCH_FIELDS);
  const tokens = tokenize(String(req.body?.keyword ?? '').slice(0, 100));
  if (!query.criteria.length && !tokens.length) throw new HttpError(400, '请至少设置一个检索条件');
  const resolve = authorResolver(uid);
  const ranked: (Ranked & { weight: number })[] = [];
  for (const row of q.all<ForumPostRow>(`${VISIBLE_POSTS} ORDER BY p.id DESC LIMIT ${SCAN_LIMIT}`, ...visibleParams(uid))) {
    // 作者主页对我不可见时，作者条件一律视为未命中（因此「排除」条件也不会排除这条帖子）
    const profile = resolve(row.user_id).profile;
    let snip: string | undefined;
    const match = evaluateCriteria(query, (c) => {
      if (c.field === 'postText') {
        const words = textHit(`${row.title}\n${row.body}`, c.values);
        if (words && c.mode !== 'not') snip ??= snippet(row.body, words);
        return !!words;
      }
      return profile ? criterionHit(c, profile, '', []) : false;
    });
    if (!match) continue;
    let weight = 0;
    if (tokens.length) {
      const k = keywordScore(row, tokens);
      if (!k.score) continue;
      weight = k.score;
      snip ??= k.snippet;
    }
    if (snip) match.snippet = snip;
    ranked.push({ row, score: match.score, match, weight });
  }
  ranked.sort((a, b) => b.score - a.score || b.weight - a.weight || b.row.id - a.row.id);
  const page = ranked.slice(0, SEARCH_RESULTS);
  res.json({
    items: toForumPosts(page.map((x) => x.row), viewer, resolve, new Map(page.map((x) => [x.row.id, x.match]))),
    total: ranked.length,
  });
});

// ---------- 评论 ----------

forumRouter.delete('/comments/:id', (req, res) => {
  const row = getCommentRow(parseId(req.params.id));
  if (!row || row.deleted) throw new HttpError(404, '评论不存在或已删除');
  if (row.user_id !== req.user!.id) throw new HttpError(403, '只能删除自己的评论');
  q.run('UPDATE forum_comments SET deleted = 1 WHERE id = ?', row.id);
  res.json({ ok: true });
});

/** 评论区与点赞都要求内容对我可见；作者本人与管理员可以查看被撤下内容的评论（只读） */
function target(req: Request, readOnly: boolean) {
  const type = parseType(req.params.type);
  const id = parseId(req.params.id);
  const t = contentTargetFor(type);
  const uid = req.user!.id;
  if (!t || !id) throw new HttpError(404, '内容不存在或已删除');
  const ok = t.canView(uid, id) || (readOnly && t.ownerOf(id) !== null && (t.ownerOf(id) === uid || req.user!.role === 'admin'));
  if (!ok) throw new HttpError(404, '内容不存在或已删除');
  return { type, id, t, uid };
}

forumRouter.get('/:type/:id/comments', (req, res) => {
  const { type, id, uid } = target(req, true);
  const rows = q
    .all<ForumCommentRow>(
      `SELECT c.* FROM forum_comments c
       WHERE c.target_type = ? AND c.target_id = ? AND c.deleted = 0 AND c.taken_down = 0 AND (c.user_id = ? OR ${notExcludedSql('c.user_id')})
       ORDER BY c.id DESC LIMIT 300`,
      type, id, uid, uid, uid,
    )
    .reverse();
  const resolve = authorResolver(uid);
  res.json({ items: rows.map((r) => toForumComment(r, uid, resolve)) });
});

forumRouter.post('/:type/:id/comments', (req, res) => {
  const { type, id, t, uid } = target(req, false);
  rateLimit(`forum-comment:${uid}`, 10, 60_000);
  const body = cleanText(req.body?.body, true);
  if (!body) throw new HttpError(400, '评论不能为空');
  if (body.length > FORUM_LIMITS.comment) throw new HttpError(400, `评论最多 ${FORUM_LIMITS.comment} 字`);
  const recent = q.get<{ n: number }>("SELECT COUNT(*) n FROM forum_comments WHERE user_id = ? AND created_at > datetime('now', '-1 day')", uid)!.n;
  if (recent >= FORUM_LIMITS.commentsPerDay) throw new HttpError(429, '今天的评论有点多啦，明天再来吧');
  const me = ensureProfile(uid);
  const commentId = Number(
    q.run('INSERT INTO forum_comments (target_type, target_id, user_id, body) VALUES (?, ?, ?, ?)', type, id, uid, body).lastInsertRowid,
  );
  const owner = t.ownerOf(id);
  if (owner !== null && owner !== uid) {
    notify(owner, `${me.nickname} 评论了你的${type === 'post' ? '帖子' : '打卡'}`, excerpt(body, 60), t.link(id));
  }
  res.json({ comment: toForumComment(getCommentRow(commentId)!, uid) });
});

// ---------- 点赞 ----------

forumRouter.post('/:type/:id/like', (req, res) => {
  const { type, id, uid } = target(req, false);
  rateLimit(`forum-like:${uid}`, 120, 60_000);
  const removed = q.run('DELETE FROM forum_likes WHERE target_type = ? AND target_id = ? AND user_id = ?', type, id, uid).changes > 0;
  if (!removed) q.run('INSERT OR IGNORE INTO forum_likes (target_type, target_id, user_id) VALUES (?, ?, ?)', type, id, uid);
  const likeCount = q.get<{ n: number }>('SELECT COUNT(*) n FROM forum_likes WHERE target_type = ? AND target_id = ?', type, id)!.n;
  res.json({ liked: !removed, likeCount });
});
