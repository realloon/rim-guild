-- 迁移：post_roles 增加面向该类型的独立需求描述
ALTER TABLE post_roles ADD COLUMN description TEXT NOT NULL DEFAULT '';

-- 回填：旧数据将项目级描述作为唯一类型的需求
UPDATE post_roles SET description = (SELECT description FROM posts WHERE posts.id = post_roles.post_id);
