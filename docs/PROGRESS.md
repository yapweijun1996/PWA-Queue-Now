# QueueNow Progress

Updated: 2026-09-25

## Current phase

**Specification baseline**

No implementation repository has been created by this documentation pack.

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
| Implementation | 0% | Not started |
| Production deployment | 0% | Not started |
| Pilot evidence | 0% | Not started |

## Overall delivery estimate

**20%**

Reason: product/engineering design is substantially defined, but working software and real-world evidence are still absent. Documentation completion must not be reported as product completion.

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
- Initial business niche: small barber/salon/beauty walk-in operations.
- Free-tier-first, not “guaranteed free forever.”

## Next implementation gate

Start M1 only after:
1. repository is initialized,
2. package/workspace shape is accepted,
3. CI baseline exists,
4. queue-core tests run before backend/UI work.

## Blockers

None for local implementation.

Production deployment will eventually require:
- Cloudflare account,
- Cloudflare API deployment credentials stored as GitHub secrets,
- selected production hostname/domain or workers.dev URL.
