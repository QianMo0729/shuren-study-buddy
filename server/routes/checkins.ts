import { Router } from 'express';
import { HttpError, rateLimit, requireUser } from '../auth.ts';
import {
  CHECKIN_LIMITS, assertCanStamp, checkSession, checkinVisibleTo, consumeSession, createCheckin, getCheckinRow, issueSession, listCheckins,
  parseCaption, parseLiveJpeg, parseLocation, parsePlaceId, parseVisibility, recentCount, statsFor, toCheckin, toCheckins, type FeedScope,
} from '../checkins.ts';
import { q } from '../db.ts';
import { ensureProfile } from '../profiles.ts';

// 学习打卡：照片只能来自网页相机实时拍摄（一次性拍照凭证），时间与地点水印由服务器盖章。
// 打卡照片不能通过 /api/uploads 上传，也不能引用已上传的文件。
export const checkinRouter = Router();
checkinRouter.use(requireUser);

const viewerOf = (req: { user?: { id: number; role: 'user' | 'admin' } }) => ({ id: req.user!.id, role: req.user!.role });

function parseId(v: unknown) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** 摄像头成功打开后领取拍照凭证 */
checkinRouter.post('/session', (req, res) => {
  const uid = req.user!.id;
  rateLimit(`checkin-session:${uid}`, 20, 10 * 60_000);
  res.json(issueSession(uid));
});

/** 正在盖章的账号：每人同时只处理一张照片，避免一个账号占满盖章线程，也保证每日次数不会被并发提交绕过 */
const stamping = new Set<number>();

/** 提交打卡：校验凭证 → 校验照片与参数 → 原子地消耗凭证 → 服务器盖章并保存 */
checkinRouter.post('/', async (req, res) => {
  const uid = req.user!.id;
  // 每次提交都要解码与重新编码照片，限制尝试次数（含失败的）
  rateLimit(`checkin-create:${uid}`, 30, 60 * 60_000);
  const body = req.body ?? {};
  const hash = checkSession(uid, body.token);
  const caption = parseCaption(body.caption);
  const visibility = parseVisibility(body.visibility);
  const location = parseLocation(body.location);
  const placeId = parsePlaceId(body.placeId);
  const jpeg = parseLiveJpeg(body.image);
  if (recentCount(uid) >= CHECKIN_LIMITS.perDay) throw new HttpError(429, `每天最多打卡 ${CHECKIN_LIMITS.perDay} 次，明天再来吧`);
  if (stamping.has(uid)) throw new HttpError(429, '上一张照片还在处理，请稍等片刻');
  // 以下几步都是同步的：确认还有处理能力之后再消耗凭证，凭证不会因为排队已满而白白作废
  assertCanStamp();
  consumeSession(uid, hash);
  ensureProfile(uid);
  stamping.add(uid);
  try {
    // 客户端传来的任何时间字段都被忽略：时间取服务器此刻
    const row = await createCheckin(uid, { jpeg, caption, visibility, location, placeId }, new Date());
    res.json({ checkin: toCheckin(row, viewerOf(req)), stats: statsFor(uid) });
  } finally {
    stamping.delete(uid);
  }
});

checkinRouter.get('/', (req, res) => {
  const raw = String(req.query.scope ?? 'all');
  const scope: FeedScope = raw === 'mine' || raw === 'buddies' ? raw : 'all';
  const before = parseId(req.query.before) || null;
  const viewer = viewerOf(req);
  const { rows, hasMore } = listCheckins(viewer, scope, before);
  res.json({ items: toCheckins(rows, viewer), hasMore });
});

checkinRouter.get('/stats', (req, res) => {
  res.json(statsFor(req.user!.id));
});

checkinRouter.get('/:id', (req, res) => {
  const viewer = viewerOf(req);
  const row = getCheckinRow(parseId(req.params.id));
  if (!checkinVisibleTo(row, viewer)) throw new HttpError(404, '打卡不存在或已删除');
  res.json({ checkin: toCheckin(row, viewer) });
});

checkinRouter.delete('/:id', (req, res) => {
  const row = getCheckinRow(parseId(req.params.id));
  if (!row || row.deleted) throw new HttpError(404, '打卡不存在或已删除');
  if (row.user_id !== req.user!.id) throw new HttpError(403, '只能删除自己的打卡');
  q.run('UPDATE checkins SET deleted = 1 WHERE id = ?', row.id);
  res.json({ ok: true });
});
