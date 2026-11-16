import crypto from 'node:crypto';
import { db, iso, q } from './db.ts';
import { HttpError, sha256 } from './auth.ts';

export const XMIND_LIMIT = 200;
export const XMIND_WAIT_MS = 30_000;
const VISIT_TTL_MS = 3_600_000;
const MN_EXPIRES = Date.parse('2027-02-13T00:00:00+08:00');

db.exec(`
CREATE TABLE IF NOT EXISTS benefit_visits (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS benefit_xmind (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_hash TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  consent_version TEXT NOT NULL DEFAULT 'xmind-2026-11',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS benefit_marginnote (
  code TEXT PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  claimed_at TEXT
);
`);

/** BEGIN IMMEDIATE also serializes quota checks across multiple API processes. */
function atomic<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function benefitStatus() {
  const count = q.get<{ n: number }>('SELECT count(*) AS n FROM benefit_xmind')!.n;
  const remaining = q.get<{ n: number }>('SELECT count(*) AS n FROM benefit_marginnote WHERE claimed_at IS NULL')!.n;
  const renewalTerms = process.env.MARGINNOTE_RENEWAL_TERMS?.trim() || '';
  return {
    xmind: { limit: XMIND_LIMIT, remaining: Math.max(0, XMIND_LIMIT - count), waitSeconds: XMIND_WAIT_MS / 1000 },
    marginnote: { remaining, enabled: !!renewalTerms && Date.now() < MN_EXPIRES, renewalTerms, redeemBefore: '2027-02-12' },
  };
}

export function startBenefitVisit(userId: number) {
  q.run('DELETE FROM benefit_visits WHERE started_at < ?', Date.now() - VISIT_TTL_MS);
  const token = crypto.randomBytes(32).toString('base64url');
  q.run('INSERT INTO benefit_visits (token_hash, user_id, started_at) VALUES (?, ?, ?)', sha256(token), userId, Date.now());
  return { token, waitSeconds: XMIND_WAIT_MS / 1000 };
}

export function registerXmind(userId: number, input: { token?: unknown; phone?: unknown; consent?: unknown }) {
  if (input.consent !== true) throw new HttpError(400, '请同意手机号用于本次 Xmind 点数发放');
  if (typeof input.phone !== 'string' || !/^1[3-9]\d{9}$/.test(input.phone.trim())) throw new HttpError(400, '请填写正确的 11 位手机号');
  if (typeof input.token !== 'string' || input.token.length > 100) throw new HttpError(400, '请重新打开活动页');
  const hash = sha256(input.token);
  return atomic(() => {
    const visit = q.get<{ user_id: number; started_at: number }>('SELECT * FROM benefit_visits WHERE token_hash = ?', hash);
    if (!visit || visit.user_id !== userId || Date.now() - visit.started_at >= VISIT_TTL_MS) throw new HttpError(400, '登记页面已过期，请重新打开活动页');
    // Retrying the same submission never consumes a second place, even when the list is full.
    const existing = q.get<{ id: number }>('SELECT id FROM benefit_xmind WHERE visit_hash = ?', hash);
    if (existing) return { id: existing.id };
    if (Date.now() - visit.started_at < XMIND_WAIT_MS) throw new HttpError(400, '请先浏览活动页满 30 秒');
    if (benefitStatus().xmind.remaining === 0) throw new HttpError(409, '200 份领取名额已满');
    const result = q.run('INSERT INTO benefit_xmind (visit_hash, phone) VALUES (?, ?)', hash, (input.phone as string).trim());
    return { id: Number(result.lastInsertRowid) };
  });
}

export function xmindRegistrations() {
  return q.all<{ id: number; phone: string; created_at: string }>('SELECT id, phone, created_at FROM benefit_xmind ORDER BY id DESC')
    .map((row) => ({ id: row.id, phone: row.phone, createdAt: iso(row.created_at)! }));
}

export function myMarginNoteCode(userId: number) {
  return q.get<{ code: string }>('SELECT code FROM benefit_marginnote WHERE user_id = ? AND claimed_at IS NOT NULL', userId)?.code ?? null;
}

export function claimMarginNote(userId: number) {
  return atomic(() => {
    const existing = myMarginNoteCode(userId);
    if (existing) return { code: existing };
    if (!benefitStatus().marginnote.enabled) throw new HttpError(409, '订阅福利暂未开放或已结束');
    const row = q.get<{ code: string }>('SELECT code FROM benefit_marginnote WHERE claimed_at IS NULL ORDER BY code LIMIT 1');
    if (!row) throw new HttpError(409, '本批兑换码已领完');
    q.run("UPDATE benefit_marginnote SET user_id = ?, claimed_at = datetime('now') WHERE code = ? AND claimed_at IS NULL", userId, row.code);
    return { code: row.code };
  });
}

export function importMarginNoteCodes(codes: string[]) {
  if (!codes.length || codes.some((code) => !/^[A-Za-z0-9]{6,64}$/.test(code))) throw new Error('兑换码应为 6–64 位英文字母或数字，请检查第一列');
  return atomic(() => {
    let added = 0;
    for (const code of codes) added += Number(q.run('INSERT OR IGNORE INTO benefit_marginnote (code) VALUES (?)', code).changes);
    return added;
  });
}
