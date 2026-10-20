// 抽检与判无效：每周随机抽检 + 系统标记可疑打卡、获奖组合全量复核、判无效后的申诉（必须换人复核）、
// 确认作弊后取消评奖资格，以及用于标记可疑情况的设备记录。
import crypto from 'node:crypto';
import type { Request } from 'express';
import { addDays, mondayOf } from '../shared/activity.ts';
import type { CheckinInvalid } from '../shared/types.ts';
import { HttpError } from './auth.ts';
import { activityConfig } from './activityConfig.ts';
import { pairById } from './buddyState.ts';
import { getSetting, iso, q, setSetting, tx } from './db.ts';
import { sendInvalidCheckinMail } from './mail.ts';
import { beijingTime, notify } from './notify.ts';
import { leaderboard, sameEvents, scoredThrough, touchScores, weekEvents } from './scoring.ts';

export type AuditFlag = 'same_device' | 'near_same_time' | 'shared_device';

export const FLAG_LABELS: Record<AuditFlag, string> = {
  same_device: '两人的打卡来自同一台设备',
  near_same_time: '两人几乎同时提交（相差 2 秒以内）',
  shared_device: '两人的账号在同一台设备上登录过',
};

const NEAR_SAME_MS = 2_000;

// ---------- 设备记录 ----------

const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** 设备记录的保留天数 */
const DEVICE_RETENTION_DAYS = 180;

/** 浏览器随请求带上的随机设备编号（X-Device-Id）；库里只存它的哈希 */
export function deviceHashOf(req: Request): string | null {
  const raw = req.headers['x-device-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !DEVICE_RE.test(value)) return null;
  return crypto.createHash('sha256').update(`device:${value}`).digest('hex');
}

export function recordDevice(uid: number, hash: string | null) {
  if (!hash) return;
  q.run(
    `INSERT INTO device_seen (device_hash, user_id) VALUES (?, ?)
     ON CONFLICT(device_hash, user_id) DO UPDATE SET last_seen = datetime('now')`,
    hash, uid,
  );
}

export function sharedDevice(a: number, b: number): boolean {
  return !!q.get(
    'SELECT 1 FROM device_seen x JOIN device_seen y ON y.device_hash = x.device_hash WHERE x.user_id = ? AND y.user_id = ? LIMIT 1', a, b,
  );
}

function purgeOldDevices() {
  q.run('DELETE FROM device_seen WHERE last_seen < datetime(\'now\', ?)', `-${DEVICE_RETENTION_DAYS} days`);
  q.run('UPDATE checkins SET device_hash = NULL WHERE device_hash IS NOT NULL AND created_at < datetime(\'now\', ?)', `-${DEVICE_RETENTION_DAYS} days`);
}

// ---------- 判无效 ----------

interface CheckinLite {
  id: number;
  user_id: number;
  caption: string;
  place_label: string;
  stamp_text: string;
  local_date: string;
  deleted: number;
  invalid: number;
  invalid_reason: string | null;
  invalid_at: string | null;
  invalid_by: number | null;
}

const checkinLite = (id: number) => q.get<CheckinLite>(
  'SELECT id, user_id, caption, place_label, stamp_text, local_date, deleted, invalid, invalid_reason, invalid_at, invalid_by FROM checkins WHERE id = ?', id,
);

const labelOf = (c: Pick<CheckinLite, 'place_label' | 'stamp_text'>) => `${c.place_label} · ${c.stamp_text}`;

function log(staffId: number, action: string, checkin: CheckinLite, reason = '') {
  q.run(
    "INSERT INTO moderation_logs (admin_id, action, target_type, target_id, target_user_id, target_label, reason) VALUES (?, ?, 'checkin', ?, ?, ?, ?)",
    staffId, action, checkin.id, checkin.user_id, labelOf(checkin), reason,
  );
}

const deadlineOf = (invalidAt: string) => new Date(Date.parse(`${invalidAt.replace(' ', 'T')}Z`) + activityConfig().appealHours * 3600_000);

/** 判无效：打卡照常显示，但不计分；通知本人（站内 + 邮件）并说明如何申诉 */
export async function invalidateCheckin(checkinId: number, staffId: number, reason: string): Promise<{ emailStatus: string }> {
  const row = checkinLite(checkinId);
  if (!row || row.deleted) throw new HttpError(404, '打卡不存在或已删除');
  if (row.invalid) throw new HttpError(409, '这条打卡已经判为无效');
  const email = tx(() => {
    q.run("UPDATE checkins SET invalid = 1, invalid_reason = ?, invalid_at = datetime('now'), invalid_by = ? WHERE id = ?", reason, staffId, checkinId);
    q.run(
      `INSERT INTO checkin_audits (checkin_id, week, source, status, reviewer_id, reviewed_at) VALUES (?, ?, 'manual', 'invalid', ?, datetime('now'))
       ON CONFLICT(checkin_id) DO UPDATE SET status = 'invalid', reviewer_id = excluded.reviewer_id, reviewed_at = excluded.reviewed_at`,
      checkinId, mondayOf(row.local_date), staffId,
    );
    log(staffId, 'invalidate', row, reason);
    const updated = checkinLite(checkinId)!;
    const deadline = beijingTime(deadlineOf(updated.invalid_at!));
    notify(row.user_id, '一次打卡没有计分', `你的打卡「${labelOf(row)}」经审核判为无效，原因：${reason}。如有异议，可在 ${deadline} 前在这条打卡里申诉一次。`, `/community/checkins/${checkinId}`);
    return { to: q.get<{ email: string }>('SELECT email FROM users WHERE id = ?', row.user_id)?.email ?? '', deadline };
  });
  touchScores();
  const emailStatus = email.to && !email.to.endsWith('@deleted.invalid')
    ? await sendInvalidCheckinMail(email.to, labelOf(row), reason, beijingTime(), email.deadline, `/community/checkins/${checkinId}`)
    : 'skipped';
  return { emailStatus };
}

/** 抽检通过：打卡有效 */
export function passAudit(checkinId: number, staffId: number) {
  const row = checkinLite(checkinId);
  if (!row) throw new HttpError(404, '打卡不存在');
  if (row.invalid) throw new HttpError(409, '这条打卡已判为无效，如需恢复请走申诉复核');
  q.run("UPDATE checkin_audits SET status = 'valid', reviewer_id = ?, reviewed_at = datetime('now') WHERE checkin_id = ?", staffId, checkinId);
  log(staffId, 'audit_pass', row);
}

/** 只返回给作者与审核人员 */
export function invalidInfo(row: { id: number; invalid?: number; invalid_reason?: string | null; invalid_at?: string | null }): CheckinInvalid | null {
  if (!row.invalid || !row.invalid_at) return null;
  const appeal = q.get<{ status: 'open' | 'upheld' | 'overturned' }>('SELECT status FROM checkin_appeals WHERE checkin_id = ?', row.id);
  const deadline = deadlineOf(row.invalid_at);
  return {
    reason: row.invalid_reason ?? '',
    at: iso(row.invalid_at)!,
    appeal: appeal?.status ?? 'none',
    canAppeal: !appeal && deadline.getTime() > Date.now(),
    appealDeadline: deadline.toISOString(),
  };
}

// ---------- 申诉 ----------

export const APPEAL_MAX = 300;

export function createAppeal(uid: number, checkinId: number, body: unknown) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw new HttpError(400, '请写一下申诉理由');
  if (text.length > APPEAL_MAX) throw new HttpError(400, `申诉理由最多 ${APPEAL_MAX} 字`);
  const row = checkinLite(checkinId);
  if (!row || row.deleted || row.user_id !== uid) throw new HttpError(404, '打卡不存在或已删除');
  if (!row.invalid || !row.invalid_at) throw new HttpError(409, '这条打卡没有被判无效');
  if (q.get('SELECT 1 FROM checkin_appeals WHERE checkin_id = ?', checkinId)) throw new HttpError(409, '每条打卡只能申诉一次');
  if (deadlineOf(row.invalid_at).getTime() <= Date.now()) throw new HttpError(409, '已经过了申诉期限');
  q.run('INSERT INTO checkin_appeals (checkin_id, user_id, body) VALUES (?, ?, ?)', checkinId, uid, text);
}

/** 复核申诉：必须由判无效以外的另一位审核人员处理 */
export function decideAppeal(appealId: number, staffId: number, decision: unknown, note: unknown) {
  if (decision !== 'upheld' && decision !== 'overturned') throw new HttpError(400, '请选择维持或撤销');
  const text = typeof note === 'string' ? note.trim().slice(0, 200) : '';
  const appeal = q.get<{ id: number; checkin_id: number; status: string }>('SELECT id, checkin_id, status FROM checkin_appeals WHERE id = ?', appealId);
  if (!appeal) throw new HttpError(404, '申诉不存在');
  if (appeal.status !== 'open') throw new HttpError(409, '这条申诉已经处理过了');
  const row = checkinLite(appeal.checkin_id);
  if (!row) throw new HttpError(404, '打卡不存在');
  if (row.invalid_by === staffId) throw new HttpError(403, '申诉需要由另一位审核员复核，不能由原来判无效的人处理');
  tx(() => {
    q.run("UPDATE checkin_appeals SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ?", decision, staffId, text, appealId);
    if (decision === 'overturned') {
      q.run('UPDATE checkins SET invalid = 0, invalid_reason = NULL, invalid_at = NULL, invalid_by = NULL WHERE id = ?', row.id);
      q.run("UPDATE checkin_audits SET status = 'valid', reviewer_id = ?, reviewed_at = datetime('now') WHERE checkin_id = ?", staffId, row.id);
    }
    log(staffId, decision === 'overturned' ? 'appeal_overturned' : 'appeal_upheld', row, text);
    notify(
      row.user_id,
      decision === 'overturned' ? '申诉通过，打卡恢复计分' : '申诉未通过',
      decision === 'overturned'
        ? `你的打卡「${labelOf(row)}」经复核恢复有效，会重新计入搭子积分。`
        : `你的打卡「${labelOf(row)}」经另一位审核员复核，维持无效。${text ? `说明：${text}` : ''}`,
      `/community/checkins/${row.id}`,
    );
  });
  touchScores();
}

// ---------- 抽检 ----------

function enqueue(checkinId: number, week: string, source: 'random' | 'flag' | 'prize', flags: AuditFlag[] = []) {
  const existing = q.get<{ flags: string }>('SELECT flags FROM checkin_audits WHERE checkin_id = ?', checkinId);
  if (!existing) {
    q.run('INSERT INTO checkin_audits (checkin_id, week, source, flags) VALUES (?, ?, ?, ?)', checkinId, week, source, JSON.stringify(flags));
    return true;
  }
  if (flags.length) {
    const merged = [...new Set([...(JSON.parse(existing.flags) as AuditFlag[]), ...flags])];
    q.run('UPDATE checkin_audits SET flags = ? WHERE checkin_id = ?', JSON.stringify(merged), checkinId);
  }
  return false;
}

/** 一次相同事件的可疑标记 */
export function eventFlags(pair: { user_a: number; user_b: number }, event: { a: { device: string | null }; b: { device: string | null }; gapMs: number }, shared?: boolean): AuditFlag[] {
  const flags: AuditFlag[] = [];
  if (event.a.device && event.a.device === event.b.device) flags.push('same_device');
  if (event.gapMs <= NEAR_SAME_MS) flags.push('near_same_time');
  if (shared ?? sharedDevice(pair.user_a, pair.user_b)) flags.push('shared_device');
  return flags;
}

/** 为每个已经结束、还没抽过的赛季周生成抽检名单：随机抽取 + 全部可疑打卡 */
export function ensureWeeklySamples(now = new Date()) {
  const config = activityConfig();
  const through = scoredThrough(now, config);
  if (!through) return;
  for (let week = config.seasonStart; week <= through; week = addDays(week, 7)) {
    const key = `audit_sample_${week}`;
    if (getSetting(key, '')) continue;
    tx(() => {
      const events = weekEvents(week, config);
      const sharedCache = new Map<number, boolean>();
      const ids: number[] = [];
      for (const { pair, event } of events) {
        if (!sharedCache.has(pair.id)) sharedCache.set(pair.id, sharedDevice(pair.user_a, pair.user_b));
        const flags = eventFlags(pair, event, sharedCache.get(pair.id));
        if (flags.length) for (const c of [event.a, event.b]) enqueue(c.id, week, 'flag', flags);
        ids.push(event.a.id, event.b.id);
      }
      const want = config.auditRate > 0 && ids.length ? Math.max(1, Math.ceil((ids.length * config.auditRate) / 100)) : 0;
      // Fisher–Yates：用加密随机数打乱，抽检结果不可预测
      for (let i = ids.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      for (const id of ids.slice(0, want)) enqueue(id, week, 'random');
      setSetting(key, new Date().toISOString());
    });
  }
}

/** 获奖名次内（含名次边界上的并列）的组合：所有计分打卡加入复核 */
export function enqueuePrizeReview(now = new Date()): { pairs: number; added: number } {
  const config = activityConfig();
  const board = leaderboard(now);
  const winners = board.items.filter((item) => item.rank <= config.prizePairs);
  let added = 0;
  tx(() => {
    for (const item of winners) {
      const from = item.pair.starts_on > config.seasonStart ? item.pair.starts_on : config.seasonStart;
      if (!board.through) continue;
      for (const event of sameEvents(item.pair, from, board.through, config)) {
        for (const c of [event.a, event.b]) if (enqueue(c.id, mondayOf(event.date), 'prize', eventFlags(item.pair, event))) added++;
      }
    }
  });
  return { pairs: winners.length, added };
}

// ---------- 取消评奖资格 ----------

export function disqualifyPair(pairId: number, staffId: number, reason: unknown) {
  const text = typeof reason === 'string' ? reason.trim().slice(0, 200) : '';
  if (!text) throw new HttpError(400, '请写明取消资格的原因');
  const pair = pairById(pairId);
  if (!pair) throw new HttpError(404, '组合不存在');
  tx(() => {
    for (const uid of [pair.user_a, pair.user_b]) {
      q.run('INSERT OR REPLACE INTO activity_disqualified (user_id, reason, admin_id) VALUES (?, ?, ?)', uid, text, staffId);
      notify(uid, '已取消本赛季评奖资格', `经核实，你们的打卡存在作弊行为（${text}），已取消本赛季评奖资格。平台的其他功能可以照常使用。如有异议请联系树仁书院学生发展中心。`, '/me');
    }
    q.run(
      "INSERT INTO moderation_logs (admin_id, action, target_type, target_id, target_label, reason) VALUES (?, 'disqualify', 'buddy_pair', ?, ?, ?)",
      staffId, pair.id, `搭子组合 #${pair.id}`, text,
    );
  });
  touchScores();
}

export function requalifyPair(pairId: number, staffId: number) {
  const pair = pairById(pairId);
  if (!pair) throw new HttpError(404, '组合不存在');
  tx(() => {
    q.run('DELETE FROM activity_disqualified WHERE user_id IN (?, ?)', pair.user_a, pair.user_b);
    q.run(
      "INSERT INTO moderation_logs (admin_id, action, target_type, target_id, target_label, reason) VALUES (?, 'requalify', 'buddy_pair', ?, ?, '')",
      staffId, pair.id, `搭子组合 #${pair.id}`,
    );
  });
  touchScores();
}

// ---------- 定时任务 ----------

/** 启动时与之后每小时：生成到期的抽检名单、清理过期的设备记录 */
export function startAuditMaintenance() {
  const run = () => {
    try {
      ensureWeeklySamples();
      purgeOldDevices();
    } catch (error) {
      console.error('[audit] 定时任务失败', error);
    }
  };
  setTimeout(run, 5_000).unref();
  setInterval(run, 3600_000).unref();
}

