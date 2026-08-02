-- 迁移：role_type 单值 → post_roles 多选关联表
CREATE TABLE post_roles (
  post_id INTEGER NOT NULL,
  role_type TEXT NOT NULL,
  PRIMARY KEY (post_id, role_type),
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

INSERT INTO post_roles (post_id, role_type)
SELECT id, role_type FROM posts WHERE role_type IS NOT NULL;

CREATE INDEX idx_post_roles_role_type ON post_roles(role_type);

ALTER TABLE posts DROP COLUMN role_type;
