# QueueNow V1 Architecture

## Architecture goal

Keep the operational truth small, centralized, strongly coordinated, and cheap.

```text
                       GitHub
                         │
                   GitHub Actions
                         │
                         ▼
                Cloudflare deployment
                         │
          ┌──────────────┼──────────────┐
          │              │              │
      Static web     Worker API     D1 database
          │              │              │
 Customer/Merchant       │         config/history
 /Display routes         │
          │              ▼
          └──────► Queue Durable Object
                         │
                  authoritative live state
                         │
                 Hibernation WebSockets
             ┌───────────┼────────────┐
             ▼           ▼            ▼
          customer     merchant      display
```

## Why one Durable Object per queue

The queue is a coordination problem:
- many customers may join at once,
- multiple staff may press actions at once,
- every screen must converge on the same order,
- sequence allocation must not duplicate,
- Call Next must select exactly one ticket.

Derive the Durable Object ID from stable `queue_id`.

The DO owns:
- active queue session,
- sequence counter,
- active tickets,
- lifecycle transitions,
- presence,
- queue revision,
- command idempotency,
- live event log/window,
- WebSocket connections,
- persisted live state.

## Why D1 is not the live queue authority

D1 stores relational/business records well, but the V1 design avoids using distributed client/API calls against D1 as the ordering authority for every live operation.

D1 owns:
- merchant account/profile,
- shops,
- queue definitions,
- service configuration,
- staff membership,
- terminal/history projection,
- aggregate daily reporting.

The DO remains authoritative during the active queue session.

## Data ownership rule

A field must have one primary owner.

Examples:

| Data | Owner |
|---|---|
| Current sequence counter | Queue DO |
| Active ticket lifecycle | Queue DO |
| Active ticket presence | Queue DO |
| Live queue revision | Queue DO |
| Merchant/shop config | D1 |
| Service defaults | D1, snapshotted into session |
| Completed ticket summary | Queue DO first, then D1 projection |
| UI cache | Browser, non-authoritative |

## Package dependency direction

`packages/contracts` owns shared queue enums, API request/response schemas, and inferred wire types. Its `domain` subpath contains only dependency-free domain values/types; runtime validators are isolated in the schema module. `packages/queue-core` may depend on `contracts/domain`, but contracts must never depend on queue-core. Workers validate untrusted requests with contracts before applying queue-core rules. A generic event envelope is not sufficient to prove role-specific payloads contain no private data.

## Web app

V1 uses one Vite/React application to reduce duplicate bundles and UI infrastructure.

Routes:
- `/q/:slug`
- `/ticket/:publicTicketId`
- `/merchant/*`
- `/display/:token`
- `/offline`

Customer installation is optional and never required.

Merchant route is designed as the installable PWA experience.

## API routing

Cloudflare Worker:
- validates HTTP shape,
- resolves shop/queue,
- validates auth/capability,
- routes live commands to queue DO,
- handles D1 configuration/history,
- emits safe responses.

Business-state transition logic should remain reusable in `packages/queue-core`.

## Realtime

Use DO Hibernation WebSocket API.

Connection metadata attachment may contain:
- connection role,
- safe queue/ticket identifier,
- last revision,
- authorization scope fingerprint.

Do not serialize raw bearer/capability secrets into WebSocket attachments.

Events are versioned by `queueRevision`.

When a gap is detected, client fetches a new authoritative snapshot.

## Durable persistence

Do not rely on in-memory arrays as truth. DO memory is disposable.

Persist:
- current queue session,
- sequence,
- tickets,
- idempotency receipts,
- queue revision,
- required event/audit data.

Hibernation/restart must reconstruct correct state from storage.

## Failure model

### D1 unavailable during terminal history projection
- queue terminal mutation remains committed in DO,
- mark projection pending,
- retry later,
- do not resurrect the ticket.

### WebSocket disconnect
- HTTP state remains authoritative,
- client shows reconnecting/stale,
- reconnect fetches snapshot.

### Browser offline
- block mutations,
- retain last snapshot only.

### Worker/DO quota exhaustion
- fail closed for authoritative operations,
- show explicit service-unavailable state,
- never locally invent queue success.

## Scaling boundary

One queue maps to one DO. This naturally partitions shops/queues.

If one future queue becomes extremely high-throughput, redesign may be required. That is out of V1 scope.

## Runtime cost principles

- static asset requests should bypass Worker execution when possible,
- no periodic client polling,
- use WebSockets for live updates,
- use hibernation,
- avoid high-frequency heartbeat messages,
- batch safe non-critical realtime payloads when useful,
- avoid unnecessary D1 writes,
- project only terminal/history data that is needed.

## Free-tier assumptions

As verified 2026-09-25 from official Cloudflare documentation:
- Workers Free: 100,000 requests/day, 10 ms CPU per invocation, 128 MB memory.
- Static asset requests: free/unlimited when served as static assets without Worker invocation.
- Durable Objects Free: 100,000 request units/day and 13,000 GB-s/day; SQLite-backed DOs are supported on Free.
- D1 Free: 5 million rows read/day, 100,000 rows written/day, 5 GB total storage.

These are external service limits and may change. `SOURCES.md` records source links and dates.
