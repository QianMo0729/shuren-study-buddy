import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPORT_REASONS } from '../../shared/options.ts';
import { speciesOfNickname } from '../../shared/species.ts';
import { HttpError, canShowDevCodes, rateLimit, requireUser } from '../auth.ts';
import { config } from '../config.ts';
import { getProfileRow, parseData } from '../profiles.ts';
import { hasPrivacyConsent } from '../../shared/profileRules.ts';
import { isExcluded } from '../connections.ts';
import { iso, q } from '../db.ts';
import { fileAccessFor, reportTargetFor } from '../social.ts';
import type { ReportTargetType } from '../../shared/types.ts';

export const miscRouter = Router();

const UPLOAD_DIR = path.join(config.dataDir, 'uploads');
const MAX_BYTES = 5 * 1024 * 1024;

function sniff(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

// 图片以 dataURL 上传（前端已压缩），落盘后仅登录用户可访问。
// 打卡照片（kind = checkin）不能走这里，只能通过实时拍照的打卡接口由服务器盖章后保存。
miscRouter.post('/uploads', requireUser, (req, res) => {
  rateLimit(`upload:${req.user!.id}`, 60, 60 * 60_000);
  if (req.body?.kind === 'checkin') throw new HttpError(400, '打卡照片只能在打卡页面用相机实时拍摄');
  const kind = req.body?.kind === 'timetable' ? 'timetable' : req.body?.kind === 'forum' ? 'forum' : 'photo';
  const m = /^data:image\/[a-z+]+;base64,(.+)$/.exec(String(req.body?.dataUrl ?? ''));
  if (!m) throw new HttpError(400, '图片格式不正确');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw new HttpError(400, '图片过大，请选择 5MB 以内的图片');
  const ext = sniff(buf);
  if (!ext) throw new HttpError(400, '仅支持 JPG / PNG / WebP 图片');
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  q.run('INSERT INTO uploads (name, user_id, kind) VALUES (?, ?, ?)', name, req.user!.id, kind);
  res.json({ name });
});

miscRouter.get('/files/:name', requireUser, (req, res) => {
  const name = String(req.params.name);
  if (!/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(name)) throw new HttpError(404, '文件不存在');
  const owner = q.get<{ user_id: number; kind: string }>('SELECT user_id, kind FROM uploads WHERE name = ?', name);
  if (!owner) throw new HttpError(404, '文件不存在');
  const uid = req.user!.id;
  if (uid !== owner.user_id && req.user!.role !== 'admin' && owner.kind !== 'photo' && owner.kind !== 'timetable') {
    // 社区图片、打卡照片等由各自模块判断可见性
    const allowed = fileAccessFor(owner.kind)?.({ id: uid, role: req.user!.role }, owner.user_id, name) ?? false;
    if (!allowed) throw new HttpError(404, '文件不存在');
  } else if (uid !== owner.user_id && req.user!.role !== 'admin') {
    const row = getProfileRow(owner.user_id);
    const data = row ? parseData(row) : null;
    if (!row?.published || row.taken_down || !data || !hasPrivacyConsent(data)
      || isExcluded(uid, owner.user_id) || owner.kind !== 'photo' || data.photoVisibility !== 'public' || !data.photos.includes(name)) {
      throw new HttpError(404, '文件不存在');
    }
  }
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) throw new HttpError(404, '文件不存在');
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(file);
});

// ---------- 通知 ----------

miscRouter.get('/notifications', requireUser, (req, res) => {
  const rows = q.all<any>('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60', req.user!.id);
  res.json({
    items: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, link: r.link, createdAt: iso(r.created_at), read: !!r.read })),
  });
});

miscRouter.post('/notifications/read-all', requireUser, (req, res) => {
  q.run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user!.id);
  res.json({ ok: true });
});

// ---------- 举报 ----------

const REPORT_TYPES: ReportTargetType[] = ['profile', 'post', 'forum_post', 'comment', 'checkin', 'message'];

miscRouter.post('/reports', requireUser, (req, res) => {
  rateLimit(`report:${req.user!.id}`, 20, 24 * 3600_000);
  const targetType: ReportTargetType = REPORT_TYPES.includes(req.body?.targetType) ? req.body.targetType : 'profile';
  const targetId = Number(req.body?.targetId);
  const reason = String(req.body?.reason ?? '');
  if (!Number.isInteger(targetId) || !REPORT_REASONS.includes(reason)) throw new HttpError(400, '请选择举报原因');
  const registered = reportTargetFor(targetType);
  const exists =
    targetType === 'post'
      ? q.get('SELECT 1 FROM posts WHERE id = ? AND deleted = 0', targetId)
      : targetType === 'profile'
        ? q.get('SELECT 1 FROM profiles WHERE user_id = ?', targetId)
        : registered?.canReport(req.user!.id, targetId);
  if (!exists) throw new HttpError(404, '举报对象不存在');
  // 举报人填写的说明不能伪造“被举报内容”快照段
  const userDetail = String(req.body?.detail ?? '').replaceAll('【被举报内容】', '').slice(0, 200);
  const snapshot = registered?.snapshot?.(targetId);
  const detail = snapshot ? `${userDetail}${userDetail ? '\n' : ''}【被举报内容】${snapshot.slice(0, 1000)}` : userDetail;
  const dup = q.get(
    "SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'",
    req.user!.id, targetType, targetId,
  );
  if (!dup) {
    q.run(
      'INSERT INTO reports (reporter_id, target_type, target_id, reason, detail) VALUES (?, ?, ?, ?, ?)',
      req.user!.id, targetType, targetId, reason, detail,
    );
  }
  res.json({ ok: true });
});

// ---------- 首页公开信息 ----------

// 首页展示的聚合数据：只有计数，不含任何个人信息
function landingStats() {
  const rows = q.all<{ data: string; nickname: string }>('SELECT data, nickname FROM profiles WHERE published = 1 AND taken_down = 0');
  const types: Record<string, number> = {};
  const plans: Record<string, number> = {};
  const species: Record<string, number> = {};
  for (const r of rows) {
    const sp = speciesOfNickname(r.nickname);
    if (sp) species[sp.slug] = (species[sp.slug] ?? 0) + 1;
    try {
      const d = JSON.parse(r.data);
      if (d.studyType) types[d.studyType] = (types[d.studyType] ?? 0) + 1;
      for (const t of d.planTags ?? []) plans[t] = (plans[t] ?? 0) + 1;
    } catch {}
  }
  const categories = Object.fromEntries(
    q.all<{ category: string; n: number }>(
      "SELECT category, COUNT(*) n FROM posts WHERE deleted = 0 AND taken_down = 0 AND status = 'open' GROUP BY category",
    ).map((r) => [r.category, r.n]),
  );
  const topPlans = Object.entries(plans).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return { types, topPlans, categories, species };
}

miscRouter.get('/meta', (req, res) => {
  res.json({
    breakdown: landingStats(),
    allowedDomains: config.allowedDomains,
    devMode: canShowDevCodes(req),
    stats: {
      profiles: q.get<{ n: number }>('SELECT COUNT(*) n FROM profiles WHERE published = 1 AND taken_down = 0')!.n,
      posts: q.get<{ n: number }>("SELECT COUNT(*) n FROM posts WHERE deleted = 0 AND taken_down = 0 AND status = 'open'")!.n,
      users: q.get<{ n: number }>('SELECT COUNT(*) n FROM users WHERE activated = 1')!.n,
    },
  });
});
