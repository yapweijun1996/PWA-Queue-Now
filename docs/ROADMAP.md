# QueueNow V1 Roadmap

Roadmap ordering is dependency-driven, not calendar-driven.

## M0 — Specification Baseline
Status: COMPLETE

Exit:
- product scope fixed,
- architecture selected,
- state model defined,
- security boundary defined,
- task backlog created.

## M1 — Deterministic Queue Core
Depends on: M0

Build first because UI must not invent business rules.

Exit:
- lifecycle + presence implemented,
- idempotency primitives,
- sequence allocator contract,
- estimator contract,
- exhaustive unit/property tests.

## M2 — Authoritative Durable Object Runtime
Depends on: M1

Exit:
- one DO per queue,
- persisted SQLite live state,
- join/sequence atomicity,
- Call Next atomicity,
- command event log,
- restart/readback tests,
- concurrency tests.

## M3 — Customer Flow
Depends on: M2

Exit:
- QR/public landing,
- anonymous join,
- capability-protected ticket,
- live status,
- presence,
- cancel,
- return-window display,
- reconnect/stale behavior.

## M4 — Merchant Flow
Depends on: M2

Exit:
- secure login/session,
- queue/service setup,
- QR,
- board,
- call/start/complete/skip/recall,
- manual walk-in,
- open/pause/close.

## M5 — Realtime + Display
Depends on: M3, M4

Exit:
- Hibernation WebSocket,
- customer/staff/display broadcast,
- revision-gap recovery,
- display sanitization,
- reconnection tests.

## M6 — PWA Product Standard
Depends on: M3, M4

Exit:
- manifest/icons,
- safe-area/system chrome,
- install behavior,
- update available UX,
- update now/later,
- version visibility,
- offline shell,
- authoritative offline mutations blocked,
- mobile/accessibility QA.

## M7 — Security & CI/CD
May run progressively from M1; final gate after M6.

Exit:
- rate limits,
- CSRF/session controls,
- secret scan,
- CodeQL,
- Dependabot,
- PR CI,
- production deployment workflow,
- security/privacy regression suite.

## M8 — Pilot Release Candidate
Depends on: all previous milestones.

Exit:
- production deployment,
- smoke test,
- concurrency load simulation,
- quota budget evidence,
- pilot runbook,
- failure/recovery drill,
- one-day pilot readiness sign-off.

## Post-V1 candidates

Only after V1 evidence:
- multi-location,
- richer staff roles,
- optional notifications,
- appointments,
- advanced analytics,
- custom branding,
- hosted QueueNow Cloud plans.

Do not pull post-V1 scope into V1 without an explicit scope decision.
