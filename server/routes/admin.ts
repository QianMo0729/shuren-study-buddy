import { Router } from 'express';
import type { ModerationTargetType, ReportTargetType } from '../../shared/types.ts';
import { HttpError, requireAdmin } from '../auth.ts';
import { getSetting, iso, q, setSetting, tx } from '../db.ts';
import { sendTakedownMail } from '../mail.ts';
import { beijingTime, notify } from '../notify.ts';
import { getProfileRow, parseData } from '../profiles.ts';
import { reportTargetFor } from '../social.ts';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const count = (sql: string, ...p: any[]) => q.get<{ n: number }>(sql, ...p)!.n;

// ---------- 可审核的内容类型 ----------

type CommunityType = 'forum_post' | 'comment' | 'checkin';

/** 每种可撤下内容对应的表与主键；表名只来自这里的常量，不拼接用户输入 */
const MODERATION: Record<ModerationTargetType, { table: string; key: string; what: string }> = {
  profile: { table: 'profiles', key: 'user_id', what: '个人主页' },
  post: { table: 'posts', key: 'id', what: '帖子' },
  forum_post: { table: 'forum_posts', key: 'id', what: '社区帖子' },
  comment: { table: 'forum_comments', key: 'id', what: '评论' },
  checkin: { table: 'checkins', key: 'id', what: '打卡' },
};
const COMMUNITY_TYPES: CommunityType[] = ['forum_post', 'comment', 'checkin'];
const REPORT_TYPES: ReportTargetType[] = ['profile', 'post', 'forum_post', 'comment', 'checkin', 'message'];

const isCommunity = (t: unknown): t is CommunityType => COMMUNITY_TYPES.includes(t as CommunityType);

function moderationType(v: unknown): ModerationTargetType {
  if (typeof v === 'string' && Object.hasOwn(MODERATION, v)) return v as ModerationTargetType;
  throw new HttpError(400, '不支持的内容类型');
}

function targetId(v: unknown): number {
  const id = Number(v);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, '参数不正确');
  return id;
}

/** 已注销账号的邮箱被替换为不可投递的占位地址 */
const isDeletedEmail = (email: string | null | undefined) => !email || email.endsWith('@deleted.invalid');

/** 按字符截取（不切断表情等代理对），合并空白 */
function excerpt(s: string, n = 30) {
  const chars = Array.from(String(s ?? '').replace(/\s+/g, ' ').trim());
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : chars.join('');
}

const FILE_RE = /^[a-f0-9]{24}\.(jpg|png|webp)$/;
function imagesOf(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && FILE_RE.test(x)) : [];
  } catch {
    return [];
  }
}

const contentLink = (type: string, id: number) =>
  type === 'post' ? `/community/posts/${id}` : type === 'checkin' ? `/community/checkins/${id}` : null;

/** 帖子 / 打卡 / 评论 的简短标签（不依赖其他模块的登记，供撤下通知与后台列表使用） */
function communityLabel(type: CommunityType, row: any): string {
  if (type === 'forum_post') return row.title || excerpt(row.body) || '（无标题）';
  if (type === 'comment') return excerpt(row.body) || '（空评论）';
  return row.caption ? excerpt(row.caption) : `${row.place_label} · ${row.stamp_text}`;
}

/** 评论所属内容的标题与链接 */
function commentParent(targetType: string, targetIdValue: number): { label: string; link: string | null } {
  if (targetType === 'post') {
    const p = q.get<any>('SELECT title, body, deleted FROM forum_posts WHERE id = ?', targetIdValue);
    return { label: p && !p.deleted ? `帖子「${communityLabel('forum_post', p)}」` : '帖子（已删除）', link: contentLink('post', targetIdValue) };
  }
  const c = q.get<any>('SELECT caption, place_label, stamp_text, deleted FROM checkins WHERE id = ?', targetIdValue);
  return { label: c && !c.deleted ? `打卡「${communityLabel('checkin', c)}」` : '打卡（已删除）', link: contentLink('checkin', targetIdValue) };
}

function communityRow(type: CommunityType, id: number) {
  return q.get<any>(`SELECT x.*, u.email FROM ${MODERATION[type].table} x JOIN users u ON u.id = x.user_id WHERE x.id = ?`, id);
}

/** 举报列表、撤下对象的跳转链接；私聊消息不提供跳转 */
function linkFor(type: ReportTargetType, id: number): string | null {
  if (type === 'profile') return `/u/${id}`;
  if (type === 'post') return `/events/${id}`;
  if (type === 'forum_post') return contentLink('post', id);
  if (type === 'checkin') return contentLink('checkin', id);
  if (type === 'comment') {
    const c = q.get<{ target_type: string; target_id: number }>('SELECT target_type, target_id FROM forum_comments WHERE id = ?', id);
    return c ? contentLink(c.target_type, c.target_id) : null;
  }
  return null;
}

// ---------- 概览 ----------

function reviewState() {
  const cycleDays = Number(getSetting('review_cycle_days', '7'));
  const last = getSetting('last_review_at', '');
  const next = last ? new Date(new Date(last).getTime() + cycleDays * 86400_000).toISOString() : null;
  return { cycleDays, lastReviewAt: last || null, nextReviewAt: next, overdue: !!next && new Date(next) < new Date() };
}

const pendingOf = (type: CommunityType) =>
  count(`SELECT COUNT(*) n FROM ${MODERATION[type].table} WHERE deleted = 0 AND taken_down = 0 AND reviewed_at IS NULL`);

const beijingDate = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

adminRouter.get('/overview', (_req, res) => {
  const pendingContent = { forum_post: pendingOf('forum_post'), comment: pendingOf('comment'), checkin: pendingOf('checkin') };
  res.json({
    stats: {
      users: count('SELECT COUNT(*) n FROM users WHERE activated = 1'),
      published: count('SELECT COUNT(*) n FROM profiles WHERE published = 1 AND taken_down = 0'),
      posts: count("SELECT COUNT(*) n FROM posts WHERE deleted = 0 AND taken_down = 0 AND status = 'open'"),
      forumPosts: count('SELECT COUNT(*) n FROM forum_posts WHERE deleted = 0 AND taken_down = 0'),
      checkinsToday: count('SELECT COUNT(*) n FROM checkins WHERE deleted = 0 AND local_date = ?', beijingDate()),
      pendingProfiles: count('SELECT COUNT(*) n FROM profiles WHERE published = 1 AND taken_down = 0 AND reviewed_at IS NULL'),
      pendingPosts: count('SELECT COUNT(*) n FROM posts WHERE deleted = 0 AND taken_down = 0 AND reviewed_at IS NULL'),
      pendingCommunity: pendingContent.forum_post + pendingContent.comment + pendingContent.checkin,
      // 含社区帖子、评论、打卡与私聊消息的举报
      openReports: count("SELECT COUNT(*) n FROM reports WHERE status = 'open'"),
      takedowns30d: count("SELECT COUNT(*) n FROM moderation_logs WHERE action = 'takedown' AND created_at > datetime('now', '-30 day')"),
    },
    pendingContent,
    review: reviewState(),
  });
});

adminRouter.put('/settings', (req, res) => {
  const days = Math.max(1, Math.min(90, Math.floor(Number(req.body?.cycleDays) || 7)));
  setSetting('review_cycle_days', String(days));
  res.json({ review: reviewState() });
});

adminRouter.post('/review-round', (_req, res) => {
  setSetting('last_review_at', new Date().toISOString());
  res.json({ review: reviewState() });
});

const reportCount = (type: string, id: number) =>
  count("SELECT COUNT(*) n FROM reports WHERE target_type = ? AND target_id = ? AND status = 'open'", type, id);

/** 一次查出某类内容的未处理举报数 */
function reportCounts(type: string): Map<number, number> {
  const rows = q.all<{ target_id: number; n: number }>(
    "SELECT target_id, COUNT(*) n FROM reports WHERE target_type = ? AND status = 'open' GROUP BY target_id", type,
  );
  return new Map(rows.map((r) => [r.target_id, r.n]));
}

const keyword = (v: unknown) => String(v ?? '').trim().toLowerCase().slice(0, 100);

// ---------- 主页与招募 ----------

adminRouter.get('/profiles', (req, res) => {
  const filter = String(req.query.filter ?? 'pending');
  const kw = keyword(req.query.q);
  const where =
    filter === 'pending' ? 'p.published = 1 AND p.taken_down = 0 AND p.reviewed_at IS NULL'
    : filter === 'down' ? 'p.taken_down = 1'
    : filter === 'reported' ? "p.user_id IN (SELECT target_id FROM reports WHERE target_type = 'profile' AND status = 'open')"
    : 'p.published = 1 OR p.taken_down = 1';
  const rows = q.all<any>(`SELECT p.*, u.email FROM profiles p JOIN users u ON u.id = p.user_id WHERE ${where} ORDER BY p.published_at DESC LIMIT 300`);
  const items = rows
    .map((r) => {
      const d = parseData(r);
      return {
        id: r.user_id, nickname: r.nickname, email: r.email, realName: d.realName, studentId: d.studentId,
        major: d.major, bio: d.bio, studyPlan: d.studyPlan, cover: d.photos[0] ?? null, photos: d.photos,
        publishedAt: iso(r.published_at), reviewedAt: iso(r.reviewed_at), savedAt: iso(r.saved_at),
        takenDown: !!r.taken_down, takenDownAt: iso(r.taken_down_at), takedownReason: r.takedown_reason,
        reports: reportCount('profile', r.user_id),
      };
    })
    .filter((x) => !kw || [x.nickname, x.email, x.realName, x.studentId, x.major, x.bio].some((f) => f.toLowerCase().includes(kw)));
  res.json({ items });
});

adminRouter.get('/posts', (req, res) => {
  const filter = String(req.query.filter ?? 'pending');
  const kw = keyword(req.query.q);
  const where =
    filter === 'pending' ? 'p.taken_down = 0 AND p.reviewed_at IS NULL'
    : filter === 'down' ? 'p.taken_down = 1'
    : filter === 'reported' ? "p.id IN (SELECT target_id FROM reports WHERE target_type = 'post' AND status = 'open')"
    : '1 = 1';
  const rows = q.all<any>(
    `SELECT p.*, u.email, pr.nickname FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN profiles pr ON pr.user_id = p.user_id
     WHERE p.deleted = 0 AND (${where}) ORDER BY p.created_at DESC LIMIT 300`,
  );
  const items = rows
    .map((r) => ({
      id: r.id, title: r.title, category: r.category, description: r.description, timeText: r.time_text, location: r.location,
      authorId: r.user_id, nickname: r.nickname ?? '', email: r.email, status: r.status,
      createdAt: iso(r.created_at), reviewedAt: iso(r.reviewed_at), takenDown: !!r.taken_down,
      takenDownAt: iso(r.taken_down_at), takedownReason: r.takedown_reason, reports: reportCount('post', r.id),
    }))
    .filter((x) => !kw || [x.title, x.description, x.nickname, x.email].some((f) => f.toLowerCase().includes(kw)));
  res.json({ items });
});

// ---------- 社区内容（聊天区帖子、评论、打卡） ----------

adminRouter.get('/content', (req, res) => {
  const type = req.query.type;
  if (!isCommunity(type)) throw new HttpError(400, '不支持的内容类型');
  const { table } = MODERATION[type];
  const filter = String(req.query.filter ?? 'pending');
  const kw = keyword(req.query.q);
  const params: unknown[] = [];
  let where: string;
  if (filter === 'pending') where = 'x.taken_down = 0 AND x.reviewed_at IS NULL';
  else if (filter === 'down') where = 'x.taken_down = 1';
  else if (filter === 'reported') {
    where = "x.id IN (SELECT target_id FROM reports WHERE target_type = ? AND status = 'open')";
    params.push(type);
  } else where = '1 = 1';
  // 关键词：作者昵称 / 邮箱 / 正文（帖子含标题，打卡含说明与地点）
  const textCols = type === 'forum_post' ? ['x.title', 'x.body'] : type === 'comment' ? ['x.body'] : ['x.caption', 'x.place_label'];
  let search = '';
  if (kw) {
    const cols = ["COALESCE(pr.nickname, '')", 'u.email', ...textCols];
    search = `AND (${cols.map((c) => `instr(lower(${c}), ?) > 0`).join(' OR ')})`;
    params.push(...cols.map(() => kw));
  }
  const rows = q.all<any>(
    `SELECT x.*, u.email, pr.nickname FROM ${table} x JOIN users u ON u.id = x.user_id LEFT JOIN profiles pr ON pr.user_id = x.user_id
     WHERE x.deleted = 0 AND (${where}) ${search} ORDER BY x.created_at DESC, x.id DESC LIMIT 300`,
    ...params,
  );
  const reports = reportCounts(type);
  const items = rows.map((r) => {
    let title = '';
    let body = '';
    let images: string[] = [];
    let link: string | null = null;
    if (type === 'forum_post') {
      title = r.title;
      body = r.body;
      images = imagesOf(r.images);
      link = contentLink('post', r.id);
    } else if (type === 'comment') {
      const parent = commentParent(r.target_type, r.target_id);
      title = `评论 · ${parent.label}`;
      body = r.body;
      link = parent.link;
    } else {
      title = `${r.place_label} · ${r.stamp_text}`;
      body = r.caption;
      images = FILE_RE.test(r.image) ? [r.image] : [];
      link = contentLink('checkin', r.id);
    }
    return {
      type, id: r.id, authorId: r.user_id, nickname: r.nickname ?? '', email: r.email,
      title, body, image: images[0] ?? null, images, link,
      createdAt: iso(r.created_at)!, reviewedAt: iso(r.reviewed_at), takenDown: !!r.taken_down,
      takenDownAt: iso(r.taken_down_at), takedownReason: r.takedown_reason, reports: reports.get(r.id) ?? 0,
    };
  });
  res.json({ items });
});

// ---------- 撤下 / 恢复 / 通过 ----------

interface Target {
  userId: number;
  /** 作者已注销时为 null（不再发送邮件） */
  email: string | null;
  label: string;
  /** 站内通知中的链接 */
  link: string | null;
  takenDown: boolean;
}

function target(type: ModerationTargetType, id: number): Target {
  if (type === 'profile') {
    const row = getProfileRow(id);
    if (!row) throw new HttpError(404, '主页不存在');
    return { userId: id, email: isDeletedEmail(row.email) ? null : row.email!, label: row.nickname, link: '/me', takenDown: !!row.taken_down };
  }
  if (type === 'post') {
    const row = q.get<any>('SELECT p.*, u.email FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?', id);
    if (!row) throw new HttpError(404, '帖子不存在');
    return {
      userId: row.user_id as number, email: isDeletedEmail(row.email) ? null : row.email, label: row.title as string,
      link: `/events/${id}`, takenDown: !!row.taken_down,
    };
  }
  const row = communityRow(type, id);
  if (!row || row.deleted) throw new HttpError(404, '内容不存在或已被作者删除');
  return {
    userId: row.user_id as number,
    email: isDeletedEmail(row.email) ? null : row.email,
    label: communityLabel(type, row),
    // 被撤下的评论作者本人也看不到，通知指向评论所在的内容
    link: type === 'comment' ? contentLink(row.target_type, row.target_id) : linkFor(type, id),
    takenDown: !!row.taken_down,
  };
}

adminRouter.post('/takedown', async (req, res) => {
  const type = moderationType(req.body?.type);
  const id = targetId(req.body?.id);
  const reason = String(req.body?.reason ?? '').trim().slice(0, 120);
  if (!reason) throw new HttpError(400, '请填写撤下原因');
  const t = target(type, id);
  const { table, key, what } = MODERATION[type];
  const time = beijingTime(new Date());
  tx(() => {
    q.run(
      `UPDATE ${table} SET taken_down = 1, taken_down_at = datetime('now'), takedown_reason = ?, reviewed_at = datetime('now') WHERE ${key} = ?`,
      reason, id,
    );
    q.run("UPDATE reports SET status = 'resolved', resolved_at = datetime('now') WHERE target_type = ? AND target_id = ? AND status = 'open'", type, id);
    notify(t.userId, `你的${what}已被管理员撤下`, `「${t.label}」因违规被撤下，时间：${time}。原因：${reason}`, t.link);
  });
  // 作者已注销时不再发送邮件
  const emailStatus = t.email ? await sendTakedownMail(t.email, type, t.label, reason, time) : 'skipped';
  q.run(
    'INSERT INTO moderation_logs (admin_id, action, target_type, target_id, target_user_id, target_label, reason, email_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    req.user!.id, 'takedown', type, id, t.userId, t.label, reason, emailStatus,
  );
  res.json({ ok: true, emailStatus, time });
});

adminRouter.post('/restore', (req, res) => {
  const type = moderationType(req.body?.type);
  const id = targetId(req.body?.id);
  const t = target(type, id);
  if (!t.takenDown) throw new HttpError(409, '该内容没有被撤下');
  const { table, key, what } = MODERATION[type];
  tx(() => {
    q.run(`UPDATE ${table} SET taken_down = 0, takedown_reason = NULL, reviewed_at = datetime('now') WHERE ${key} = ?`, id);
    notify(t.userId, `你的${what}已恢复展示`, `「${t.label}」经复核后已恢复展示。`, t.link);
    q.run(
      'INSERT INTO moderation_logs (admin_id, action, target_type, target_id, target_user_id, target_label) VALUES (?, ?, ?, ?, ?, ?)',
      req.user!.id, 'restore', type, id, t.userId, t.label,
    );
  });
  res.json({ ok: true });
});

adminRouter.post('/approve', (req, res) => {
  const type = moderationType(req.body?.type);
  const raw: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.id];
  if (raw.length > 500) throw new HttpError(400, '一次最多处理 500 条');
  const ids = [...new Set(raw.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  const { table, key } = MODERATION[type];
  const extra = isCommunity(type) ? ' AND deleted = 0' : '';
  let changed = 0;
  tx(() => {
    for (const id of ids) changed += Number(q.run(`UPDATE ${table} SET reviewed_at = datetime('now') WHERE ${key} = ?${extra}`, id).changes);
  });
  res.json({ ok: true, count: changed });
});

// ---------- 举报 ----------

const SNAPSHOT_MARK = '【被举报内容】';

/** 举报时留存的内容快照附在 detail 末尾（见 routes/misc.ts），这里拆成举报人的补充说明与内容原文 */
function splitDetail(type: ReportTargetType, detail: string): { note: string; snapshot: string | null } {
  if (type === 'profile' || type === 'post') return { note: detail, snapshot: null };
  const at = detail.indexOf(SNAPSHOT_MARK);
  if (at < 0) return { note: detail, snapshot: null };
  return { note: detail.slice(0, at).replace(/\n$/, ''), snapshot: detail.slice(at + SNAPSHOT_MARK.length) };
}

function reportLabel(type: ReportTargetType, id: number): string {
  if (type === 'profile') return getProfileRow(id)?.nickname ?? '（已删除）';
  if (type === 'post') return q.get<{ title: string }>('SELECT title FROM posts WHERE id = ?', id)?.title ?? '（已删除）';
  const registered = reportTargetFor(type)?.label(id);
  if (registered) return registered;
  if (type === 'message') return '私聊消息';
  const row = communityRow(type, id);
  return row && !row.deleted ? communityLabel(type, row) : '（已删除）';
}

function reportOwner(type: ReportTargetType, id: number): number | null {
  if (type === 'profile') return getProfileRow(id) ? id : null;
  if (type === 'post') return q.get<{ user_id: number }>('SELECT user_id FROM posts WHERE id = ?', id)?.user_id ?? null;
  const registered = reportTargetFor(type);
  if (registered) return registered.ownerOf(id);
  if (type === 'message') return q.get<{ sender_id: number | null }>('SELECT sender_id FROM messages WHERE id = ?', id)?.sender_id ?? null;
  return communityRow(type, id)?.user_id ?? null;
}

/** 被举报对象的当前状态：可见 / 已撤下 / 已删除（私聊消息只区分是否还在） */
function reportTargetState(type: ReportTargetType, id: number): 'visible' | 'down' | 'deleted' {
  if (type === 'message') return q.get('SELECT 1 FROM messages WHERE id = ?', id) ? 'visible' : 'deleted';
  const row = type === 'profile'
    ? q.get<any>('SELECT taken_down, 0 AS deleted FROM profiles WHERE user_id = ?', id)
    : q.get<any>(`SELECT taken_down, deleted FROM ${MODERATION[type].table} WHERE id = ?`, id);
  if (!row || row.deleted) return 'deleted';
  return row.taken_down ? 'down' : 'visible';
}

adminRouter.get('/reports', (req, res) => {
  const status = req.query.status === 'all' ? '' : "WHERE r.status = 'open'";
  const rows = q.all<any>(
    `SELECT r.*, u.email reporter_email FROM reports r JOIN users u ON u.id = r.reporter_id ${status} ORDER BY r.id DESC LIMIT 300`,
  );
  const owners = new Map<number, { id: number; nickname: string; email: string } | null>();
  const ownerInfo = (uid: number | null) => {
    if (uid === null) return null;
    if (!owners.has(uid)) {
      const u = q.get<{ email: string; nickname: string | null }>(
        'SELECT u.email, p.nickname FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?', uid,
      );
      owners.set(uid, u ? { id: uid, nickname: u.nickname ?? '（已注销）', email: isDeletedEmail(u.email) ? '' : u.email } : null);
    }
    return owners.get(uid)!;
  };
  res.json({
    items: rows
      .filter((r) => REPORT_TYPES.includes(r.target_type))
      .map((r) => {
        const type = r.target_type as ReportTargetType;
        const detail = String(r.detail ?? '');
        const { note, snapshot } = splitDetail(type, detail);
        return {
          id: r.id, targetType: type, targetId: r.target_id, targetLabel: reportLabel(type, r.target_id),
          reason: r.reason, detail, note, snapshot, link: linkFor(type, r.target_id),
          owner: ownerInfo(reportOwner(type, r.target_id)), targetState: reportTargetState(type, r.target_id),
          status: r.status, reporter: r.reporter_email, createdAt: iso(r.created_at),
        };
      }),
  });
});

/** 驳回举报（默认），或在线下处理后标记为已处理（如私聊消息） */
adminRouter.post('/reports/:id/resolve', (req, res) => {
  const id = targetId(req.params.id);
  const status = req.body?.status === 'resolved' ? 'resolved' : 'dismissed';
  const r = q.run("UPDATE reports SET status = ?, resolved_at = datetime('now') WHERE id = ? AND status = 'open'", status, id);
  if (!Number(r.changes) && !q.get('SELECT 1 FROM reports WHERE id = ?', id)) throw new HttpError(404, '举报不存在');
  res.json({ ok: true });
});

// ---------- 记录与用户 ----------

adminRouter.get('/logs', (_req, res) => {
  const rows = q.all<any>(
    `SELECT l.*, u.email admin_email FROM moderation_logs l JOIN users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT 300`,
  );
  res.json({
    items: rows.map((r) => ({
      id: r.id, action: r.action, targetType: r.target_type, targetId: r.target_id, targetLabel: r.target_label,
      reason: r.reason, emailStatus: r.email_status, admin: r.admin_email, createdAt: iso(r.created_at),
    })),
  });
});

adminRouter.get('/users', (req, res) => {
  const kw = keyword(req.query.q);
  const rows = q.all<any>(
    `SELECT u.id, u.email, u.role, u.created_at, u.last_login_at, p.nickname, p.data, p.published, p.taken_down
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.activated = 1 ORDER BY u.id DESC LIMIT 500`,
  );
  const items = rows
    .map((r) => {
      const d = r.data ? parseData(r) : null;
      return {
        id: r.id, email: r.email, role: r.role, nickname: r.nickname ?? '', realName: d?.realName ?? '', studentId: d?.studentId ?? '',
        major: d?.major ?? '', published: !!r.published && !r.taken_down, createdAt: iso(r.created_at), lastLoginAt: iso(r.last_login_at),
      };
    })
    .filter((x) => !kw || [x.email, x.nickname, x.realName, x.studentId].some((f) => f.toLowerCase().includes(kw)));
  res.json({ items });
});
