# 边缘工会

面向 RimWorld 模组创作者的委托平台：发布委托，招募画师、开发者等。

技术栈：Astro 7 + Cloudflare (D1 + Workers) + wrangler

## 开发

```bash
# 本地启动（D1 本地数据持久化在 .wrangler/state）
astro dev --background

# 重置本地 D1（会删除全部本地数据）
bunx wrangler d1 execute rim-guild-db --local --command="DROP TABLE commission_updates; DROP TABLE claims; DROP TABLE sessions; DROP TABLE requirements; DROP TABLE commissions; DROP TABLE profiles;"

# 初始化最终数据库结构与种子数据
bunx wrangler d1 execute rim-guild-db --local --file=db/schema.sql
bunx wrangler d1 execute rim-guild-db --local --file=db/seed.sql

# 在确认远程数据库为空后初始化远程结构
bunx wrangler d1 execute rim-guild-db --remote --file=db/schema.sql

# 重新生成 wrangler 类型（修改 wrangler.jsonc 后）
npm run generate-types
```

## 部署

```bash
bun run deploy
```

Cloudflare 的部署命令使用 `bun run deploy`。该命令会先构建 Astro，再部署 Wrangler；不要直接使用 `npx wrangler deploy`。

## 结构

- `db/schema.sql` — D1 表结构
- `src/actions/index.ts` — 表单处理（Astro Actions）
- `src/lib/commissions.ts` — 委托类型与常量
- `src/pages/` — 首页列表、`/commissions/new` 发布、`/commissions/[id]` 详情
