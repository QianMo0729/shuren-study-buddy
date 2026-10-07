import { Router } from 'express';
import { POST_CATEGORIES, optionLabel } from '../../shared/options.ts';
import type { Post } from '../../shared/types.ts';
import { HttpError, requireUser } from '../auth.ts';
import { isExcluded } from '../connections.ts';
import { hasPrivacyConsent } from '../../shared/profileRules.ts';
import { iso, q, tx } from '../db.ts';
import { applyAutoModeration, reviewState } from '../autoModeration.ts';
import { notify } from '../notify.ts';
import { getProfileRow, parseData } from '../profiles.ts';
import { expand, tokenize } from '../search.ts';
import { registerReportTarget } from '../social.ts';

export const postRouter = Router();
postRouter.use(requireUser);

interface PostRow {
  auto_held?: number;
  risk_reasons?: string | null;
  id: number;
  user_id: number;
  title: string;
  category: string;
  description: string;
  time_text: string;
  location: string;
  capacity: number;
  tags: string;
  status: string;
  created_at: string;
  updated_at: string;
  taken_down: number;
  takedown_reason: string | null;
  deleted: number;
}

function author(userId: number) {
  const row = getProfileRow(userId);
  const d = row ? parseData(row) : null;
  // 与主页接口同一条件：主页撤回、被撤下或撤回隐私同意之后，招募里只剩系统昵称，不再带出资料里的任何内容
  const visible = !!row && !!d && !!row.published && !row.taken_down && hasPrivacyConsent(d);
  return {
    id: userId,
    nickname: row?.nickname ?? '匿名同学',
    major: visible ? d.major : '',
    studyType: visible ? d.studyType : '',
    cover: visible && d.photoVisibility === 'public' ? d.photos[0] ?? null : null,
    published: visible,
  };
}

export function toPost(r: PostRow, viewerId: number, withUsers = false): Post {
  const interestCount = q.get<{ n: number }>('SELECT COUNT(*) n FROM post_interests WHERE post_id = ?', r.id)!.n;
  const interested = !!q.get('SELECT 1 FROM post_interests WHERE post_id = ? AND user_id = ?', r.id, viewerId);
  const post: Post = {
    id: r.id,
    title: r.title,
    category: r.category,
    description: r.description,
    timeText: r.time_text,
    location: r.location,
    capacity: r.capacity,
    tags: JSON.parse(r.tags || '[]'),
    status: r.status === 'closed' ? 'closed' : 'open',
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    interestCount,
    interested,
    isMine: r.user_id === viewerId,
    author: author(r.user_id),
    ...reviewState(r),
    takenDown: !!r.taken_down && !r.auto_held,
    takedownReason: r.auto_held ? null : r.takedown_reason,
  };
  if (withUsers) {
    post.interestedUsers = q
      .all<{ user_id: number }>('SELECT user_id FROM post_interests WHERE post_id = ? ORDER BY created_at DESC LIMIT 40', r.id)
      .map((x) => author(x.user_id))
      .filter((a) => a.published && !isExcluded(viewerId, a.id))
      .map((a) => ({ id: a.id, nickname: a.nickname, cover: a.cover }));
  }
  return post;
}

function sanitize(body: any) {
  const title = String(body?.title ?? '').trim().slice(0, 30);
  const category = POST_CATEGORIES.some((c) => c.value === body?.category) ? String(body.category) : '';
  const description = String(body?.description ?? '').trim().slice(0, 500);
  const timeText = String(body?.timeText ?? '').trim().slice(0, 40);
  const location = String(body?.location ?? '').trim().slice(0, 30);
  const capacity = Math.max(0, Math.min(50, Math.floor(Number(body?.capacity) || 0)));
  const tags = [...new Set((Array.isArray(body?.tags) ? body.tags : []).map((t: unknown) => String(t).trim().slice(0, 10)).filter(Boolean))].slice(0, 6);
  if (title.length < 2) throw new HttpError(400, '请填写招募标题（至少 2 个字）');
  if (!category) throw new HttpError(400, '请选择活动分类');
  if (!timeText) throw new HttpError(400, '请填写活动时间');
  if (!location) throw new HttpError(400, '请填写活动地点');
  if (description.length < 10) throw new HttpError(400, '请简单描述一下活动内容（至少 10 个字）');
  return { title, category, description, timeText, location, capacity, tags };
}

function ownPost(id: number, userId: number) {
  const row = q.get<PostRow>('SELECT * FROM posts WHERE id = ? AND deleted = 0', id);
  if (!row) throw new HttpError(404, '帖子不存在');
  if (row.user_id !== userId) throw new HttpError(403, '只能修改自己发布的招募');
  return row;
}

// 举报招募：只能举报此刻自己看得到的招募（已删除、被撤下、作者与自己互相排除的都按不存在处理）
const reportablePost = (id: number) => q.get<PostRow>('SELECT * FROM posts WHERE id = ?', id);
registerReportTarget('post', {
  canReport: (reporterId, id) => {
    const row = reportablePost(id);
    return !!row && !row.deleted && !row.taken_down && row.user_id !== reporterId && !isExcluded(reporterId, row.user_id);
  },
  label: (id) => reportablePost(id)?.title ?? '（已删除）',
  ownerOf: (id) => reportablePost(id)?.user_id ?? null,
  // 作者之后可以修改或删除招募，举报时留存全文
  snapshot: (id) => {
    const row = reportablePost(id);
    if (!row) return '';
    const tags: string[] = JSON.parse(row.tags || '[]');
    return [
      `标题：${row.title}`, `分类：${optionLabel(POST_CATEGORIES, row.category)}`, `时间：${row.time_text}`, `地点：${row.location}`,
      row.capacity ? `人数：${row.capacity}` : '', tags.length ? `标签：${tags.join('、')}` : '', `说明：${row.description}`,
    ].filter(Boolean).join('\n');
  },
});

postRouter.get('/', (req, res) => {
  const uid = req.user!.id;
  const tokens = tokenize(String(req.query.q ?? ''));
  const category = String(req.query.category ?? '');
  const scope = String(req.query.scope ?? '');
  let rows = q.all<PostRow>('SELECT * FROM posts WHERE deleted = 0 ORDER BY created_at DESC LIMIT 500');
  rows = rows.filter((r) => !isExcluded(uid, r.user_id));
  rows = rows.filter((r) => (scope === 'mine' ? r.user_id === uid : !r.taken_down));
  if (scope === 'interested') {
    const ids = new Set(q.all<{ post_id: number }>('SELECT post_id FROM post_interests WHERE user_id = ?', uid).map((x) => x.post_id));
    rows = rows.filter((r) => ids.has(r.id));
  }
  if (category) rows = rows.filter((r) => r.category === category);
  let scored = rows.map((r) => ({ r, s: 0 }));
  if (tokens.length) {
    scored = scored
      .map(({ r }) => {
        const text = `${r.title} ${r.description} ${r.tags} ${r.location} ${r.time_text} ${optionLabel(POST_CATEGORIES, r.category)}`.toLowerCase();
        const titleLower = r.title.toLowerCase();
        let s = 0;
        for (const t of tokens) {
          const words = expand(t);
          if (words.some((w) => titleLower.includes(w))) s += 3;
          else if (words.some((w) => text.includes(w))) s += 1;
        }
        return { r, s };
      })
      .filter((x) => x.s > 0);
  }
  scored.sort((a, b) => {
    if (a.r.status !== b.r.status) return a.r.status === 'open' ? -1 : 1;
    if (a.s !== b.s) return b.s - a.s;
    return b.r.created_at.localeCompare(a.r.created_at);
  });
  res.json({ items: scored.map((x) => toPost(x.r, uid)) });
});

postRouter.post('/', (req, res) => {
  const uid = req.user!.id;
  const profile = getProfileRow(uid);
  if (!profile?.published || profile.taken_down) {
    throw new HttpError(400, '发起招募前，请先把个人主页上传到搭子广场，这样感兴趣的同学才能找到你');
  }
  const p = sanitize(req.body);
  const recent = q.get<{ n: number }>("SELECT COUNT(*) n FROM posts WHERE user_id = ? AND created_at > datetime('now', '-1 day')", uid)!.n;
  if (recent >= 5) throw new HttpError(429, '今天发布的招募有点多啦，明天再来吧');
  const id = tx(() => {
    const id = Number(q.run(
      'INSERT INTO posts (user_id, title, category, description, time_text, location, capacity, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      uid, p.title, p.category, p.description, p.timeText, p.location, p.capacity, JSON.stringify(p.tags),
    ).lastInsertRowid);
    applyAutoModeration('posts', id, [p.title, p.description, p.timeText, p.location, ...p.tags].join('\n'));
    return id;
  });
  res.json({ post: toPost(q.get<PostRow>('SELECT * FROM posts WHERE id = ?', id)!, uid) });
});

postRouter.get('/:id', (req, res) => {
  const uid = req.user!.id;
  const row = q.get<PostRow>('SELECT * FROM posts WHERE id = ? AND deleted = 0', Number(req.params.id));
  if (!row || (req.user!.role !== 'admin' && isExcluded(uid, row.user_id)) || (row.taken_down && row.user_id !== uid && req.user!.role !== 'admin')) throw new HttpError(404, '帖子不存在或已下线');
  res.json({ post: toPost(row, uid, true) });
});

postRouter.put('/:id', (req, res) => {
  const uid = req.user!.id;
  const row = ownPost(Number(req.params.id), uid);
  const p = sanitize(req.body);
  tx(() => {
    q.run(
    `UPDATE posts SET title = ?, category = ?, description = ?, time_text = ?, location = ?, capacity = ?, tags = ?,
       updated_at = datetime('now') WHERE id = ?`,
    p.title, p.category, p.description, p.timeText, p.location, p.capacity, JSON.stringify(p.tags), row.id,
    );
    applyAutoModeration('posts', row.id, [p.title, p.description, p.timeText, p.location, ...p.tags].join('\n'));
  });
  res.json({ post: toPost(q.get<PostRow>('SELECT * FROM posts WHERE id = ?', row.id)!, uid, true) });
});

postRouter.post('/:id/status', (req, res) => {
  const row = ownPost(Number(req.params.id), req.user!.id);
  const status = req.body?.status === 'closed' ? 'closed' : 'open';
  q.run("UPDATE posts SET status = ?, updated_at = datetime('now') WHERE id = ?", status, row.id);
  res.json({ status });
});

postRouter.delete('/:id', (req, res) => {
  const row = ownPost(Number(req.params.id), req.user!.id);
  q.run('UPDATE posts SET deleted = 1 WHERE id = ?', row.id);
  res.json({ ok: true });
});

postRouter.post('/:id/interest', (req, res) => {
  const uid = req.user!.id;
  const row = q.get<PostRow>('SELECT * FROM posts WHERE id = ? AND deleted = 0 AND taken_down = 0', Number(req.params.id));
  if (!row) throw new HttpError(404, '帖子不存在或已下线');
  if (isExcluded(uid, row.user_id)) throw new HttpError(404, '帖子不存在或已下线');
  if (row.user_id === uid) throw new HttpError(400, '这是你自己发起的招募');
  const removed = q.run('DELETE FROM post_interests WHERE post_id = ? AND user_id = ?', row.id, uid).changes > 0;
  if (!removed) {
    if (row.status === 'closed') throw new HttpError(400, '该招募已结束');
    q.run('INSERT INTO post_interests (post_id, user_id) VALUES (?, ?)', row.id, uid);
    const me = getProfileRow(uid);
    notify(
      row.user_id,
      '有同学对你的招募感兴趣',
      `「${me?.nickname ?? '一位同学'}」对「${row.title}」感兴趣`,
      me?.published && !me.taken_down ? `/u/${uid}` : `/events/${row.id}`,
    );
  }
  const count = q.get<{ n: number }>('SELECT COUNT(*) n FROM post_interests WHERE post_id = ?', row.id)!.n;
  res.json({ interested: !removed, interestCount: count });
});
