# QueueNow External Source Baseline

Checked: **2026-09-25**

These are external service facts used for the V1 reference architecture. Re-check before making future cost/capacity commitments.

## Cloudflare Workers limits

Official:
https://developers.cloudflare.com/workers/platform/limits/

Baseline used:
- Workers Free: 100,000 requests/day
- 10 ms CPU/invocation
- 128 MB memory
- free limit resets at midnight UTC

## Cloudflare Workers static assets

Official:
https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/

Baseline used:
- static asset requests are free/unlimited when served as static assets
- requests that invoke Worker logic are subject to Worker pricing/limits

## Cloudflare Durable Objects pricing

Official:
https://developers.cloudflare.com/durable-objects/platform/pricing/

Baseline used:
- Durable Objects available on Workers Free with SQLite storage backend
- 100,000 request units/day
- 13,000 GB-s/day
- outgoing WebSocket messages not charged as request units
- incoming WebSocket messages use 20:1 request-billing ratio
- exceeding a free-tier dimension causes further operations of that type to fail

## Durable Object WebSocket Hibernation

Official:
https://developers.cloudflare.com/durable-objects/best-practices/websockets/

Baseline used:
- Hibernation is recommended for DO WebSocket servers
- clients remain connected while eligible DO is hibernated
- billable duration does not accrue while hibernated/eligible under documented behavior

## SQLite-backed Durable Object Storage API

Official:
https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/

Checked 2026-09-25 (page last updated 2026-09-21):
- SQLite is the recommended storage backend for new Durable Object classes.
- Use `ctx.storage.transactionSync()` for synchronous multi-statement SQL transactions; do not issue raw `BEGIN`/`SAVEPOINT` through `sql.exec()`.
- Consume SQL cursors synchronously before crossing an `await` boundary.

## Durable Object class exports

Official:
https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/

Checked 2026-09-25 (page last updated 2026-09-22):
- declare the DO binding in `durable_objects.bindings` and the class storage backend in Wrangler's top-level `exports` configuration,
- new live classes declare `storage: "sqlite"`,
- class provisioning/lifecycle is distinct from application-owned SQL schema migrations.

## Workers Vitest integration

Official:
https://developers.cloudflare.com/workers/testing/vitest-integration/

and:
https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/

Checked 2026-09-25 (pages last updated 2026-08-20):
- Cloudflare recommends `@cloudflare/vitest-plugin` for local Worker unit/integration tests,
- tests run in a local Miniflare Workers runtime,
- the plugin requires Vitest 4.1 or later.

## Cloudflare Workers Web Crypto

Official:
https://developers.cloudflare.com/workers/runtime-apis/web-crypto/

Checked 2026-09-25 (page last updated 2026-04-23):
- Workers' Web Crypto implementation supports HKDF key derivation and AES-GCM encrypt/decrypt.
- The selected join-capability envelope still requires implementation and Cloudflare runtime regression tests.

## Cloudflare D1 pricing

Official:
https://developers.cloudflare.com/d1/platform/pricing/

Baseline used:
- 5 million rows read/day on Free
- 100,000 rows written/day on Free
- 5 GB total storage on Free

## GitHub-hosted runners

Official:
https://docs.github.com/en/actions/reference/runners/github-hosted-runners

and:
https://docs.github.com/en/actions/concepts/billing-and-usage

Baseline used:
- standard GitHub-hosted runners for public repositories are free/unlimited according to current GitHub documentation
- larger runners are not part of that assumption

## Caveat

Provider pricing, quotas, and product availability are not part of QueueNow's own compatibility guarantee.

Before a production launch or material scale increase:
1. re-check these official sources,
2. measure actual usage,
3. update `FREE_TIER_BUDGET.md`,
4. record a dated architecture decision if assumptions change.
