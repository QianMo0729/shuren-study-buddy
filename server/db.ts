import { DatabaseSync, type StatementSync } from 'node:sqlite';
import path from 'node:path';
import { config } from './config.ts';

export const db = new DatabaseSync(path.join(config.dataDir, 'app.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  activated INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  message_email_enabled INTEGER NOT NULL DEFAULT 1 CHECK (message_email_enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_codes_email ON email_codes(email, purpose);

CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL DEFAULT '{}',
  published INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  saved_at TEXT,
  taken_down INTEGER NOT NULL DEFAULT 0,
  taken_down_at TEXT,
  takedown_reason TEXT,
  reviewed_at TEXT,
  views INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS profile_drafts (
  user_id INTEGER PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  section TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  time_text TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  taken_down INTEGER NOT NULL DEFAULT 0,
  taken_down_at TEXT,
  takedown_reason TEXT,
  reviewed_at TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS post_interests (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, target_id)
);

CREATE TABLE IF NOT EXISTS contact_views (
  viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (viewer_id, target_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS moderation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  target_user_id INTEGER,
  target_label TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  email_status TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS uploads (
  name TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  -- 文件大小，用于每人配额（见 server/uploads.ts）
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

if (!(db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).some((c) => c.name === 'message_email_enabled')) {
  db.exec('ALTER TABLE users ADD COLUMN message_email_enabled INTEGER NOT NULL DEFAULT 1 CHECK (message_email_enabled IN (0, 1))');
}

// 旧库的 uploads 表没有 bytes 列；已有文件的大小由 server/uploads.ts 在启动时补记
if (!(db.prepare('PRAGMA table_info(uploads)').all() as { name: string }[]).some((c) => c.name === 'bytes')) {
  db.exec('ALTER TABLE uploads ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0');
}
db.exec(`
CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
-- 未读通知数随 /api/auth/me 每 30 秒查询一次，不能扫全表
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_target ON favorites(target_id);
CREATE INDEX IF NOT EXISTS idx_contact_views_target ON contact_views(target_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_post_interests_user ON post_interests(user_id);
`);

type Row = Record<string, any>;

// 同一条 SQL 只编译一次。拼出来的 SQL（如 IN 列表）种类有限，超出上限时淘汰最久没有用过的
const STATEMENT_CACHE_MAX = 500;
const statements = new Map<string, StatementSync>();

function statement(sql: string): StatementSync {
  let stmt = statements.get(sql);
  if (stmt) {
    // 用过的挪到最后，常用的语句不会被淘汰
    statements.delete(sql);
  } else {
    stmt = db.prepare(sql);
    if (statements.size >= STATEMENT_CACHE_MAX) statements.delete(statements.keys().next().value!);
  }
  statements.set(sql, stmt);
  return stmt;
}

export const q = {
  get<T = Row>(sql: string, ...params: any[]): T | undefined {
    return statement(sql).get(...params) as T | undefined;
  },
  all<T = Row>(sql: string, ...params: any[]): T[] {
    return statement(sql).all(...params) as T[];
  },
  run(sql: string, ...params: any[]) {
    return statement(sql).run(...params);
  },
};

let txDepth = 0;

/** 可以嵌套：内层并入最外层事务，只在最外层提交；任何一层抛出异常都会让整个事务回滚 */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  db.exec('BEGIN');
  txDepth++;
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    txDepth--;
  }
}

export function getSetting(key: string, fallback: string): string {
  return q.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  q.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

/** SQLite datetime('now') 是 UTC 且无时区标记，这里统一转成 ISO 字符串给前端 */
export const iso = (s: string | null | undefined) => (s ? new Date(s.replace(' ', 'T') + 'Z').toISOString() : null);
