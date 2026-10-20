// 搭子打卡活动的数据表：搭子绑定与邀请、打卡判无效与申诉、抽检、Bonus、设备记录、取消评奖资格。
// 业务逻辑分别在 server/buddies.ts、server/scoring.ts、server/audits.ts、server/bonus.ts。
import { db, q } from './db.ts';
import './community.ts';
import './matches.ts';

db.exec(`
-- 一对一的学习搭子。解绑后 status = 'ended'，记录保留供核查；积分按组合计算，新的绑定从 0 开始
CREATE TABLE IF NOT EXISTS buddy_pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended')),
  -- 从这一天（周一，北京时间）开始计分
  starts_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  ended_by INTEGER,
  -- unbind 主动解绑 / match_closed 解除配对或排除 / account 注销
  end_reason TEXT,
  CHECK (user_a < user_b)
);
CREATE INDEX IF NOT EXISTS idx_buddy_pairs_a ON buddy_pairs(user_a, status);
CREATE INDEX IF NOT EXISTS idx_buddy_pairs_b ON buddy_pairs(user_b, status);

CREATE TABLE IF NOT EXISTS buddy_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT,
  CHECK (from_id <> to_id)
);
CREATE INDEX IF NOT EXISTS idx_buddy_invites_to ON buddy_invites(to_id, status);
CREATE INDEX IF NOT EXISTS idx_buddy_invites_from ON buddy_invites(from_id, status);

-- 是否为树仁书院学生（本人填写，发奖前由管理员按学号核对）。不公开，也不参与匹配
CREATE TABLE IF NOT EXISTS activity_members (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  shuren TEXT NOT NULL CHECK(shuren IN ('yes', 'no')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 确认作弊后取消本赛季评奖资格（按人记录，换搭子也不能恢复）
CREATE TABLE IF NOT EXISTS activity_disqualified (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  admin_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 抽检：随机抽中、系统标记、获奖复核或审核人员手动加入的打卡
CREATE TABLE IF NOT EXISTS checkin_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkin_id INTEGER NOT NULL UNIQUE REFERENCES checkins(id) ON DELETE CASCADE,
  -- 所在周的周一
  week TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('random', 'flag', 'prize', 'manual')),
  flags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'valid', 'invalid')),
  reviewer_id INTEGER,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_checkin_audits_status ON checkin_audits(status, id);

CREATE TABLE IF NOT EXISTS checkin_appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkin_id INTEGER NOT NULL UNIQUE REFERENCES checkins(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'upheld', 'overturned')),
  decided_by INTEGER,
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_checkin_appeals_status ON checkin_appeals(status, id);

-- 学习分享帖的 Bonus 申请
CREATE TABLE IF NOT EXISTS bonus_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL UNIQUE REFERENCES forum_posts(id) ON DELETE CASCADE,
  pair_id INTEGER NOT NULL REFERENCES buddy_pairs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  points INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  reviewer_id INTEGER,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bonus_claims_pair ON bonus_claims(pair_id, status);
CREATE INDEX IF NOT EXISTS idx_bonus_claims_status ON bonus_claims(status, id);

-- 设备标识：浏览器本地生成的随机编号（库里只存哈希），用于标记「一台设备登录多个账号」「一部手机替两人打卡」。
-- 网页拿不到 MAC 地址，这里也不采集任何硬件信息；超过保留期的记录自动删除
CREATE TABLE IF NOT EXISTS device_seen (
  device_hash TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (device_hash, user_id)
);
CREATE INDEX IF NOT EXISTS idx_device_seen_user ON device_seen(user_id);
`);

const columns = (table: string) => new Set(q.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));

// 打卡：判无效（不计分，内容照常显示）与设备哈希
const checkinColumns = columns('checkins');
for (const [name, ddl] of [
  ['invalid', 'invalid INTEGER NOT NULL DEFAULT 0'],
  ['invalid_reason', 'invalid_reason TEXT'],
  ['invalid_at', 'invalid_at TEXT'],
  ['invalid_by', 'invalid_by INTEGER'],
  ['device_hash', 'device_hash TEXT'],
] as const) {
  if (!checkinColumns.has(name)) db.exec(`ALTER TABLE checkins ADD COLUMN ${ddl}`);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(local_date)');

// 私聊消息：发送时命中的敏感词类别（逗号分隔）
const messageColumns = columns('messages');
if (!messageColumns.has('flags')) db.exec("ALTER TABLE messages ADD COLUMN flags TEXT NOT NULL DEFAULT ''");
