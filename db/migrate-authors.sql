-- 迁移：posts 增加作者信息（免登录阶段：昵称 + 匿名 token）
ALTER TABLE posts ADD COLUMN author_name TEXT NOT NULL DEFAULT '匿名';
ALTER TABLE posts ADD COLUMN author_token TEXT NOT NULL DEFAULT '';
