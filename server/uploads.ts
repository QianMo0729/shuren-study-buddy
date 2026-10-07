// 上传文件的存储管理：每人配额、磁盘余量检查，以及不再被任何内容引用的文件的清理。
// 上传接口在 server/routes/misc.ts；打卡照片由 server/checkins.ts 保存。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './auth.ts';
import './community.ts';
import { config } from './config.ts';
import { getSetting, q, setSetting } from './db.ts';

export const UPLOAD_DIR = path.join(config.dataDir, 'uploads');
export const UPLOAD_NAME = /^[a-f0-9]{24}\.(jpg|png|webp)$/;

/** 上传后超过这么久仍没有被任何内容引用的文件会被清理（发帖前先上传的图片在这段时间内可以正常使用） */
export const ORPHAN_GRACE_HOURS = 24;
const SWEEP_EVERY_MS = 6 * 3600_000;
const SWEEP_PAGE = 300;

// 旧库中的文件没有记录大小：启动时补记一次
if (getSetting('uploads_bytes_recorded', '') !== '1') {
  for (const { name } of q.all<{ name: string }>('SELECT name FROM uploads WHERE bytes = 0')) {
    if (!UPLOAD_NAME.test(name)) continue;
    try {
      q.run('UPDATE uploads SET bytes = ? WHERE name = ?', fs.statSync(path.join(UPLOAD_DIR, name)).size, name);
    } catch { /* 文件已不存在，占用按 0 计 */ }
  }
  setSetting('uploads_bytes_recorded', '1');
}

/** 数据目录所在磁盘快满时拒绝写入新图片，给数据库留出空间 */
export function assertStorageAvailable() {
  let free: number;
  try {
    const stat = fs.statfsSync(config.dataDir);
    free = stat.bavail * stat.bsize;
  } catch {
    return; // 个别文件系统不支持查询余量
  }
  if (free < config.minFreeDiskBytes) throw new HttpError(507, '服务器存储空间不足，暂时无法保存图片，请稍后再试');
}

/** 该同学通过上传接口保存的图片合计大小（打卡照片另由每日次数限制，不计入） */
export const uploadedBytes = (userId: number) =>
  q.get<{ n: number }>("SELECT COALESCE(SUM(bytes), 0) n FROM uploads WHERE user_id = ? AND kind <> 'checkin'", userId)!.n;

/** 再存入 size 字节是否超出每人配额；超出时先清理本人已不再使用的旧图片再判断一次 */
export function assertUploadQuota(userId: number, size: number) {
  if (uploadedBytes(userId) + size <= config.uploadQuotaBytes) return;
  sweepOrphanUploads(userId);
  if (uploadedBytes(userId) + size > config.uploadQuotaBytes) {
    throw new HttpError(413, `你的图片空间已满（上限 ${Math.round(config.uploadQuotaBytes / 1024 / 1024)}MB）。删除不再需要的帖子或照片后，空间会在一天内释放`);
  }
}

/** 写入文件并登记；登记失败时删掉刚写入的文件，不留下没有记录的文件 */
export function storeUpload(userId: number, kind: string, ext: 'jpg' | 'png' | 'webp', data: Buffer): string {
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  const file = path.join(UPLOAD_DIR, name);
  fs.writeFileSync(file, data);
  try {
    q.run('INSERT INTO uploads (name, user_id, kind, bytes) VALUES (?, ?, ?, ?)', name, userId, kind, data.length);
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw error;
  }
  return name;
}

// 一个文件仍在使用，是指它出现在：本人的资料或问卷草稿里、本人未删除的社区帖子或打卡里，
// 或者一条尚未处理的举报留存的快照里（作者事后修改、删除内容，不影响管理员查看证据）。
// 按文件名在原文中查找，资料格式变化或无法解析时仍然视为在用。
const UNREFERENCED = `
  NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = u.user_id AND instr(p.data, u.name) > 0)
  AND NOT EXISTS (SELECT 1 FROM profile_drafts d WHERE d.user_id = u.user_id AND instr(d.data, u.name) > 0)
  AND NOT EXISTS (SELECT 1 FROM forum_posts f WHERE f.user_id = u.user_id AND f.deleted = 0 AND instr(f.images, u.name) > 0)
  AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.user_id = u.user_id AND c.deleted = 0 AND c.image = u.name)
  AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.status = 'open' AND instr(r.snapshot, u.name) > 0)`;

function removeUpload(name: string): boolean {
  try {
    if (UPLOAD_NAME.test(name)) fs.rmSync(path.join(UPLOAD_DIR, name), { force: true });
  } catch {
    console.error('[uploads] 无法删除不再使用的文件，下次清理时重试');
    return false;
  }
  q.run('DELETE FROM uploads WHERE name = ?', name);
  return true;
}

/** 清理某位同学已超过宽限期、不再被引用的文件；返回清理的数量 */
export function sweepOrphanUploads(userId: number): number {
  const rows = q.all<{ name: string }>(
    `SELECT u.name FROM uploads u WHERE u.user_id = ? AND u.created_at < datetime('now', ?) AND ${UNREFERENCED}`,
    userId, `-${ORPHAN_GRACE_HOURS} hours`,
  );
  return rows.filter((row) => removeUpload(row.name)).length;
}

/**
 * 全站清理的一页：按文件名顺序检查 after 之后的若干条记录，每次只做有限的工作。
 * 返回下一页的起点（null 表示已经检查完）与本页清理的数量。
 */
export function sweepOrphanPage(after = '', pageSize = SWEEP_PAGE): { next: string | null; removed: number } {
  const rows = q.all<{ name: string; orphan: number }>(
    `SELECT u.name, (u.created_at < datetime('now', ?) AND ${UNREFERENCED}) AS orphan
     FROM uploads u WHERE u.name > ? ORDER BY u.name LIMIT ?`,
    `-${ORPHAN_GRACE_HOURS} hours`, after, pageSize,
  );
  const removed = rows.filter((row) => row.orphan && removeUpload(row.name)).length;
  return { next: rows.length === pageSize ? rows[rows.length - 1].name : null, removed };
}

/** 服务启动后定期做全站清理：分页进行，页与页之间让出主线程 */
export function startUploadMaintenance() {
  const pass = (after = '', removed = 0) => {
    let page: ReturnType<typeof sweepOrphanPage>;
    try {
      page = sweepOrphanPage(after);
    } catch (error) {
      console.error('[uploads] 清理不再使用的文件时出错', error);
      return;
    }
    const total = removed + page.removed;
    if (page.next !== null) setTimeout(pass, 200, page.next, total).unref();
    else if (total) console.log(`[uploads] 已清理 ${total} 个不再使用的文件`);
  };
  setTimeout(pass, 60_000).unref();
  setInterval(pass, SWEEP_EVERY_MS).unref();
}
