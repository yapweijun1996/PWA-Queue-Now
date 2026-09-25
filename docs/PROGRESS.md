# QueueNow Progress

Updated: 2026-09-25

## Current phase

**M1 — Deterministic Queue Core (in progress)**

The npm workspace, strict TypeScript/quality baseline, and GitHub Actions CI workflow are initialized. Pure lifecycle, presence, and sequence rules are implemented and locally verified; runtime, web app, and Cloudflare resources are not implemented.

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
| Implementation | 5% | Workspace/CI foundation, tested queue-core helpers, initial customer API schemas, revision arithmetic, and command-receipt decision semantics; no runtime or user flows yet |
| Production deployment | 0% | Not started |
| Pilot evidence | 0% | Not started |

## Overall delivery estimate

**25%**

Reason: product/engineering design is substantially defined and initial queue-core/shared-schema code is tested. Runtime, customer/merchant/display flows, deployment, and real-world evidence remain absent; documentation or unit tests alone are not product completion.

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
- `packages/contracts` owns shared enums/schemas; queue-core imports only its dependency-free domain subpath.
- Initial business niche: small barber/salon/beauty walk-in operations.
- Free-tier-first, not “guaranteed free forever.”

## Latest local verification

On 2026-09-25, `npm ci`, lint, format check, strict TypeScript typecheck, all 573 Vitest cases, both workspace builds, and Node smoke tests of both built packages passed. Dependency audit reported zero vulnerabilities. The GitHub Actions workflow is configured but has not yet been run on GitHub.

## Next implementation gate

Finish the remaining M1 contracts and tests before backend/UI work:
- complete shared API/event schema coverage,
- join-retry/capability recovery and transactional command-receipt persistence,
- queue revision/event envelope and transactional persistence,
- deterministic return-window estimator.

## Blockers

- `QN-013` is blocked on a safe join-retry/capability-recovery contract. The API requires retrying the same join to return the same ticket and includes a server-generated capability, while storage currently keeps only its hash. The `joinRequestId` is described as an idempotency UUID, not an authorization credential. Do not return a capability based only on replaying it until the recovery credential, storage, and redaction contract is explicitly reviewed. Other independent work can continue.

Production deployment will eventually require:
- Cloudflare account,
- Cloudflare API deployment credentials stored as GitHub secrets,
- selected production hostname/domain or workers.dev URL.
