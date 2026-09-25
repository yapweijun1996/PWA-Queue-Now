# QueueNow V1 Epics

## E01 — Repository & Engineering Foundation
Outcome: reproducible monorepo, shared contracts, local development, quality gates.

Key deliverables:
- workspace/package structure
- TypeScript strict configuration
- formatting/linting
- test harness
- Wrangler dev configuration
- environment/secrets documentation

## E02 — Queue Core & State Machine
Outcome: deterministic domain logic independent of UI.

Key deliverables:
- ticket lifecycle rules
- presence model
- queue session/sequence rules
- idempotent commands
- revision model
- estimator interfaces
- exhaustive state-transition tests

## E03 — Cloudflare Authoritative Runtime
Outcome: one Durable Object per queue safely owns live state.

Key deliverables:
- DO routing
- SQLite persistence
- atomic sequence allocation
- Call Next concurrency safety
- command idempotency
- event log
- reconnect/snapshot support
- D1 history projection

## E04 — Customer QR Experience
Outcome: a first-time customer can join in seconds without an account.

Key deliverables:
- public queue landing
- service selection
- join
- private ticket capability
- ticket status
- return window
- presence controls
- cancel
- reconnect/stale handling

## E05 — Merchant PWA
Outcome: shop staff can run a full queue from phone/tablet.

Key deliverables:
- auth
- shop/queue setup
- service config
- QR generation
- queue board
- Call Next
- Start
- Complete
- Skip/Recall
- Add walk-in
- open/pause/close
- explicit PWA update flow

## E06 — Public Display & Realtime
Outcome: all operational surfaces stay synchronized.

Key deliverables:
- read-only display
- hibernatable WebSockets
- reconnect/backoff
- revision-gap recovery
- connection/stale indicators
- accessibility announcements

## E07 — Security, Privacy & Abuse Controls
Outcome: public open-source service is safe enough for pilot use.

Key deliverables:
- customer capability tokens
- merchant authorization
- rate limits
- validation
- audit events
- CSRF/session controls
- secret handling
- privacy minimization
- public-display sanitization

## E08 — CI/CD & Open-Source Readiness
Outcome: every change is independently testable and deployment is reproducible.

Key deliverables:
- GitHub Actions CI
- CodeQL
- Dependabot
- build
- Playwright
- Wrangler dry run
- production deploy workflow
- contribution/security docs
- license decision

## E09 — Pilot Readiness
Outcome: QueueNow can survive a real small-shop business day.

Key deliverables:
- pilot setup guide
- operator runbook
- quota dashboard/alerts
- backup/export plan
- incident states
- production smoke tests
- evidence report
