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
| Implementation | 2% | Workspace/CI foundation and tested lifecycle, presence, and sequence helpers; no runtime or user flows yet |
| Production deployment | 0% | Not started |
| Pilot evidence | 0% | Not started |

## Overall delivery estimate

**22%**

Reason: product/engineering design is substantially defined and the first queue-core contracts are tested. Runtime, customer/merchant/display flows, deployment, and real-world evidence remain absent; documentation or unit tests alone are not product completion.

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
- Initial business niche: small barber/salon/beauty walk-in operations.
- Free-tier-first, not “guaranteed free forever.”

## Latest local verification

On 2026-09-25, `npm ci`, lint, format check, strict TypeScript typecheck, all 552 Vitest cases, the queue-core build, and a Node smoke test of the built package passed. Dependency audit reported zero vulnerabilities. The GitHub Actions workflow is configured but has not yet been run on GitHub.

## Next implementation gate

Finish the remaining M1 contracts and tests before backend/UI work:
- join and command idempotency,
- queue revision/event envelope,
- deterministic return-window estimator.

## Blockers

None for local implementation.

Production deployment will eventually require:
- Cloudflare account,
- Cloudflare API deployment credentials stored as GitHub secrets,
- selected production hostname/domain or workers.dev URL.
