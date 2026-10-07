// 学习打卡：实时拍照会话、照片校验与服务器盖章、可见性、连续打卡统计，并向公共路由（文件、举报、评论/点赞）登记。
// 接口在 server/routes/checkins.ts；数据表在 server/community.ts。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getCampusPlace, placeLabelFor, type GeoInput } from '../shared/campusPlaces.ts';
import { hasPrivacyConsent } from '../shared/profileRules.ts';
import type { Checkin, CheckinSession, CheckinStats, CheckinVisibility, ForumAuthor } from '../shared/types.ts';
import { HttpError, sha256 } from './auth.ts';
import './community.ts';
import { config } from './config.ts';
import { isExcluded } from './connections.ts';
import { iso, q, tx } from './db.ts';
import { activeMatchBetween } from './matches.ts';
import { getProfileRow, parseData } from './profiles.ts';
import { registerContentTarget, registerFileAccess, registerReportTarget } from './social.ts';
import { StampError, stampPool } from './stampPool.ts';
import { assertStorageAvailable } from './uploads.ts';
import { applyAutoModeration, reviewState } from './autoModeration.ts';

export const CHECKIN_LIMITS = {
  /** 拍照凭证有效期 */
  sessionTtlMs: 3 * 60_000,
  /** 凭证签发后至少经过多久才能提交（防止脚本领取后立即上传现成图片） */
  minSessionAgeMs: 500,
  caption: 200,
  maxImageBytes: 4 * 1024 * 1024,
  /** 盖章后重新编码的照片上限。网页相机拍出的照片远小于此；只有刻意构造的高噪声图片才会超出 */
  maxStampedBytes: 2 * 1024 * 1024,
  minSide: 240,
  /** 网页相机输出的最长边是 1600（src/components/checkin/useLiveCamera.ts），留出余量 */
  maxSide: 2560,
  /** 与 watermark.ts 中 jpeg-js 的 maxResolutionInMP: 4 一致 */
  maxPixels: 4_000_000,
  perDay: 10,
  pageSize: 20,
} as const;

export interface CheckinRow {
  auto_held?: number;
  risk_reasons?: string | null;
  id: number;
  user_id: number;
  image: string;
  caption: string;
  place_label: string;
  stamped_at: string;
  local_date: string;
  stamp_text: string;
  visibility: CheckinVisibility;
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

const UPLOAD_DIR = path.join(config.dataDir, 'uploads');

// ---------- 北京时间 ----------

// 中国不实行夏令时，固定 UTC+8，不依赖运行环境的时区数据
const BEIJING_OFFSET_MS = 8 * 3600_000;

export function beijingParts(d: Date) {
  const s = new Date(d.getTime() + BEIJING_OFFSET_MS).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 19) };
}

/** 北京日期 YYYY-MM-DD */
export const beijingDate = (d = new Date()) => beijingParts(d).date;

/** 水印第 2 行：YYYY-MM-DD HH:mm:ss 北京时间 */
export function stampTimeText(d: Date) {
  const { date, time } = beijingParts(d);
  return `${date} ${time} 北京时间`;
}

/** SQLite datetime 格式（UTC，无时区标记），与其他表一致 */
const sqliteTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);

// ---------- 拍照会话 ----------

interface SessionRow {
  token_hash: string;
  user_id: number;
  created_at: string;
  expires_at: string;
  used: number;
}

/** 摄像头打开后领取：随机 token（库里只存 sha256），3 分钟有效、一次性 */
export function issueSession(userId: number, now = new Date()): CheckinSession {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + CHECKIN_LIMITS.sessionTtlMs);
  // 顺手清理一小时前就已过期的凭证
  q.run('DELETE FROM checkin_sessions WHERE expires_at < ?', new Date(now.getTime() - 3600_000).toISOString());
  // created_at / expires_at 用带毫秒的 ISO 时间，便于判断“签发后至少 0.5 秒”
  q.run(
    'INSERT INTO checkin_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    sha256(token), userId, now.toISOString(), expires.toISOString(),
  );
  return { token, expiresAt: expires.toISOString(), serverTime: now.toISOString() };
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** 检查凭证属于本人、未使用、未过期且已签发至少 0.5 秒；不消耗凭证 */
export function checkSession(userId: number, token: unknown): string {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new HttpError(400, '缺少拍照凭证，请在打卡页面打开相机后拍照');
  const hash = sha256(token);
  const row = q.get<SessionRow>('SELECT * FROM checkin_sessions WHERE token_hash = ?', hash);
  // 别人的凭证与不存在的凭证给出同样的提示
  if (!row || row.user_id !== userId) throw new HttpError(400, '拍照凭证无效，请重新打开相机');
  if (row.used) throw new HttpError(400, '这次拍照已经提交过了，请重新拍照');
  const now = Date.now();
  if (Date.parse(row.expires_at) <= now) throw new HttpError(400, '拍照凭证已过期，请重新拍照');
  if (now - Date.parse(row.created_at) < CHECKIN_LIMITS.minSessionAgeMs) throw new HttpError(400, '相机还没准备好，请稍等片刻再按快门');
  return hash;
}

/** 原子地标记凭证已使用；并发提交时只有一次成功 */
export function consumeSession(userId: number, hash: string) {
  const r = q.run('UPDATE checkin_sessions SET used = 1 WHERE token_hash = ? AND user_id = ? AND used = 0', hash, userId);
  if (Number(r.changes) !== 1) throw new HttpError(400, '这次拍照已经提交过了，请重新拍照');
}

// ---------- 照片校验 ----------

const JPEG_PREFIX = 'data:image/jpeg;base64,';
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export interface JpegInfo {
  width: number;
  height: number;
  /** APP1 中的 EXIF（不含 "Exif\0\0" 头），没有为 null */
  exif: Buffer | null;
}

/** 只读取 JPEG 的段结构（SOF 尺寸、EXIF），不解码像素；结构不对返回 null */
export function inspectJpeg(buf: Buffer): JpegInfo | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  let width = 0;
  let height = 0;
  let exif: Buffer | null = null;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // 填充字节
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break; // 图像结束 / 扫描数据开始：尺寸必须已经出现
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    if (SOF_MARKERS.has(marker) && len >= 7) {
      height = buf.readUInt16BE(i + 5);
      width = buf.readUInt16BE(i + 7);
    } else if (marker === 0xe1 && !exif && len >= 8 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
      exif = buf.subarray(i + 10, i + 2 + len);
    }
    i += 2 + len;
  }
  return width && height ? { width, height, exif } : null;
}

// 只有相机/相册照片才会带的 EXIF 标签：厂商、型号、GPS、拍摄时间、曝光参数。网页 canvas 编码的 JPEG 不会写入这些。
const CAMERA_IFD0_TAGS = new Set([0x010f, 0x0110, 0x8825]);
const CAMERA_EXIF_TAGS = new Set([0x9003, 0x9004, 0x829a, 0x829d, 0x8827, 0x920a]);
const EXIF_IFD_POINTER = 0x8769;

/** EXIF 中是否有相机拍摄信息（说明照片来自相册，而不是网页相机实时拍摄） */
export function hasCameraExif(exif: Buffer | null): boolean {
  if (!exif || exif.length < 8) return false;
  const order = exif.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return false;
  const le = order === 'II';
  const u16 = (o: number) => (o + 2 <= exif.length ? (le ? exif.readUInt16LE(o) : exif.readUInt16BE(o)) : -1);
  const u32 = (o: number) => (o + 4 <= exif.length ? (le ? exif.readUInt32LE(o) : exif.readUInt32BE(o)) : -1);
  if (u16(2) !== 42) return false;
  const scan = (offset: number, tags: Set<number>, depth: number): boolean => {
    const count = u16(offset);
    if (count <= 0 || count > 512) return false;
    for (let k = 0; k < count; k++) {
      const entry = offset + 2 + k * 12;
      const tag = u16(entry);
      if (tag < 0) return false;
      if (tags.has(tag)) return true;
      if (tag === EXIF_IFD_POINTER && depth === 0) {
        const sub = u32(entry + 8);
        if (sub > 0 && sub < exif.length && scan(sub, CAMERA_EXIF_TAGS, 1)) return true;
      }
    }
    return false;
  };
  const ifd0 = u32(4);
  return ifd0 > 0 && ifd0 < exif.length && scan(ifd0, CAMERA_IFD0_TAGS, 0);
}

/**
 * 校验实时拍摄的照片：只接受 data:image/jpeg;base64，≤ 4MB，结构完整，宽高 240–2560、不超过 400 万像素，
 * 且不带相机/相册的 EXIF 拍摄信息。返回 JPEG 数据（尚未解码）。
 */
export function parseLiveJpeg(image: unknown): Buffer {
  if (typeof image !== 'string' || !image.startsWith(JPEG_PREFIX)) {
    throw new HttpError(400, '只接受网页相机实时拍摄的 JPEG 照片');
  }
  const b64 = image.slice(JPEG_PREFIX.length);
  if (b64.length > Math.ceil(CHECKIN_LIMITS.maxImageBytes / 3) * 4) throw new HttpError(400, '照片过大，请重新拍照（最多 4MB）');
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new HttpError(400, '照片数据不完整，请重新拍照');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > CHECKIN_LIMITS.maxImageBytes) throw new HttpError(400, '照片过大，请重新拍照（最多 4MB）');
  const info = inspectJpeg(buf);
  if (!info) throw new HttpError(400, '只接受网页相机实时拍摄的 JPEG 照片');
  const { width, height } = info;
  const { minSide, maxSide, maxPixels } = CHECKIN_LIMITS;
  if (width < minSide || height < minSide || width > maxSide || height > maxSide || width * height > maxPixels) {
    throw new HttpError(400, `照片尺寸不符合要求（宽高需在 ${minSide}–${maxSide} 像素之间）`);
  }
  if (hasCameraExif(info.exif)) {
    throw new HttpError(400, '这张照片带有相机拍摄信息，看起来来自相册。打卡只能用网页相机现场拍摄');
  }
  return buf;
}

/** 位置：null 表示未提供；否则必须是合法的经纬度与精度 */
export function parseLocation(v: unknown): GeoInput | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') throw new HttpError(400, '位置信息不正确');
  const { lat, lng, accuracy } = v as Record<string, unknown>;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  if (!num(lat) || !num(lng) || !num(accuracy)) throw new HttpError(400, '位置信息不正确');
  const loc = { lat: lat as number, lng: lng as number, accuracy: accuracy as number };
  if (Math.abs(loc.lat) > 90 || Math.abs(loc.lng) > 180 || loc.accuracy < 0 || loc.accuracy > 100_000) {
    throw new HttpError(400, '位置信息不正确');
  }
  return loc;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g;

export function parseCaption(v: unknown): string {
  if (v !== undefined && v !== null && typeof v !== 'string') throw new HttpError(400, '说明格式不正确');
  const s = String(v ?? '').replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length > CHECKIN_LIMITS.caption) throw new HttpError(400, `说明最多 ${CHECKIN_LIMITS.caption} 字`);
  return s;
}

export function parseVisibility(v: unknown): CheckinVisibility {
  if (v === undefined || v === null || v === '') return 'all';
  if (v === 'all' || v === 'buddies') return v;
  throw new HttpError(400, '请选择谁可以看到这次打卡');
}

/** 手选地点只能来自校园楼栋目录，不能提交任意水印文字。 */
export function parsePlaceId(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'string' && getCampusPlace(v)) return v;
  throw new HttpError(400, '请选择有效的校园楼栋');
}

// ---------- 创建 ----------

/** 过去 24 小时内的打卡次数（含已删除的，删掉重拍不能绕过限制） */
export const recentCount = (userId: number) =>
  q.get<{ n: number }>("SELECT COUNT(*) n FROM checkins WHERE user_id = ? AND created_at > datetime('now', '-1 day')", userId)!.n;

/** 盖章的线程与排队都已占满，或磁盘空间不足：此时不要消耗拍照凭证，直接请用户稍后再试 */
export function assertCanStamp() {
  if (stampPool.saturated) throw new HttpError(503, '现在打卡的同学有点多，请稍等几秒再按快门');
  assertStorageAvailable();
}

/**
 * 盖章并保存：时间取服务器收到照片的时刻，地点由服务器根据经纬度换算，只保存地点文字。
 * 调用前必须已经校验并消耗了拍照凭证。盖章在工作线程中进行，期间主线程照常处理其他请求。
 */
export async function createCheckin(
  userId: number,
  input: { jpeg: Buffer; caption: string; visibility: CheckinVisibility; location: GeoInput | null; placeId?: string | null },
  now = new Date(),
): Promise<CheckinRow> {
  const placeLabel = placeLabelFor(input.location, input.placeId);
  const stampText = stampTimeText(now);
  let stamped: Buffer;
  try {
    stamped = await stampPool.stamp(input.jpeg, [placeLabel, stampText]);
  } catch (error) {
    const reason = error instanceof StampError ? error.reason : 'failed';
    if (reason === 'busy') throw new HttpError(503, '现在打卡的同学有点多，请稍等几秒再按快门');
    if (reason === 'timeout') throw new HttpError(503, '照片处理超时，请重新拍照');
    throw new HttpError(400, '照片无法识别，请重新拍照');
  }
  if (stamped.length > CHECKIN_LIMITS.maxStampedBytes) throw new HttpError(400, '照片过大，请重新拍照');
  const name = `${crypto.randomBytes(12).toString('hex')}.jpg`;
  const file = path.join(UPLOAD_DIR, name);
  await fs.promises.writeFile(file, stamped);
  try {
    const id = tx(() => {
      // 盖章期间账号可能已经注销：不能再为它保存照片
      if (!q.get('SELECT 1 FROM users WHERE id = ? AND activated = 1 AND password_hash IS NOT NULL', userId)) throw new HttpError(401, '请先登录');
      q.run("INSERT INTO uploads (name, user_id, kind, bytes) VALUES (?, ?, 'checkin', ?)", name, userId, stamped.length);
      const id = Number(
        q.run(
          `INSERT INTO checkins (user_id, image, caption, place_label, stamped_at, local_date, stamp_text, visibility)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          userId, name, input.caption, placeLabel, sqliteTime(now), beijingDate(now), stampText, input.visibility,
        ).lastInsertRowid,
      );
      applyAutoModeration('checkins', id, input.caption);
      return id;
    });
    return getCheckinRow(id)!;
  } catch (e) {
    fs.rmSync(file, { force: true });
    throw e;
  }
}

// ---------- 可见性 ----------

export function getCheckinRow(id: number): CheckinRow | undefined {
  if (!Number.isSafeInteger(id) || id <= 0) return undefined;
  return q.get<CheckinRow>('SELECT * FROM checkins WHERE id = ?', id);
}

/**
 * 别人能否看到：未删除、未撤下、未互相排除，且可见范围是「所有同学」或与作者有进行中的配对。
 * 作者本人总能看到自己未删除、未撤下的打卡。管理员由调用方另行判断。
 */
export function canViewCheckin(viewerId: number, id: number): boolean {
  const row = getCheckinRow(id);
  if (!row || row.deleted || row.taken_down) return false;
  if (row.user_id === viewerId) return true;
  if (isExcluded(viewerId, row.user_id)) return false;
  return row.visibility === 'all' || !!activeMatchBetween(viewerId, row.user_id);
}

/** 详情页：作者本人与管理员可以看到被撤下的打卡（作者看到撤下原因）；已删除的对所有人都不可见 */
export function checkinVisibleTo(row: CheckinRow | undefined, viewer: Viewer): row is CheckinRow {
  if (!row || row.deleted) return false;
  if (row.user_id === viewer.id || viewer.role === 'admin') return true;
  return canViewCheckin(viewer.id, row.id);
}

/** SQL 片段：别人发布的打卡 c 对当前用户可见（需要 4 个当前用户 id 参数） */
export const OTHERS_VISIBLE_SQL = `c.taken_down = 0
  AND NOT EXISTS (SELECT 1 FROM exclusions e WHERE (e.user_id = ? AND e.target_id = c.user_id) OR (e.user_id = c.user_id AND e.target_id = ?))
  AND (c.visibility = 'all' OR EXISTS (
    SELECT 1 FROM matches m WHERE m.status = 'active' AND m.user_a = min(c.user_id, ?) AND m.user_b = max(c.user_id, ?)
  ))`;

export type FeedScope = 'all' | 'buddies' | 'mine';

/** 打卡列表：按时间倒序分页（before 为上一页最后一条的 id） */
export function listCheckins(viewer: Viewer, scope: FeedScope, before: number | null): { rows: CheckinRow[]; hasMore: boolean } {
  const uid = viewer.id;
  const limit = CHECKIN_LIMITS.pageSize;
  const cursor = before ? 'AND c.id < ?' : '';
  const cursorParams = before ? [before] : [];
  let rows: CheckinRow[];
  if (scope === 'mine') {
    // 自己的打卡（含被撤下的，显示原因）
    rows = q.all<CheckinRow>(
      `SELECT c.* FROM checkins c WHERE c.deleted = 0 AND c.user_id = ? ${cursor} ORDER BY c.id DESC LIMIT ?`,
      uid, ...cursorParams, limit + 1,
    );
  } else if (scope === 'buddies') {
    // 与我有进行中配对的同学（私聊里的搭子）的打卡
    rows = q.all<CheckinRow>(
      `SELECT c.* FROM checkins c
       WHERE c.deleted = 0 AND c.user_id <> ? AND c.user_id IN (
         SELECT CASE WHEN m.user_a = ? THEN m.user_b ELSE m.user_a END FROM matches m
         WHERE m.status = 'active' AND (m.user_a = ? OR m.user_b = ?)
       ) AND ${OTHERS_VISIBLE_SQL} ${cursor}
       ORDER BY c.id DESC LIMIT ?`,
      uid, uid, uid, uid, uid, uid, uid, uid, ...cursorParams, limit + 1,
    );
  } else {
    rows = q.all<CheckinRow>(
      `SELECT c.* FROM checkins c
       WHERE c.deleted = 0 AND ((c.user_id = ? AND c.taken_down = 0) OR (c.user_id <> ? AND ${OTHERS_VISIBLE_SQL})) ${cursor}
       ORDER BY c.id DESC LIMIT ?`,
      uid, uid, uid, uid, uid, uid, ...cursorParams, limit + 1,
    );
  }
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

// ---------- 序列化 ----------

/** 作者：只用系统昵称；主页对我可见且照片公开时才返回封面 */
function authorResolver(viewerId: number) {
  const cache = new Map<number, ForumAuthor>();
  return (authorId: number): ForumAuthor => {
    const cached = cache.get(authorId);
    if (cached) return cached;
    const row = getProfileRow(authorId);
    let author: ForumAuthor;
    if (!row) {
      author = { id: authorId, nickname: '匿名同学', cover: null, profileVisible: false };
    } else {
      const d = parseData(row);
      const visible = !!row.published && !row.taken_down && hasPrivacyConsent(d) && (authorId === viewerId || !isExcluded(viewerId, authorId));
      author = { id: authorId, nickname: row.nickname, cover: visible && d.photoVisibility === 'public' ? d.photos[0] ?? null : null, profileVisible: visible };
    }
    cache.set(authorId, author);
    return author;
  };
}

/** 批量统计点赞与评论数（评论不含已删除、被撤下与我互相排除者的） */
function engagement(ids: number[], viewerId: number) {
  const out = new Map<number, { likeCount: number; liked: boolean; commentCount: number }>(
    ids.map((id) => [id, { likeCount: 0, liked: false, commentCount: 0 }]),
  );
  if (!ids.length) return out;
  const marks = ids.map(() => '?').join(',');
  for (const r of q.all<{ target_id: number; n: number; mine: number }>(
    `SELECT target_id, COUNT(*) n, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) mine FROM forum_likes
     WHERE target_type = 'checkin' AND target_id IN (${marks}) GROUP BY target_id`,
    viewerId, ...ids,
  )) {
    const e = out.get(r.target_id)!;
    e.likeCount = r.n;
    e.liked = r.mine > 0;
  }
  for (const r of q.all<{ target_id: number; n: number }>(
    `SELECT c.target_id, COUNT(*) n FROM forum_comments c
     WHERE c.target_type = 'checkin' AND c.target_id IN (${marks}) AND c.deleted = 0 AND c.taken_down = 0
       AND (c.user_id = ? OR NOT EXISTS (SELECT 1 FROM exclusions e WHERE (e.user_id = ? AND e.target_id = c.user_id) OR (e.user_id = c.user_id AND e.target_id = ?)))
     GROUP BY c.target_id`,
    ...ids, viewerId, viewerId, viewerId,
  )) out.get(r.target_id)!.commentCount = r.n;
  return out;
}

export function toCheckins(rows: CheckinRow[], viewer: Viewer): Checkin[] {
  const resolve = authorResolver(viewer.id);
  const eng = engagement(rows.map((r) => r.id), viewer.id);
  return rows.map((r) => {
    const e = eng.get(r.id)!;
    const canSeeModeration = r.user_id === viewer.id || viewer.role === 'admin';
    return {
      id: r.id,
      image: r.image,
      caption: r.caption,
      placeLabel: r.place_label,
      stampedAt: iso(r.stamped_at)!,
      stampText: r.stamp_text,
      visibility: r.visibility,
      author: resolve(r.user_id),
      likeCount: e.likeCount,
      liked: e.liked,
      commentCount: e.commentCount,
      isMine: r.user_id === viewer.id,
      ...reviewState(r, canSeeModeration),
      takenDown: canSeeModeration && !!r.taken_down && !r.auto_held,
      takedownReason: canSeeModeration && r.taken_down && !r.auto_held ? r.takedown_reason : null,
    };
  });
}

export const toCheckin = (row: CheckinRow, viewer: Viewer) => toCheckins([row], viewer)[0];

// ---------- 统计 ----------

/**
 * streak：截至今天（今天还没打卡则截至昨天）连续有打卡的北京日期数；
 * total：累计打卡次数。已删除与被撤下的不计入。
 */
export function statsFor(userId: number, now = new Date()): CheckinStats {
  const dates = q
    .all<{ local_date: string }>(
      'SELECT DISTINCT local_date FROM checkins WHERE user_id = ? AND deleted = 0 AND taken_down = 0 ORDER BY local_date DESC',
      userId,
    )
    .map((r) => r.local_date);
  const total = q.get<{ n: number }>('SELECT COUNT(*) n FROM checkins WHERE user_id = ? AND deleted = 0 AND taken_down = 0', userId)!.n;
  const today = beijingDate(now);
  const have = new Set(dates);
  const checkedInToday = have.has(today);
  let day = checkedInToday ? today : shiftDate(today, -1);
  let streak = 0;
  while (have.has(day)) {
    streak++;
    day = shiftDate(day, -1);
  }
  return { streak, total, checkedInToday };
}

// ---------- 登记 ----------

const excerpt = (text: string, n = 24) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};

const checkinLabel = (id: number) => {
  const row = getCheckinRow(id);
  if (!row) return '（已删除）';
  return [`打卡 · ${row.place_label}`, row.caption ? excerpt(row.caption) : ''].filter(Boolean).join(' · ');
};

registerContentTarget('checkin', {
  canView: canViewCheckin,
  ownerOf: (id) => getCheckinRow(id)?.user_id ?? null,
  label: checkinLabel,
  link: (id) => `/community/checkins/${id}`,
});

registerReportTarget('checkin', {
  // 能看到才能举报；不能举报自己的打卡
  canReport: (reporterId, id) => canViewCheckin(reporterId, id) && getCheckinRow(id)?.user_id !== reporterId,
  label: checkinLabel,
  ownerOf: (id) => getCheckinRow(id)?.user_id ?? null,
  // 作者之后可能删除打卡，举报时留存文字信息与照片文件名（管理员可直接打开照片）
  snapshot: (id) => {
    const row = getCheckinRow(id);
    return row ? `照片：${row.image}\n水印：${row.place_label} ${row.stamp_text}\n说明：${row.caption || '（无）'}` : '';
  },
});

// 打卡照片：只有当照片属于一条对我可见的打卡时才允许读取（本人与管理员在公共路由中已放行）
registerFileAccess('checkin', (viewer, ownerId, name) => {
  const row = q.get<{ id: number }>('SELECT id FROM checkins WHERE image = ? AND user_id = ?', name, ownerId);
  return !!row && canViewCheckin(viewer.id, row.id);
});
