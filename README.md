# 边缘工会

面向 RimWorld 模组创作者的委托平台：发布委托，招募画师、开发者等。

技术栈：Astro 7 + Cloudflare (D1 + Workers) + wrangler

## 开发

```bash
# 本地启动（D1 本地数据持久化在 .wrangler/state）
astro dev --background

# 本地 D1 迁移
wrangler d1 execute rim-guild-db --local --file=db/schema.sql

# 同步本地种子数据到远程
wrangler d1 execute rim-guild-db --remote --file=db/schema.sql

# 重新生成 wrangler 类型（修改 wrangler.jsonc 后）
npm run generate-types
```

## 结构

- `db/schema.sql` — D1 表结构
- `src/actions/index.ts` — 表单处理（Astro Actions）
- `src/lib/commissions.ts` — 委托类型与常量
- `src/pages/` — 首页列表、`/commissions/new` 发布、`/commissions/[id]` 详情
