# QueueNow V1 Task Backlog

Legend:
- `P0`: correctness/security blocker
- `P1`: V1 required
- `P2`: useful after core V1
- Status: `TODO`, `DOING`, `BLOCKED`, `DONE`

## Foundation

| ID | Pri | Task | Status |
|---|---|---|---|
| QN-001 | P0 | Initialize public monorepo/workspaces | DONE |
| QN-002 | P0 | Add strict TypeScript, lint, format, unit-test baseline | DONE |
| QN-003 | P0 | Define shared API/event schemas with runtime validation | DOING |
| QN-004 | P1 | Add local Wrangler dev config and environment template | DOING |
| QN-005 | P1 | Add version/build metadata contract | TODO |

## Queue Core

| ID | Pri | Task | Status |
|---|---|---|---|
| QN-010 | P0 | Implement lifecycle transition table | DONE |
| QN-011 | P0 | Implement independent presence model | DONE |
| QN-012 | P0 | Implement queue-session sequence allocator contract | DONE |
| QN-013 | P0 | Implement join idempotency semantics | BLOCKED |
| QN-014 | P0 | Implement command idempotency semantics | DOING |
| QN-015 | P0 | Implement queue revision/event envelope | DOING |
| QN-016 | P1 | Implement deterministic return-window estimator | DONE |
| QN-017 | P0 | Add exhaustive legal/illegal transition tests | DONE |

## Durable Object Runtime

| ID | Pri | Task | Status |
|---|---|---|---|
| QN-020 | P0 | Create SQLite-backed Queue Durable Object | DONE |
| QN-021 | P0 | Persist queue session/config snapshot | DONE |
| QN-022 | P0 | Implement atomic anonymous join | TODO |
| QN-023 | P0 | Implement atomic Call Next | TODO |
| QN-024 | P0 | Implement Start/Complete/Skip/Recall | TODO |
| QN-025 | P0 | Implement customer cancel/presence mutation | TODO |
| QN-026 | P0 | Prove restart/hibernation persistence | TODO |
| QN-027 | P0 | Add 50+ concurrent join collision test | TODO |
| QN-028 | P0 | Add concurrent Call Next double-selection test | TODO |
| QN-029 | P1 | Add D1 terminal-history projection + retry marker | TODO |

## Customer

| ID | Pri | Task | Status |
|---|---|---|---|
| QN-030 | P1 | Build public queue landing | TODO |
| QN-031 | P1 | Build service selection and join UX | TODO |
| QN-032 | P0 | Store ticket capability safely client-side | TODO |
| QN-033 | P1 | Build live ticket page | TODO |
| QN-034 | P1 | Build Away/Nearby/Returned controls | TODO |
| QN-035 | P1 | Build cancel flow | TODO |
| QN-036 | P1 | Build connection/stale indicator | TODO |
| QN-037 | P1 | Add CALLED screen-reader/live-region announcement | TODO |

## Merchant

| ID | Pri | Task | Status |
|---|---|---|---|
| QN-040 | P0 | Implement merchant authentication/session | TODO |
| QN-041 | P1 | Build shop/queue/service settings | TODO |
| QN-042 | P1 | Generate printable/shareable QR | TODO |
| QN-043 | P1 | Build operational queue board | TODO |
| QN-044 | P1 | Wire Call Next / Start / Complete | TODO |
| QN-045 | P1 | Wire Skip / Recall | TODO |
| QN-046 | P1 | Add manual walk-in | TODO |
| QN-047 | P1 | Add open/pause/close controls | TODO |
| QN-048 | P1 | Add basic daily history | TODO |

## Realtime / Display

| ID | Pri | Task | Status |
|---|---|---|---|
| QN-050 | P0 | Implement Hibernation WebSocket endpoint | TODO |
| QN-051 | P0 | Implement revisioned broadcast events | TODO |
| QN-052 | P0 | Implement reconnect + snapshot recovery | TODO |
| QN-053 | P0 | Implement revision-gap detection | TODO |
| QN-054 | P1 | Build read-only public display | TODO |
| QN-055 | P0 | Verify display leaks no private/capability data | TODO |

## PWA

| ID | Pri | Task | Status |
|---|---|---|---|
| QN-060 | P1 | Add manifest/icons/standalone metadata | TODO |
| QN-061 | P1 | Implement safe-area/status-bar behavior | TODO |
| QN-062 | P0 | Implement explicit waiting-worker update UI | TODO |
| QN-063 | P1 | Show available/current semantic build version | TODO |
| QN-064 | P0 | Cache shell/read-only snapshot only | TODO |
| QN-065 | P0 | Block authoritative mutations offline | TODO |
| QN-066 | P1 | Mobile + tablet + desktop responsive QA | TODO |
| QN-067 | P1 | Accessibility regression test | TODO |

## Security / Privacy

| ID | Pri | Task | Status |
|---|---|---|---|
| QN-070 | P0 | Generate high-entropy ticket capability secret | TODO |
| QN-071 | P0 | Enforce capability on ticket-control endpoints | TODO |
| QN-072 | P0 | Add merchant authorization on commands | TODO |
| QN-073 | P0 | Add CSRF protection for cookie-auth mutations | TODO |
| QN-074 | P0 | Add rate limits / abuse budgets | TODO |
| QN-075 | P0 | Redact secrets from logs/errors | TODO |
| QN-076 | P1 | Add audit event retention policy | TODO |
| QN-077 | P1 | Add privacy notice/minimal data inventory | TODO |

## CI/CD / OSS

| ID | Pri | Task | Status |
|---|---|---|---|
| QN-080 | P0 | Add PR CI: lint/typecheck/unit/build | DONE |
| QN-081 | P0 | Add state-machine + concurrency CI | DOING |
| QN-082 | P1 | Add Playwright mobile E2E | TODO |
| QN-083 | P1 | Add CodeQL + dependency review | TODO |
| QN-084 | P1 | Add Dependabot | TODO |
| QN-085 | P0 | Add production deploy workflow with GitHub Environment | TODO |
| QN-086 | P0 | Use least-privilege Cloudflare secret/token | TODO |
| QN-087 | P1 | Add CONTRIBUTING/SECURITY/license files | TODO |
| QN-088 | P1 | Add release/version workflow | TODO |

## Pilot

| ID | Pri | Task | Status |
|---|---|---|---|
| QN-090 | P0 | Production smoke/readback test | TODO |
| QN-091 | P0 | Simulate one business day | TODO |
| QN-092 | P0 | Verify quota/usage guardrail | TODO |
| QN-093 | P1 | Create shop pilot runbook | TODO |
| QN-094 | P0 | Exercise reconnect/outage recovery drill | TODO |
| QN-095 | P0 | Produce release evidence report | TODO |

## Scope lock

Do not implement these under V1 task IDs:
- appointments,
- CRM,
- loyalty,
- payment,
- SMS/WhatsApp/email notification,
- AI prediction,
- ERP integrations.
