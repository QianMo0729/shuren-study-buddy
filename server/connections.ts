import { db, q } from './db.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS contact_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(requester_id <> recipient_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_request_pair
  ON contact_requests(min(requester_id, recipient_id), max(requester_id, recipient_id));
CREATE INDEX IF NOT EXISTS idx_contact_request_recipient ON contact_requests(recipient_id, status);
CREATE TABLE IF NOT EXISTS exclusions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(user_id, target_id),
  CHECK(user_id <> target_id)
);
`);

export function isExcluded(a: number, b: number): boolean {
  return !!q.get('SELECT 1 FROM exclusions WHERE (user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?)', a, b, b, a);
}

function profileData(id: number): any {
  const row = q.get<{ data: string }>('SELECT data FROM profiles WHERE user_id = ?', id);
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

/** No profile-module import: contact privacy is also used while serializing profiles. */
export function isContactEligible(id: number): boolean {
  const row = q.get<{ data: string }>(
    `SELECT p.data FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE p.user_id = ? AND p.published = 1 AND p.taken_down = 0 AND u.activated = 1 AND u.password_hash IS NOT NULL`, id,
  );
  if (!row) return false;
  try {
    const data = JSON.parse(row.data);
    const consent = data.privacyConsent;
    return data.schemaVersion >= 2 && consent?.policy === true && consent?.contactExchange === true
      && consent?.silentExclusion === true && consent?.withdrawal === true;
  } catch { return false; }
}

/** 至少填写了一种可交换的联系方式（微信 / QQ / 手机 / 其他，或开启交换校园邮箱） */
export function hasContactMethod(id: number): boolean {
  const c = profileData(id)?.contacts;
  if (!c || typeof c !== 'object') return false;
  const filled = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  return c.showEmail === true || filled(c.wechat) || filled(c.qq) || filled(c.phone) || filled(c.other);
}

/** 两人之间存在进行中的配对（互相感兴趣且未解除）。直接查表，避免与 matches.ts 循环引用。 */
export function hasActiveMatch(a: number, b: number): boolean {
  return !!q.get("SELECT 1 FROM matches WHERE user_a = ? AND user_b = ? AND status = 'active'", Math.min(a, b), Math.max(a, b));
}

/** 联系方式只在：双方资格有效、未互相排除、配对仍在进行、且交换申请已被接受时互相可见 */
export function canExchangeContacts(a: number, b: number): boolean {
  if (a === b || isExcluded(a, b) || !isContactEligible(a) || !isContactEligible(b) || !hasActiveMatch(a, b)) return false;
  return !!q.get(
    "SELECT 1 FROM contact_requests WHERE status = 'accepted' AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))",
    a, b, b, a,
  );
}
