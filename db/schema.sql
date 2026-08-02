-- 需求帖（模组项目）
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '匿名',
  author_token TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 招揽类型（一个项目可多选，每个类型有独立的需求描述、人数与状态）
CREATE TABLE IF NOT EXISTS post_roles (
  post_id INTEGER NOT NULL,
  role_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  PRIMARY KEY (post_id, role_type),
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE INDEX IF NOT EXISTS idx_post_roles_role_type ON post_roles(role_type);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);

-- 用户资料（guest 匿名身份或已注册账号）
CREATE TABLE IF NOT EXISTS profiles (
  token TEXT PRIMARY KEY,
  author_id TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '匿名',
  qq TEXT NOT NULL DEFAULT '',
  github TEXT NOT NULL DEFAULT '',
  steam TEXT NOT NULL DEFAULT '',
  roles TEXT NOT NULL DEFAULT '',
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

-- 登记（用户对某项目某类型的招揽登记自己）
CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  role_type TEXT NOT NULL,
  profile_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (post_id, role_type, profile_token),
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE INDEX IF NOT EXISTS idx_responses_post ON responses(post_id);

-- 项目更新记录（发布者发布进度）
CREATE TABLE IF NOT EXISTS post_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE INDEX IF NOT EXISTS idx_post_updates_post ON post_updates(post_id);
