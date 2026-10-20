import type { PrivateNote } from '../shared/types.ts';
import { hasPrivacyConsent } from '../shared/profileRules.ts';
import { HttpError } from './auth.ts';
import { isExcluded } from './connections.ts';
import { db, iso, q } from './db.ts';
import './matches.ts';
import { registerAccountCleanup } from './social.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS user_notes (
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remark_name TEXT NOT NULL DEFAULT '' CHECK(length(remark_name) <= 40),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 300),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(owner_id, target_id),
  CHECK(owner_id <> target_id)
);
CREATE INDEX IF NOT EXISTS idx_user_notes_target ON user_notes(target_id);
`);

interface NoteRow { target_id: number; remark_name: string; note: string; updated_at: string }
const serialize = (row: NoteRow): PrivateNote => ({ remarkName: row.remark_name, note: row.note, updatedAt: iso(row.updated_at)! });

/** 仅用于已授权的主页或会话序列化；ownerId 必须来自当前登录态。 */
export function noteForOwner(ownerId: number, targetId: number): PrivateNote | null {
  const row = q.get<NoteRow>('SELECT * FROM user_notes WHERE owner_id = ? AND target_id = ?', ownerId, targetId);
  return row ? serialize(row) : null;
}

/** 列表只查一次，避免每张卡片为备注多发一条数据库查询。调用方仍须过滤目标可见性。 */
export function notesForOwner(ownerId: number): Map<number, PrivateNote> {
  return new Map(q.all<NoteRow>('SELECT * FROM user_notes WHERE owner_id = ?', ownerId).map((row) => [row.target_id, serialize(row)]));
}

/** 与普通主页和聊天相同的关系边界；管理员也不能读取其他人的私人备注。 */
export function canNoteTarget(ownerId: number, targetId: number): boolean {
  if (ownerId === targetId || isExcluded(ownerId, targetId)) return false;
  const target = q.get<{ published: number; taken_down: number; data: string }>(
    `SELECT p.published, p.taken_down, p.data FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE p.user_id = ? AND u.activated = 1 AND u.password_hash IS NOT NULL`, targetId,
  );
  if (!target) return false;
  if (target.published && !target.taken_down) {
    try { if (hasPrivacyConsent(JSON.parse(target.data))) return true; } catch { /* Hidden or invalid profile. */ }
  }
  return !!q.get('SELECT 1 FROM matches WHERE user_a = ? AND user_b = ?', Math.min(ownerId, targetId), Math.max(ownerId, targetId));
}

function clean(raw: unknown, field: string, max: number): string {
  if (typeof raw !== 'string') throw new HttpError(400, `${field}必须是文字`);
  if (raw.length > max * 4) throw new HttpError(400, `${field}最多 ${max} 字`);
  const value = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim();
  if (value.length > max) throw new HttpError(400, `${field}最多 ${max} 字`);
  return value;
}

export function savePrivateNote(ownerId: number, targetId: number, raw: unknown): PrivateNote | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, '备注格式不正确');
  const input = raw as Record<string, unknown>;
  const remarkName = clean(input.remarkName, '备注名', 40).replace(/\s+/g, ' ');
  const note = clean(input.note, '备注', 300);
  if (!remarkName && !note) {
    deletePrivateNote(ownerId, targetId);
    return null;
  }
  q.run(`INSERT INTO user_notes (owner_id, target_id, remark_name, note) VALUES (?, ?, ?, ?)
    ON CONFLICT(owner_id, target_id) DO UPDATE SET remark_name = excluded.remark_name,
      note = excluded.note, updated_at = datetime('now')`, ownerId, targetId, remarkName, note);
  return noteForOwner(ownerId, targetId);
}

export function deletePrivateNote(ownerId: number, targetId: number) {
  q.run('DELETE FROM user_notes WHERE owner_id = ? AND target_id = ?', ownerId, targetId);
}

registerAccountCleanup((uid) => {
  q.run('DELETE FROM user_notes WHERE owner_id = ? OR target_id = ?', uid, uid);
});
