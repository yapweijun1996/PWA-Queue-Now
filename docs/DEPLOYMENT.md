# QueueNow V1 Deployment

## Target

Cloudflare-hosted, no self-managed server.

Components:
- static Vite assets
- Worker API
- SQLite-backed Durable Object namespace
- D1 database

## Environments

Recommended:
- local
- preview/staging
- production

Use separate D1/DO bindings where practical to prevent test traffic touching production.

## Initial Cloudflare setup

1. Create Cloudflare account.
2. Create D1 database.
3. Configure Worker project.
4. Declare the queue Durable Object binding and SQLite storage in Wrangler `exports` configuration.
5. Configure static asset serving.
6. Add environment bindings.
7. Create least-privilege API token for GitHub Actions.
8. Store token in GitHub `production` environment secret.
9. Deploy.
10. Run smoke/readback checks.

## URL

V1 can start on a Cloudflare-provided hostname to avoid domain cost.

Custom domain is optional and not required for a zero-cost infrastructure pilot if a suitable free hostname is available.

## Migrations

Durable Object class lifecycle is declared in Wrangler `exports`; the SQLite application schema is versioned separately in the DO's `schema_migrations` table. D1 schema changes use versioned SQL under `workers/queue-api/migrations/` and Wrangler's D1 migration tracking.

For local development, run `npm run d1:migrate:local --workspace @queuenow/queue-api`. This explicitly applies migrations to the local D1 emulator; it does not create or modify a remote database. The local config intentionally has no production `database_id`. A real ID is added only when an authorized environment database is provisioned.

Rules:
- keep versioned SQL migration code in source control,
- advance the DO schema version transactionally and apply D1 migrations through Wrangler,
- CI validates the Wrangler dry-run build and local SQLite/D1 runtime tests,
- production schema changes ship only through an authorized, controlled deploy,
- class deletion/storage-backend changes and destructive SQL migrations require an explicit plan/backup strategy.

## Deployment verification

After production deploy:

### Static
- index loads
- manifest loads
- service worker loads
- version equals expected SHA/version

### API
- health endpoint
- D1 read
- queue DO route
- safe test queue create/read if environment supports

### Realtime
- WebSocket handshake
- safe test broadcast

### Product
- public queue page
- merchant auth page
- display page
- no obvious console errors

Record deployed commit SHA.

## Rollback

V1 rollback plan:
- redeploy last known-good Worker/static version,
- do not roll back live data schema blindly,
- forward-fix data migration when rollback would corrupt compatibility.

Schema changes must be backward-compatible where practical around deployment boundaries.

## No-VPS statement

Production does not require:
- Mac mini online,
- Linux VPS,
- Nginx,
- PM2,
- Docker host,
- self-hosted database.

Cloudflare is the server-side runtime.

## Self-hosting

Open-source does not mean V1 must support every hosting provider immediately.

V1 reference deployment is Cloudflare.

A later self-hosted adapter may target:
- Node runtime,
- PostgreSQL/SQLite,
- WebSocket server,
but it is explicitly post-V1 unless a contributor owns that work.
