-- 委托（模组创作任务）
CREATE TABLE IF NOT EXISTS commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '匿名',
  author_token TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 委托需求（一个委托可包含多项需求，每项需求有独立的类型、要求、人数与状态）
CREATE TABLE IF NOT EXISTS requirements (
  commission_id INTEGER NOT NULL,
  requirement_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  PRIMARY KEY (commission_id, requirement_type),
  FOREIGN KEY (commission_id) REFERENCES commissions(id)
);

CREATE INDEX IF NOT EXISTS idx_requirements_type ON requirements(requirement_type);
CREATE INDEX IF NOT EXISTS idx_commissions_created_at ON commissions(created_at DESC);

-- 用户资料（guest 匿名身份或已注册账号）
CREATE TABLE IF NOT EXISTS profiles (
  token TEXT PRIMARY KEY,
  author_id TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '匿名',
  qq TEXT NOT NULL DEFAULT '',
  github TEXT NOT NULL DEFAULT '',
  steam TEXT NOT NULL DEFAULT '',
  creator_types TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_author_id ON profiles(author_id) WHERE author_id != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email) WHERE email != '';

-- 会话（cookie 值即 session token；7 天滑动过期）
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  profile_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile_token);

-- 认领（用户对某委托某项需求登记自己）
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commission_id INTEGER NOT NULL,
  requirement_type TEXT NOT NULL,
  profile_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (commission_id, requirement_type, profile_token),
  FOREIGN KEY (commission_id) REFERENCES commissions(id)
);

CREATE INDEX IF NOT EXISTS idx_claims_commission ON claims(commission_id);

-- 委托更新记录（发布者发布进度）
CREATE TABLE IF NOT EXISTS commission_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commission_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (commission_id) REFERENCES commissions(id)
);

CREATE INDEX IF NOT EXISTS idx_commission_updates_commission ON commission_updates(commission_id);
