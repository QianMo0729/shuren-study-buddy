import { Router } from 'express';
import type { Role } from '../../shared/types.ts';
import { HttpError, rateLimit, requireUser } from '../auth.ts';
import {
  CHECKIN_LIMITS, assertCanStamp, beijingDate, checkSession, checkinVisibleTo, consumeSession, createCheckin, getCheckinRow, issueSession, listCheckins,
  parseCaption, parseLiveJpeg, parseLocation, parseVisibility, recentCount, statsFor, toCheckin, toCheckins, type FeedScope,
} from '../checkins.ts';
import { deviceHashOf, recordDevice } from '../audits.ts';
import { q } from '../db.ts';
import { touchScores } from '../scoring.ts';
import { ensureProfile } from '../profiles.ts';

// 学习打卡：照片只能来自网页相机实时拍摄（一次性拍照凭证），时间与地点水印由服务器盖章。
// 打卡照片不能通过 /api/uploads 上传，也不能引用已上传的文件。
export const checkinRouter = Router();
checkinRouter.use(requireUser);

const viewerOf = (req: { user?: { id: number; role: Role } }) => ({ id: req.user!.id, role: req.user!.role });

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
  // 地点由定位决定：旧版本页面传来的手选楼栋（placeId）一律忽略
  const location = parseLocation(body.location);
  const jpeg = parseLiveJpeg(body.image);
  if (recentCount(uid) >= CHECKIN_LIMITS.perDay) throw new HttpError(429, `每天最多打卡 ${CHECKIN_LIMITS.perDay} 次，明天再来吧`);
  // 同一台设备（同一个浏览器）一天只能给一个账号打卡，防止一个人登录两个账号替搭子打卡。删掉的打卡也算
  const deviceHash = deviceHashOf(req);
  if (deviceHash && deviceUsedByOther(deviceHash, uid)) {
    throw new HttpError(409, '这台设备今天已经给另一个账号打过卡了。打卡要用自己的手机，不能替别人拍。');
  }
  if (stamping.has(uid)) throw new HttpError(429, '上一张照片还在处理，请稍等片刻');
  // 以下几步都是同步的：确认还有处理能力之后再消耗凭证，凭证不会因为排队已满而白白作废
  assertCanStamp();
  consumeSession(uid, hash);
  ensureProfile(uid);
  stamping.add(uid);
  try {
    // 客户端传来的任何时间字段都被忽略：时间取服务器此刻
    recordDevice(uid, deviceHash);
    const row = await createCheckin(uid, { jpeg, caption, visibility, location, deviceHash }, new Date());
    res.json({ checkin: toCheckin(row, viewerOf(req)), stats: statsFor(uid) });
  } finally {
    stamping.delete(uid);
  }
});

/** 这台设备今天是否已经给别的账号打过卡 */
function deviceUsedByOther(deviceHash: string, uid: number): boolean {
  return !!q.get('SELECT 1 FROM checkins WHERE device_hash = ? AND local_date = ? AND user_id <> ? LIMIT 1', deviceHash, beijingDate(), uid);
}

checkinRouter.get('/', (req, res) => {
  const raw = String(req.query.scope ?? 'all');
  const scope: FeedScope = raw === 'mine' || raw === 'buddies' || raw === 'partner' ? raw : 'all';
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
  // 清除定位并重新计算积分，改用当天剩余照片中最早满足搭子条件的一组。
  q.run('UPDATE checkins SET deleted = 1, geo_lat = NULL, geo_lng = NULL WHERE id = ?', row.id);
  touchScores();
  res.json({ ok: true });
});
