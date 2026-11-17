import crypto from 'node:crypto';
import { db, getSetting, iso, q, setSetting } from './db.ts';
import { HttpError, sha256 } from './auth.ts';
import { registerAccountCleanup } from './social.ts';

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
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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
// Databases created by an earlier build of this feature have no owner column yet.
if (!(db.prepare('PRAGMA table_info(benefit_xmind)').all() as { name: string }[]).some((c) => c.name === 'user_id')) {
  db.exec('ALTER TABLE benefit_xmind ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
}
// One place per account, however many times the page is opened.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS benefit_xmind_user ON benefit_xmind(user_id)');

// 注销账号时删除登记的手机号；已领取的 MarginNote 兑换码保持占用，不会再发给别人
registerAccountCleanup((uid) => {
  q.run('DELETE FROM benefit_xmind WHERE user_id = ?', uid);
  q.run('DELETE FROM benefit_visits WHERE user_id = ?', uid);
});

// 登记默认关闭：上线不等于开始收集手机号，由管理员在后台手动开放，也可以随时暂停
const XMIND_OPEN_KEY = 'benefit_xmind_open';
export const xmindOpen = () => getSetting(XMIND_OPEN_KEY, '0') === '1';
export function setXmindOpen(open: boolean) {
  setSetting(XMIND_OPEN_KEY, open ? '1' : '0');
}

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
  const ended = Date.now() >= MN_EXPIRES;
  const phase = ended ? 'ended' : !renewalTerms ? 'upcoming' : remaining === 0 ? 'exhausted' : 'open';
  return {
    xmind: { open: xmindOpen(), limit: XMIND_LIMIT, remaining: Math.max(0, XMIND_LIMIT - count), waitSeconds: XMIND_WAIT_MS / 1000 },
    marginnote: { remaining, enabled: !!renewalTerms && !ended, phase, renewalTerms, redeemBefore: '2027-02-12' },
  };
}

export function startBenefitVisit(userId: number) {
  if (!xmindOpen()) throw new HttpError(409, 'Xmind 点数登记暂未开放');
  q.run('DELETE FROM benefit_visits WHERE started_at < ?', Date.now() - VISIT_TTL_MS);
  const token = crypto.randomBytes(32).toString('base64url');
  q.run('INSERT INTO benefit_visits (token_hash, user_id, started_at) VALUES (?, ?, ?)', sha256(token), userId, Date.now());
  return { token, waitSeconds: XMIND_WAIT_MS / 1000 };
}

export function registerXmind(userId: number, input: { token?: unknown; phone?: unknown; consent?: unknown }) {
  if (input.consent !== true) throw new HttpError(400, '请同意手机号用于本次 Xmind 点数发放');
  if (typeof input.phone !== 'string' || !/^1[3-9]\d{9}$/.test(input.phone.trim())) throw new HttpError(400, '请填写正确的 11 位手机号');
  if (typeof input.token !== 'string' || input.token.length > 100) throw new HttpError(400, '请重新打开活动页');
  const phone = input.phone.trim();
  const hash = sha256(input.token);
  return atomic(() => {
    // An account holds one place. Sending the same number again is a retry and never takes a second
    // place, even when the list is full; a different number needs the first registration removed.
    const mine = q.get<{ id: number; phone: string }>('SELECT id, phone FROM benefit_xmind WHERE user_id = ?', userId);
    if (mine) {
      if (mine.phone !== phone) throw new HttpError(409, '这个账号已经登记过了。如需更正手机号，请联系树仁书院活动负责人员');
      return { id: mine.id };
    }
    // Closing the registration stops new places at once, including for pages opened while it was open.
    if (!xmindOpen()) throw new HttpError(409, 'Xmind 点数登记暂未开放');
    const visit = q.get<{ user_id: number; started_at: number }>('SELECT * FROM benefit_visits WHERE token_hash = ?', hash);
    if (!visit || visit.user_id !== userId || Date.now() - visit.started_at >= VISIT_TTL_MS) throw new HttpError(400, '登记页面已过期，请重新打开活动页');
    if (Date.now() - visit.started_at < XMIND_WAIT_MS) throw new HttpError(400, '请先浏览活动页满 30 秒');
    if (benefitStatus().xmind.remaining === 0) throw new HttpError(409, '200 份领取名额已满');
    const result = q.run('INSERT INTO benefit_xmind (user_id, visit_hash, phone) VALUES (?, ?, ?)', userId, hash, phone);
    return { id: Number(result.lastInsertRowid) };
  });
}

/** What the student sees about their own registration: enough to recognise the number, not the number itself. */
export function myXmindRegistration(userId: number) {
  const row = q.get<{ phone: string; created_at: string }>('SELECT phone, created_at FROM benefit_xmind WHERE user_id = ?', userId);
  return row ? { phone: `${row.phone.slice(0, 3)}****${row.phone.slice(-4)}`, createdAt: iso(row.created_at)! } : null;
}

/** Removing a registration frees its place, and lets that account register again with the right number. */
export function deleteXmindRegistration(id: number) {
  return Number(q.run('DELETE FROM benefit_xmind WHERE id = ?', id).changes) > 0;
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
