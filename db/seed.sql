-- 种子数据
INSERT INTO profiles (token, author_id, author_name, contact, roles) VALUES
  ('7f9c0a1b-2d3e-4f5a-6b7c-8d9e0f1a2b3c', 'a1b2c3d4e5f6', '阿哲', 'QQ 12345678', 'artist,developer'),
  ('f4e3d2c1-b0a9-8f7e-6d5c-4b3a2f1e0d9c', 'f6e5d4c3b2a1', '边缘行者', 'Discord: modder#1234', 'writer,translator');

INSERT INTO posts (title, description, contact, author_name, author_token, author_id, created_at) VALUES
  ('寻找像素风画师为武器贴图补全', '我做的武器扩展模组需要补充 20 张贴图，风格为原版像素风，报酬可议。', 'QQ 12345678', '阿哲', '7f9c0a1b-2d3e-4f5a-6b7c-8d9e0f1a2b3c', 'a1b2c3d4e5f6', datetime('now', '-3 days')),
  ('招 C# 开发者合作开发派系扩展模组', '已有完整设计文档，需要一个熟悉 Harmony 的开发者协助实现 AI 行为扩展。', 'QQ 12345678', '阿哲', '7f9c0a1b-2d3e-4f5a-6b7c-8d9e0f1a2b3c', 'a1b2c3d4e5f6', datetime('now', '-1 day')),
  ('整合包汉化项目招文案与翻译', '包含多个模组的整合包，需要文案润色与文本翻译协作完成汉化。', 'Discord: modder#1234', '边缘行者', 'f4e3d2c1-b0a9-8f7e-6d5c-4b3a2f1e0d9c', 'f6e5d4c3b2a1', datetime('now'));

INSERT INTO post_roles (post_id, role_type, description) VALUES
  (1, 'artist', '需要绘制 20 张原版像素风武器贴图，包含三视图。'),
  (2, 'developer', '需要精通 Harmony 补丁的开发者实现 AI 行为扩展。'),
  (3, 'writer', '需要文案润色模组内的描述文本，保持风格统一。'),
  (3, 'translator', '需要将英文文本翻译为简体中文，熟悉 RimWorld 术语。');
