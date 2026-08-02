-- 迁移：独立用户资料表（免登录阶段以 token 为主键）
CREATE TABLE IF NOT EXISTS profiles (
  token TEXT PRIMARY KEY,
  author_name TEXT NOT NULL,
  contact TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 回填：从已有帖子按作者 token 汇总资料
INSERT OR IGNORE INTO profiles (token, author_name, contact, created_at)
SELECT author_token, author_name, contact, MIN(created_at)
FROM posts
WHERE author_token != ''
GROUP BY author_token;
