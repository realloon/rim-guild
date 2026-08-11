# Rim Guild

A commission platform for RimWorld mod creators: post commissions and recruit artists, developers, and more.

Tech stack: Astro 7 + Cloudflare (D1 + Workers) + Wrangler

## Development

```bash
# Start the local development server (local D1 data is persisted in .wrangler/state)
astro dev --background

# Reset the local D1 database (deletes all local data)
bunx wrangler d1 execute rim-guild-db --local --command="DROP TABLE IF EXISTS commission_comments; DROP TABLE IF EXISTS commission_updates; DROP TABLE IF EXISTS claims; DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS requirements; DROP TABLE IF EXISTS commissions; DROP TABLE IF EXISTS profiles;"

# Initialize the final database schema and seed data
bunx wrangler d1 execute rim-guild-db --local --file=db/schema.sql
bunx wrangler d1 execute rim-guild-db --local --file=db/seed.sql

# Initialize the remote schema after confirming that the remote database is empty
bunx wrangler d1 execute rim-guild-db --remote --file=db/schema.sql

# Regenerate Wrangler types (after modifying wrangler.jsonc)
npm run generate-types
```

## Deployment

Cloudflare Workers configuration:

- Build command: `bun run build`
- Deploy command: `npx wrangler deploy`

## Structure

- `db/schema.sql` — D1 table schema
- `src/actions/index.ts` — Form handling (Astro Actions)
- `src/lib/commissions.ts` — Commission types and constants
- `src/pages/` — Homepage listing, `/commissions/new` creation, and `/commissions/[id]` details
