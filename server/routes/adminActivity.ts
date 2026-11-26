import { Router } from 'express';
import { INVALID_OTHER, INVALID_REASONS, validateActivityConfig } from '../../shared/activity.ts';
import { distanceM } from '../../shared/campusPlaces.ts';
import { ROLE_LABELS, normalizeRole } from '../../shared/roles.ts';
import { HttpError, requireAdmin, requireStaff } from '../auth.ts';
import { activityConfig, saveActivityConfig, seasonInfo } from '../activityConfig.ts';
import {
  FLAG_LABELS, type AuditFlag, decideAppeal, disqualifyPair, enqueuePrizeReview, ensureWeeklySamples, invalidateCheckin, passAudit, requalifyPair,
} from '../audits.ts';
import { decideClaim } from '../bonus.ts';
import { type PairRow, shurenOf } from '../buddyState.ts';
import { checkMessage, saveWordLists, wordLists } from '../chatSafety.ts';
import { iso, q } from '../db.ts';
import { getProfileRow, parseData } from '../profiles.ts';
import { ineligibleReason, leaderboard, pairDayCheckins, pairScore, scoredThrough, scoringStart, strikesOf, touchScores } from '../scoring.ts';

// 管理后台中与搭子打卡活动有关的部分。审核员和管理员都能用；活动设置与人员授权只有管理员能用。
export const adminActivityRouter = Router();
adminActivityRouter.use(requireStaff);

function idOf(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, '参数不正确');
  return id;
}

const emailOf = (uid: number | null) => (uid ? q.get<{ email: string }>('SELECT email FROM users WHERE id = ?', uid)?.email ?? '' : '');
const nicknameOf = (uid: number) => getProfileRow(uid)?.nickname ?? '（已注销）';

const SOURCE_LABELS = { random: '随机抽检', flag: '系统标记', prize: '获奖复核', manual: '手动加入' } as const;

interface CheckinRow {
  id: number; user_id: number; image: string; caption: string; place_label: string; stamp_text: string; stamped_at: string;
  local_date: string; created_at: string; deleted: number; taken_down: number; invalid: number; invalid_reason: string | null;
  invalid_at: string | null; invalid_by: number | null; geo_lat: number | null; geo_lng: number | null; geo_accuracy: number | null;
}

const checkinView = (c: CheckinRow) => ({
  id: c.id, image: c.image, caption: c.caption, placeLabel: c.place_label, stampText: c.stamp_text, stampedAt: iso(c.stamped_at),
  // 只给审核人员看定位误差，不给经纬度
  accuracy: c.geo_accuracy,
  deleted: !!c.deleted, takenDown: !!c.taken_down, invalid: !!c.invalid, invalidReason: c.invalid_reason,
  invalidAt: iso(c.invalid_at), invalidBy: emailOf(c.invalid_by),
});

/** 审核计分打卡时展示实际配对的另一张照片；其余打卡按时间就近对照。 */
function partnerContext(c: CheckinRow) {
  const pair = q.get<PairRow>(
    `SELECT * FROM buddy_pairs WHERE (user_a = ? OR user_b = ?) AND created_at <= ? AND (ended_at IS NULL OR ended_at >= ?)
     ORDER BY id DESC LIMIT 1`, c.user_id, c.user_id, c.created_at, c.created_at,
  );
  if (!pair) return { partner: null, partnerCheckin: null, distance: null };
  const partnerId = pair.user_a === c.user_id ? pair.user_b : pair.user_a;
  const { event } = pairDayCheckins(pair, c.local_date);
  const matchedPartnerId = event?.a.id === c.id ? event.b.id : event?.b.id === c.id ? event.a.id : null;
  const near = matchedPartnerId !== null ? q.get<CheckinRow>('SELECT * FROM checkins WHERE id = ?', matchedPartnerId) : q.get<CheckinRow>(
    `SELECT * FROM checkins WHERE user_id = ? AND local_date = ? AND deleted = 0
     ORDER BY abs(julianday(stamped_at) - julianday(?)), id LIMIT 1`, partnerId, c.local_date, c.stamped_at,
  );
  // 两次打卡相距多少米（取整到 10 米）；有一方没有定位时为 null
  const meters = near && c.geo_lat !== null && c.geo_lng !== null && near.geo_lat !== null && near.geo_lng !== null
    ? Math.round(distanceM({ lat: c.geo_lat, lng: c.geo_lng }, { lat: near.geo_lat, lng: near.geo_lng }) / 10) * 10
    : null;
  return { partner: { id: partnerId, nickname: nicknameOf(partnerId) }, partnerCheckin: near ? checkinView(near) : null, distance: meters };
}

// ---------- 抽检 ----------

adminActivityRouter.get('/audits', (req, res) => {
  ensureWeeklySamples();
  const done = req.query.status === 'done';
  const rows = q.all<{ checkin_id: number; week: string; source: keyof typeof SOURCE_LABELS; flags: string; status: string; reviewer_id: number | null; reviewed_at: string | null }>(
    `SELECT a.* FROM checkin_audits a JOIN checkins c ON c.id = a.checkin_id
     WHERE ${done ? "a.status <> 'pending'" : "a.status = 'pending' AND c.deleted = 0"}
     ORDER BY ${done ? 'a.reviewed_at DESC' : "CASE a.source WHEN 'flag' THEN 0 WHEN 'prize' THEN 1 ELSE 2 END, a.id"} LIMIT 200`,
  );
  res.json({
    items: rows.map((a) => {
      const c = q.get<CheckinRow>('SELECT * FROM checkins WHERE id = ?', a.checkin_id)!;
      let flags: AuditFlag[] = [];
      try { flags = JSON.parse(a.flags); } catch { /* 旧数据按无标记处理 */ }
      return {
        checkinId: a.checkin_id, week: a.week, source: a.source, sourceLabel: SOURCE_LABELS[a.source],
        flags: flags.map((f) => FLAG_LABELS[f] ?? f), status: a.status, reviewer: emailOf(a.reviewer_id), reviewedAt: iso(a.reviewed_at),
        checkin: checkinView(c), author: { id: c.user_id, nickname: nicknameOf(c.user_id) }, ...partnerContext(c),
      };
    }),
    reasons: [...INVALID_REASONS, INVALID_OTHER],
  });
});

adminActivityRouter.post('/audits/:checkinId/pass', (req, res) => {
  passAudit(idOf(req.params.checkinId), req.user!.id);
  res.json({ ok: true });
});

/** 判无效：理由只能从固定列表中选；选「其他」时必须写明 */
adminActivityRouter.post('/checkins/:id/invalidate', async (req, res) => {
  const reason = String(req.body?.reason ?? '');
  const note = String(req.body?.note ?? '').trim().slice(0, 120);
  if (![...INVALID_REASONS, INVALID_OTHER].includes(reason as never)) throw new HttpError(400, '请选择判无效的理由');
  if (reason === INVALID_OTHER && !note) throw new HttpError(400, '选择「其他」时请写明具体原因');
  const result = await invalidateCheckin(idOf(req.params.id), req.user!.id, note ? `${reason}：${note}` : reason);
  res.json({ ok: true, ...result });
});

// ---------- 申诉 ----------

adminActivityRouter.get('/appeals', (req, res) => {
  const all = req.query.status === 'all';
  const rows = q.all<{ id: number; checkin_id: number; user_id: number; body: string; status: string; decided_by: number | null; decided_at: string | null; decision_note: string | null; created_at: string }>(
    `SELECT * FROM checkin_appeals ${all ? '' : "WHERE status = 'open'"} ORDER BY id DESC LIMIT 200`,
  );
  const me = req.user!.id;
  res.json({
    items: rows.map((r) => {
      const c = q.get<CheckinRow>('SELECT * FROM checkins WHERE id = ?', r.checkin_id)!;
      return {
        id: r.id, status: r.status, body: r.body, createdAt: iso(r.created_at), decidedBy: emailOf(r.decided_by), decidedAt: iso(r.decided_at),
        decisionNote: r.decision_note, author: { id: r.user_id, nickname: nicknameOf(r.user_id) }, checkin: checkinView(c),
        // 判无效的人不能复核自己的决定
        canDecide: r.status === 'open' && c.invalid_by !== me, ...partnerContext(c),
      };
    }),
  });
});

adminActivityRouter.post('/appeals/:id', (req, res) => {
  decideAppeal(idOf(req.params.id), req.user!.id, req.body?.decision, req.body?.note);
  res.json({ ok: true });
});

// ---------- Bonus ----------

adminActivityRouter.get('/bonus', (req, res) => {
  const all = req.query.status === 'all';
  const rows = q.all<{ id: number; post_id: number; pair_id: number; user_id: number; week: string; status: string; points: number; reason: string | null; reviewer_id: number | null; reviewed_at: string | null; created_at: string }>(
    `SELECT b.* FROM bonus_claims b ${all ? '' : "JOIN buddy_pairs p ON p.id = b.pair_id AND p.status = 'active' WHERE b.status = 'pending'"} ORDER BY b.id ${all ? 'DESC' : 'ASC'} LIMIT 200`,
  );
  const config = activityConfig();
  res.json({
    items: rows.map((r) => {
      const post = q.get<{ id: number; title: string; body: string; images: string; deleted: number; taken_down: number }>('SELECT id, title, body, images, deleted, taken_down FROM forum_posts WHERE id = ?', r.post_id);
      const pair = q.get<PairRow>('SELECT * FROM buddy_pairs WHERE id = ?', r.pair_id)!;
      const partnerId = pair.user_a === r.user_id ? pair.user_b : pair.user_a;
      const approved = q.get<{ n: number | null }>("SELECT SUM(points) n FROM bonus_claims WHERE pair_id = ? AND status = 'approved'", r.pair_id)!.n ?? 0;
      let images: string[] = [];
      try { images = JSON.parse(post?.images ?? '[]'); } catch { /* 无图片 */ }
      return {
        id: r.id, status: r.status, points: r.points, reason: r.reason, week: r.week, createdAt: iso(r.created_at),
        reviewer: emailOf(r.reviewer_id), reviewedAt: iso(r.reviewed_at),
        post: post ? { id: post.id, title: post.title, body: post.body, images, deleted: !!post.deleted, takenDown: !!post.taken_down } : null,
        author: { id: r.user_id, nickname: nicknameOf(r.user_id) }, partner: { id: partnerId, nickname: nicknameOf(partnerId) },
        pairActive: pair.status === 'active', approvedPoints: approved, seasonMax: config.bonusSeasonMax,
      };
    }),
  });
});

adminActivityRouter.post('/bonus/:id', (req, res) => {
  res.json(decideClaim(idOf(req.params.id), req.user!.id, req.body?.decision, req.body?.reason));
});

// ---------- 搭子榜（含分数与核对信息） ----------

/** 姓名与学号只给管理员看（发奖前核对用）；审核员只看到昵称。书院身份按学号号段判断 */
function memberInfo(uid: number, full: boolean) {
  const row = getProfileRow(uid);
  const d = row && full ? parseData(row) : null;
  return {
    id: uid, nickname: row?.nickname ?? '（已注销）', realName: d?.realName ?? '', studentId: full ? row?.email?.split('@')[0] ?? '' : '',
    shuren: shurenOf(uid),
  };
}

adminActivityRouter.get('/board', (req, res) => {
  const full = req.user!.role === 'admin';
  const config = activityConfig();
  const board = leaderboard();
  const ranked = new Map(board.items.map((item) => [item.pair.id, item]));
  const pairs = q.all<PairRow>("SELECT * FROM buddy_pairs WHERE status = 'active' ORDER BY id");
  const items = pairs.map((pair) => {
    const entry = ranked.get(pair.id);
    const score = entry ?? pairScore(pair, scoredThrough(new Date(), config), config);
    return {
      pairId: pair.id, rank: entry?.rank ?? null, tied: entry?.tied ?? false,
      total: score.total, checkinPoints: score.checkinPoints, bonusPoints: score.bonusPoints, fullWeeks: score.fullWeeks,
      events: score.events, reachedWeek: score.reachedWeek, weeks: score.weeks,
      members: [memberInfo(pair.user_a, full), memberInfo(pair.user_b, full)], startsOn: scoringStart(pair, config), createdAt: iso(pair.created_at),
      ineligible: ineligibleReason(pair, config), strikes: strikesOf(pair),
      disqualified: !!q.get('SELECT 1 FROM activity_disqualified WHERE user_id IN (?, ?)', pair.user_a, pair.user_b),
    };
  }).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.total - a.total || a.pairId - b.pairId);
  res.json({ items, through: board.through, season: seasonInfo(), prizePairs: config.prizePairs });
});

adminActivityRouter.post('/board/prize-review', (_req, res) => {
  res.json(enqueuePrizeReview());
});

adminActivityRouter.post('/pairs/:id/disqualify', (req, res) => {
  disqualifyPair(idOf(req.params.id), req.user!.id, req.body?.reason);
  res.json({ ok: true });
});

adminActivityRouter.delete('/pairs/:id/disqualify', (req, res) => {
  requalifyPair(idOf(req.params.id), req.user!.id);
  res.json({ ok: true });
});

// ---------- 私聊敏感词 ----------

adminActivityRouter.get('/chat-words', (_req, res) => {
  res.json({ words: wordLists() });
});

adminActivityRouter.put('/chat-words', (req, res) => {
  res.json({ words: saveWordLists(req.body?.words) });
});

/** 修改词库前试一试某句话会被怎样处理 */
adminActivityRouter.post('/chat-words/test', (req, res) => {
  res.json(checkMessage(String(req.body?.text ?? '').slice(0, 1000)));
});

// ---------- 活动设置（仅管理员） ----------

adminActivityRouter.get('/activity-config', (_req, res) => {
  res.json({ config: activityConfig(), season: seasonInfo() });
});

adminActivityRouter.put('/activity-config', requireAdmin, (req, res) => {
  const checked = validateActivityConfig(req.body?.config);
  if ('error' in checked) throw new HttpError(400, checked.error);
  saveActivityConfig(checked.config);
  touchScores();
  q.run(
    "INSERT INTO moderation_logs (admin_id, action, target_type, target_id, target_label, reason) VALUES (?, 'activity_config', 'settings', 0, '活动设置', ?)",
    req.user!.id, JSON.stringify(checked.config),
  );
  res.json({ config: checked.config, season: seasonInfo() });
});

// ---------- 审核小组（仅管理员） ----------

adminActivityRouter.get('/staff', requireAdmin, (_req, res) => {
  const rows = q.all<{ id: number; email: string; role: string; last_login_at: string | null }>(
    "SELECT id, email, role, last_login_at FROM users WHERE role IN ('admin', 'moderator') AND activated = 1 ORDER BY role, id",
  );
  const since = q.all<{ admin_id: number; n: number }>(
    "SELECT admin_id, COUNT(*) n FROM moderation_logs WHERE created_at > datetime('now', '-7 day') GROUP BY admin_id",
  );
  const work = new Map(since.map((r) => [r.admin_id, r.n]));
  res.json({
    items: rows.map((r) => ({
      id: r.id, email: r.email, role: normalizeRole(r.role), nickname: getProfileRow(r.id)?.nickname ?? '', lastLoginAt: iso(r.last_login_at),
      actions7d: work.get(r.id) ?? 0,
    })),
  });
});

adminActivityRouter.post('/staff', requireAdmin, (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const role = normalizeRole(req.body?.role);
  const user = q.get<{ id: number; role: string }>('SELECT id, role FROM users WHERE email = ? AND activated = 1', email);
  if (!user) throw new HttpError(404, '没有找到这个账号，请确认对方已经激活');
  if (user.id === req.user!.id) throw new HttpError(400, '不能修改自己的角色');
  q.run('UPDATE users SET role = ? WHERE id = ?', role, user.id);
  q.run(
    "INSERT INTO moderation_logs (admin_id, action, target_type, target_id, target_user_id, target_label, reason) VALUES (?, 'role_change', 'user', ?, ?, ?, ?)",
    req.user!.id, user.id, user.id, email, `${ROLE_LABELS[normalizeRole(user.role)]} → ${ROLE_LABELS[role]}`,
  );
  res.json({ ok: true, role });
});
