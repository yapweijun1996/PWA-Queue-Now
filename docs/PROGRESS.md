# QueueNow Progress

Updated: 2026-09-25

## Current phase

**M1 — Deterministic Queue Core (in progress); M2 runtime foundation started**

The npm workspace, strict TypeScript/quality baseline, and GitHub Actions CI workflow are initialized. Pure queue rules are locally verified. The Worker has a local SQLite DO schema, an internal atomic session-open operation, and a local D1 schema with a tested queue-configuration reader. No merchant authentication, public business routes, web app, or Cloudflare production resources exist yet.

## Progress by area

| Area | Progress | Evidence |
|---|---:|---|
| Problem definition | 100% | GOAL / DESIGN |
| V1 scope | 100% | SPEC |
| Architecture | 100% | ARCHITECTURE |
| State machine | 100% | STATE_MACHINE |
| Data/API contracts | 90% | DATA_MODEL / API; implementation may refine indexes |
| Security model | 90% | SECURITY; auth implementation still must be selected/verified |
| PWA rules | 100% | PWA_STANDARD |
| CI/CD plan | 100% | CI_CD |
| Test strategy | 100% | TESTING |
| Implementation | 12% | Workspace/CI foundation, tested queue-core helpers/contracts, local D1 configuration schema/reader, and atomic DO session-open/join operations; public routes and user flows are still absent |
| Production deployment | 0% | Not started |
| Pilot evidence | 0% | Not started |

## Overall delivery estimate

**31%**

Reason: product/engineering design is substantially defined; queue-core contracts, D1 config loading, and atomic session-open/join operations are tested in Node and the Cloudflare local runtime. Authentication, public routing, customer/merchant/display flows, deployment, and real-world evidence remain absent; this is not product completion.

## Current verified decisions

- Open-source project.
- GitHub Actions CI/CD.
- Cloudflare serverless runtime; no self-managed VPS required.
- One SQLite-backed Durable Object per live queue.
- D1 for durable relational configuration/history projection.
- Hibernation WebSockets for real-time synchronization.
- Anonymous customer flow by default.
- Queue number is not authentication.
- Lifecycle and presence are separate concepts.
- Offline authoritative mutation is forbidden.
- V1 notification depends on the open live page; SMS/WhatsApp are out of scope.
- V1 estimator is deterministic, not AI.
- Re-setting a customer's current presence is a no-op and must not create a second revision/event.
- Sequence formatting pads to at least three digits; only an atomic queue DO operation may reserve/increment the authoritative counter.
- Queue sessions start at revision 0; pure revision arithmetic does not replace atomic DO persistence.
- Command retries replay only on an exact command ID, actor scope, command type, and request-fingerprint match; the pure helper does not persist receipts.
- WebSocket sends only strict `queue.changed` revision/time invalidations; clients refetch role-authorized snapshots.
- Return-window estimates use a five-valid-sample median threshold and concurrent-lane workload simulation; V1 uses a fixed 300-second server-owned buffer snapshotted per session. The join runtime currently supplies configured default durations because D1 history samples are not wired; the estimate is advisory.
- The public Worker exposes only `/health`; the SQLite DO has schema v3 and internal session-open and anonymous-join commands. Neither command is routed publicly. D1 schema v1 and a validated config reader now exist, but merchant authentication/authorization and route integration remain absent.
- Session open atomically persists a validated server-supplied config snapshot and an exact command receipt; actor scope is hashed and receipts have a 24-hour retry horizon. The D1 reader is not yet connected to an authenticated Worker route, so the internal session-open command must remain unforwarded.
- Join recovery follows ADR-016: `joinRequestId` is only a selector; a separate 32-byte secret proves replay of a DO-encrypted capability envelope. The DO atomically persists the ticket, capability hash, exact safe result, encrypted envelope, sequence, queue revision, and session-scoped event. Runtime tests cover exact recovery, ID-only and wrong-proof rejection, changed intent, capability-hash corruption, 50 unique concurrent joins, concurrent duplicate replay, closed/paused states, counter-exhaustion rollback, and re-opened-session event revisions. The public Worker does not yet resolve public queue identifiers or route this internal operation.
- D1 configuration is versioned under `workers/queue-api/migrations/`; the local Wrangler binding intentionally has no production database ID. The tested reader requires an active queue, shop, and owner merchant, returns only active services in stable order, validates the session snapshot, and injects the fixed 300-second buffer.
- `packages/contracts` owns shared enums/schemas; queue-core imports only its dependency-free domain subpath.
- Initial business niche: small barber/salon/beauty walk-in operations.
- Free-tier-first, not “guaranteed free forever.”

## Latest local verification

On 2026-09-25, the current D1 slice passed `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run test:dist`; 586 Node cases and 18 Cloudflare-runtime cases passed. The Wrangler dry-run build listed the DO and D1 bindings. The local `d1:migrate:local` command applied `0001_initial.sql` to an isolated temporary database, and a local SQL readback confirmed all nine application tables plus the migration-tracking table. Earlier `npm ci` and dependency audit passed with zero vulnerabilities. GitHub Actions has not been verified remotely.

## Next implementation gate

Keep session-open internal until merchant authentication/authorization is implemented; the D1 schema and configuration reader are now ready for local integration. Before exposing joins, resolve the public slug to the queue/session server-side and add abuse controls; never accept a client-selected DO identity. Then continue:
- implement merchant auth/authorization and D1-backed setup before forwarding session-open,
- add transactional DO handlers for Call Next and staff/customer mutations with receipts, revisions, and persisted events,
- wire bounded D1 history samples into the estimator; the V1 runtime buffer is fixed at 300 seconds in each session snapshot,
- implement WebSocket snapshots/invalidation, customer/merchant/display flows, and browser E2E,
- resolve QN-026 with defensible restart/eviction persistence evidence.

## Blockers

- `QN-026` still needs real DO restart/eviction evidence. An exploratory `evictDurableObject` test under the current local Vitest runtime timed out after its completion log; it is not counted as verification. Resolve the test-harness issue or use another defensible runtime readback before marking restart persistence done.

Production deployment will eventually require:
- Cloudflare account,
- Cloudflare API deployment credentials stored as GitHub secrets,
- selected production hostname/domain or workers.dev URL.
