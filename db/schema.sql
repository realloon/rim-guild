-- 需求帖（模组项目）
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '匿名',
  author_token TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 招揽类型（一个项目可多选，每个类型有独立的需求描述）
CREATE TABLE IF NOT EXISTS post_roles (
  post_id INTEGER NOT NULL,
  role_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (post_id, role_type),
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE INDEX IF NOT EXISTS idx_post_roles_role_type ON post_roles(role_type);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);

-- 用户资料（免登录阶段：token 即身份）
CREATE TABLE IF NOT EXISTS profiles (
  token TEXT PRIMARY KEY,
  author_id TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL,
  contact TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_author_id ON profiles(author_id) WHERE author_id != '';
