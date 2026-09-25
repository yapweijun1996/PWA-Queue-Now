# QueueNow V1 Testing Strategy

## Test pyramid

### Unit / domain
Fast and exhaustive:
- state transitions
- candidate selection
- idempotency
- return-window calculations
- capability verification helpers
- serialization/schema validation

### Integration
`@cloudflare/vitest-plugin` with its local Miniflare Workers runtime, plus Wrangler:
- Worker → DO routing
- DO SQLite persistence
- D1 projection
- auth/capability enforcement
- WebSocket event contracts

### Concurrency
Mandatory P0 evidence:
- many unique joins in parallel
- same join request retried in parallel
- many staff Call Next commands in parallel
- duplicate command ID
- restart during/after mutation
- D1 projection failure after terminal commit

### Browser E2E
Playwright:
- customer scan/link → join → ticket
- merchant calls customer
- customer receives update
- merchant starts/completes
- display updates
- skip/recall
- reconnect
- offline mutation blocked
- service-worker update path
- session expiry
- mobile/tablet layout

## Required concurrency assertions

### 1. Unique join allocation

Run at least 50 simultaneous joins with unique idempotency IDs.

Assert:
- 50 tickets
- 50 unique sequence numbers
- contiguous/valid sequence under defined policy
- no duplicate display number

### 2. Join retry

Send same `joinRequestId` multiple times concurrently.

Assert:
- one logical ticket
- one sequence consumed
- retries return same logical result
- no additional revision for duplicate replay

### 3. Call Next race

With N waiting tickets, issue multiple `Call Next` commands concurrently.

Assert:
- each accepted command selects a different eligible ticket
- no ticket called twice from the race
- revisions are monotonic
- audit reflects actual accepted order

### 4. Duplicate command

Repeat exact `commandId`.

Assert:
- no second mutation
- original result replayed
- no second audit/state event as a logical action

## State machine coverage

Every command/state pair should be covered as:
- accepted,
- rejected,
- authorization rejection,
- idempotent replay where applicable.

Do not test only happy paths.

## Realtime

Test:
- initial WebSocket authorization
- event schema
- correct role filtering
- revision ordering
- deliberate missed event → gap detection → snapshot
- reconnect after server/object restart
- display receives no private fields

## Persistence

Test DO reconstruction after in-memory state loss:
1. create session/tickets,
2. persist,
3. simulate object restart,
4. instantiate fresh,
5. read state,
6. compare authoritative values.

## Security

Automated:
- customer cannot control another ticket,
- guessed queue number cannot control ticket,
- invalid/expired capability rejected,
- staff cannot cross shop boundary,
- CSRF regression,
- XSS-safe display fields,
- rate-limit behavior,
- secret/log redaction,
- no production secret in bundle.

## PWA

Verify:
- manifest
- installability where browser permits
- service worker registration
- update waiting state
- update-now path
- offline shell
- no offline mutation replay
- current/build version
- mobile responsive checks

## Performance targets

V1 practical targets, not guarantees:
- public page remains usable on ordinary mobile network,
- queue command server work fits Workers Free CPU constraints in normal case,
- no polling loop,
- WebSocket reconnect uses bounded exponential backoff.

Measure before optimizing.

## Acceptance evidence

For release candidate record:
- commit SHA
- CI run
- test counts
- browser E2E result
- production URL smoke result
- queue concurrency result
- migration state
- known limitations
- quota snapshot.

A release is not “done” because unit tests alone pass.
