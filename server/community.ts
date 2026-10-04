// 社区（聊天区帖子、评论、点赞、学习打卡）的数据表。
// 业务逻辑在 server/forum.ts、server/routes/forum.ts、server/checkins.ts、server/routes/checkins.ts。
// 所有可被管理员撤下的内容表都包含：user_id, created_at, deleted, taken_down, taken_down_at, takedown_reason, reviewed_at。
import { db, q } from './db.ts';
import { registerAccountCleanup } from './social.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS forum_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  images TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted INTEGER NOT NULL DEFAULT 0,
  taken_down INTEGER NOT NULL DEFAULT 0,
  taken_down_at TEXT,
  takedown_reason TEXT,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_forum_posts_created ON forum_posts(created_at);

CREATE TABLE IF NOT EXISTS forum_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK(target_type IN ('post', 'checkin')),
  target_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted INTEGER NOT NULL DEFAULT 0,
  taken_down INTEGER NOT NULL DEFAULT 0,
  taken_down_at TEXT,
  takedown_reason TEXT,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_forum_comments_target ON forum_comments(target_type, target_id, id);

CREATE TABLE IF NOT EXISTS forum_likes (
  target_type TEXT NOT NULL CHECK(target_type IN ('post', 'checkin')),
  target_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (target_type, target_id, user_id)
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  place_label TEXT NOT NULL,
  -- 服务器收到照片并盖章的时间（UTC，SQLite datetime 格式）
  stamped_at TEXT NOT NULL,
  -- 北京时间日期 YYYY-MM-DD，用于连续打卡统计
  local_date TEXT NOT NULL,
  stamp_text TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'all' CHECK(visibility IN ('all', 'buddies')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted INTEGER NOT NULL DEFAULT 0,
  taken_down INTEGER NOT NULL DEFAULT 0,
  taken_down_at TEXT,
  takedown_reason TEXT,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, local_date);

-- 实时拍照会话：打开摄像头时领取，一次性、短时有效；打卡上传必须携带
CREATE TABLE IF NOT EXISTS checkin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
`);

registerAccountCleanup((uid) => {
  q.run('DELETE FROM forum_likes WHERE user_id = ?', uid);
  q.run('DELETE FROM forum_comments WHERE user_id = ?', uid);
  q.run("DELETE FROM forum_likes WHERE (target_type = 'post' AND target_id IN (SELECT id FROM forum_posts WHERE user_id = ?)) OR (target_type = 'checkin' AND target_id IN (SELECT id FROM checkins WHERE user_id = ?))", uid, uid);
  q.run("DELETE FROM forum_comments WHERE (target_type = 'post' AND target_id IN (SELECT id FROM forum_posts WHERE user_id = ?)) OR (target_type = 'checkin' AND target_id IN (SELECT id FROM checkins WHERE user_id = ?))", uid, uid);
  q.run('DELETE FROM forum_posts WHERE user_id = ?', uid);
  q.run('DELETE FROM checkins WHERE user_id = ?', uid);
  q.run('DELETE FROM checkin_sessions WHERE user_id = ?', uid);
});
