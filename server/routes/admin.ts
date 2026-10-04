import { Router } from 'express';
import { HttpError, requireAdmin } from '../auth.ts';
import { getSetting, iso, q, setSetting } from '../db.ts';
import { sendTakedownMail } from '../mail.ts';
import { beijingTime, notify } from '../notify.ts';
import { getProfileRow, parseData } from '../profiles.ts';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const count = (sql: string, ...p: any[]) => q.get<{ n: number }>(sql, ...p)!.n;

function reviewState() {
  const cycleDays = Number(getSetting('review_cycle_days', '7'));
  const last = getSetting('last_review_at', '');
  const next = last ? new Date(new Date(last).getTime() + cycleDays * 86400_000).toISOString() : null;
  return { cycleDays, lastReviewAt: last || null, nextReviewAt: next, overdue: !!next && new Date(next) < new Date() };
}

adminRouter.get('/overview', (_req, res) => {
  res.json({
    stats: {
      users: count('SELECT COUNT(*) n FROM users WHERE activated = 1'),
      published: count('SELECT COUNT(*) n FROM profiles WHERE published = 1 AND taken_down = 0'),
      posts: count("SELECT COUNT(*) n FROM posts WHERE deleted = 0 AND taken_down = 0 AND status = 'open'"),
      pendingProfiles: count('SELECT COUNT(*) n FROM profiles WHERE published = 1 AND taken_down = 0 AND reviewed_at IS NULL'),
      pendingPosts: count('SELECT COUNT(*) n FROM posts WHERE deleted = 0 AND taken_down = 0 AND reviewed_at IS NULL'),
      openReports: count("SELECT COUNT(*) n FROM reports WHERE status = 'open'"),
      takedowns30d: count("SELECT COUNT(*) n FROM moderation_logs WHERE action = 'takedown' AND created_at > datetime('now', '-30 day')"),
    },
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

adminRouter.get('/profiles', (req, res) => {
  const filter = String(req.query.filter ?? 'pending');
  const kw = String(req.query.q ?? '').trim().toLowerCase();
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
  const kw = String(req.query.q ?? '').trim().toLowerCase();
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

function target(type: string, id: number) {
  if (type === 'profile') {
    const row = getProfileRow(id);
    if (!row) throw new HttpError(404, '主页不存在');
    return { userId: id, email: row.email!, label: row.nickname, link: '/me/edit' };
  }
  const row = q.get<any>('SELECT p.*, u.email FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?', id);
  if (!row) throw new HttpError(404, '帖子不存在');
  return { userId: row.user_id as number, email: row.email as string, label: row.title as string, link: `/events/${id}` };
}

adminRouter.post('/takedown', async (req, res) => {
  const type = req.body?.type === 'post' ? 'post' : 'profile';
  const id = Number(req.body?.id);
  const reason = String(req.body?.reason ?? '').trim().slice(0, 120);
  if (!reason) throw new HttpError(400, '请填写撤下原因');
  const t = target(type, id);
  const now = new Date();
  const table = type === 'profile' ? 'profiles' : 'posts';
  const key = type === 'profile' ? 'user_id' : 'id';
  q.run(
    `UPDATE ${table} SET taken_down = 1, taken_down_at = datetime('now'), takedown_reason = ?, reviewed_at = datetime('now') WHERE ${key} = ?`,
    reason, id,
  );
  q.run("UPDATE reports SET status = 'resolved', resolved_at = datetime('now') WHERE target_type = ? AND target_id = ? AND status = 'open'", type, id);
  const what = type === 'profile' ? '个人主页' : '帖子';
  const time = beijingTime(now);
  notify(t.userId, `你的${what}已被管理员撤下`, `「${t.label}」因违规被撤下，时间：${time}。原因：${reason}`, type === 'profile' ? '/me' : t.link);
  const emailStatus = await sendTakedownMail(t.email, type, t.label, reason, time);
  q.run(
    'INSERT INTO moderation_logs (admin_id, action, target_type, target_id, target_user_id, target_label, reason, email_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    req.user!.id, 'takedown', type, id, t.userId, t.label, reason, emailStatus,
  );
  res.json({ ok: true, emailStatus, time });
});

adminRouter.post('/restore', (req, res) => {
  const type = req.body?.type === 'post' ? 'post' : 'profile';
  const id = Number(req.body?.id);
  const t = target(type, id);
  const table = type === 'profile' ? 'profiles' : 'posts';
  const key = type === 'profile' ? 'user_id' : 'id';
  q.run(`UPDATE ${table} SET taken_down = 0, takedown_reason = NULL, reviewed_at = datetime('now') WHERE ${key} = ?`, id);
  notify(t.userId, `你的${type === 'profile' ? '个人主页' : '帖子'}已恢复展示`, `「${t.label}」经复核后已恢复展示。`, type === 'profile' ? '/me' : t.link);
  q.run(
    'INSERT INTO moderation_logs (admin_id, action, target_type, target_id, target_user_id, target_label) VALUES (?, ?, ?, ?, ?, ?)',
    req.user!.id, 'restore', type, id, t.userId, t.label,
  );
  res.json({ ok: true });
});

adminRouter.post('/approve', (req, res) => {
  const type = req.body?.type === 'post' ? 'post' : 'profile';
  const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.id]).map(Number).filter(Number.isInteger);
  const table = type === 'profile' ? 'profiles' : 'posts';
  const key = type === 'profile' ? 'user_id' : 'id';
  for (const id of ids) q.run(`UPDATE ${table} SET reviewed_at = datetime('now') WHERE ${key} = ?`, id);
  res.json({ ok: true, count: ids.length });
});

adminRouter.get('/reports', (req, res) => {
  const status = req.query.status === 'all' ? '' : "WHERE r.status = 'open'";
  const rows = q.all<any>(
    `SELECT r.*, u.email reporter_email FROM reports r JOIN users u ON u.id = r.reporter_id ${status} ORDER BY r.id DESC LIMIT 300`,
  );
  res.json({
    items: rows.map((r) => {
      let label = '';
      if (r.target_type === 'profile') label = getProfileRow(r.target_id)?.nickname ?? '（已删除）';
      else label = q.get<{ title: string }>('SELECT title FROM posts WHERE id = ?', r.target_id)?.title ?? '（已删除）';
      return {
        id: r.id, targetType: r.target_type, targetId: r.target_id, targetLabel: label, reason: r.reason, detail: r.detail,
        status: r.status, reporter: r.reporter_email, createdAt: iso(r.created_at),
      };
    }),
  });
});

adminRouter.post('/reports/:id/resolve', (req, res) => {
  q.run("UPDATE reports SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ?", Number(req.params.id));
  res.json({ ok: true });
});

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
  const kw = String(req.query.q ?? '').trim().toLowerCase();
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
