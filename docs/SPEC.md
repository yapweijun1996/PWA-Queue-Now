# QueueNow V1 Product & Engineering Specification

## 1. Scope

QueueNow V1 is a single-location, walk-in digital queue system.

### Included
- Merchant account and shop configuration
- One or more queue definitions, but one primary pilot queue
- Services with default duration
- Merchant-configurable queue prefix
- QR / public join link
- Anonymous customer joining
- Server-side queue number generation
- Client idempotency key for join
- Customer ticket secret
- Live ticket status
- Presence updates
- Return-window estimate
- Merchant queue operations
- Public read-only display
- WebSocket real-time synchronization
- D1 terminal history
- Product-grade PWA behavior
- GitHub Actions CI/CD
- Free-tier usage telemetry/guardrails

### Explicitly excluded
- Appointment booking
- Customer CRM
- Payments
- Loyalty/rewards
- Marketing
- SMS
- WhatsApp
- Email notifications
- AI/LLM estimation
- ERP integration
- Multi-tenant enterprise administration
- Hardware ticket printers
- Biometric/location tracking

## 2. Roles

### Anonymous customer
Can:
- read public queue summary,
- join,
- read their own ticket using a capability secret,
- update their own presence,
- cancel their own eligible ticket.

Cannot:
- list private ticket details,
- call/start/complete/skip tickets,
- control another ticket with queue number alone.

### Merchant owner
Can:
- configure shop/queue/services,
- manage staff,
- operate all queue commands,
- read operational history.

### Merchant staff
Can:
- operate queue commands for authorized shop,
- add manual walk-ins,
- view operational ticket data.

V1 may defer fine-grained owner/staff permission differences if both are securely authenticated, but the data model must not prevent later separation.

### Public display
Read-only:
- queue open state,
- current public serving numbers,
- next public numbers.

## 3. Queue identity

Each active queue has:
- stable `queue_id`
- public slug
- one Durable Object identity derived from `queue_id`
- queue session
- sequence prefix, e.g. `A`
- current sequence counter

Human queue number example:

```text
A025
```

The human number is presentation data, not security data.

## 4. Queue session

Opening a new business-day/session creates a session with:
- `session_id`
- `opened_at`
- `closed_at`
- starting sequence
- configuration snapshot

Sequence uniqueness requirement:

```text
UNIQUE(queue_session_id, sequence_number)
```

A sequence may reset in a new session.

## 5. Join

Client generates a UUID `join_request_id`.

Request contains:
- queue public slug/id
- service id
- `join_request_id`

Server:
1. validates queue open,
2. checks idempotency record,
3. allocates next sequence atomically,
4. creates ticket,
5. creates cryptographically random ticket capability secret,
6. calculates initial estimate,
7. persists authoritative state,
8. returns ticket view and capability.

Retry with the same `join_request_id` must return the same ticket.

## 6. Ticket lifecycle

Lifecycle states:

```text
WAITING
CALLED
SERVING
COMPLETED
SKIPPED
CANCELLED
EXPIRED
```

Presence is separate:

```text
UNKNOWN
AWAY
NEARBY
RETURNED
```

See `STATE_MACHINE.md`.

## 7. Staff command semantics

Every staff mutation includes:
- authenticated staff identity,
- `command_id` UUID,
- target queue,
- optional target ticket,
- expected revision when relevant.

Server records:
- accepted/rejected result,
- actor,
- timestamp,
- before/after revision,
- reason for rejection when safe.

An exact retry with the same `command_id`, actor scope, command type, and request fingerprint returns the original safe result. Reusing an ID for different intent fails with `IDEMPOTENCY_CONFLICT`. The DO must persist the command result atomically with any accepted state/revision/event changes.

## 8. Call Next

`Call Next` is resolved inside the queue Durable Object.

Eligible candidate policy V1:
1. ticket lifecycle is WAITING,
2. not cancelled/expired,
3. order by queue sequence by default,
4. merchant may prioritize RETURNED over UNKNOWN/AWAY only if an explicit queue policy is enabled; default V1 is strict FIFO.

The selected ticket transition and queue revision update occur atomically.

Two simultaneous `Call Next` requests must not return the same ticket.

## 9. Grace

Config:
- `grace_period_seconds` default 300

When called:
- state → CALLED
- `called_at` set
- `grace_deadline` set
- `call_count += 1`

Past grace deadline:
- lifecycle remains CALLED,
- UI derives `is_late = true`.

No automatic destructive transition.

## 10. Realtime

Use Durable Object Hibernation WebSockets.

Server broadcasts only this strict, payload-free invalidation:

```json
{
  "type": "queue.changed",
  "queueRevision": 182,
  "occurredAt": "2026-09-25T13:40:00Z"
}
```

Clients ignore duplicate/older revisions and fetch a role-authorized authoritative snapshot after a newer revision. A revision gap also forces a snapshot. WebSocket messages never carry ticket, customer, capability, or operational payload data.

## 11. Reconnection

On WebSocket reconnect:
1. establish the role-authorized connection,
2. fetch a fresh role-authorized snapshot over HTTP,
3. replace client-derived state with that snapshot; subsequent revision notifications trigger another snapshot.

Customer ticket status request requires ticket capability.

## 12. Offline

Allowed:
- cached application shell,
- cached static assets,
- last-known ticket snapshot clearly marked stale,
- non-authoritative merchant reference settings.

Forbidden offline:
- join,
- call next,
- start,
- complete,
- skip,
- recall,
- cancel,
- presence mutation.

Do not enqueue these operations for background replay.

## 13. Prediction

V1 prediction is deterministic and explainable.

Inputs:
- configured service median/default duration,
- recent completed duration median if enough samples,
- active serving ticket elapsed time,
- queue ahead,
- service capacity,
- buffer.

Output:
- lower return time,
- upper return time,
- confidence label if useful.

No model/LLM is required.

## 14. History

Terminal tickets are projected to D1:
- completed
- cancelled
- expired
- optionally skipped when session closes

If D1 projection fails, authoritative terminal result remains in DO storage and a retryable projection marker is retained. Never roll back the already completed queue action because analytics persistence failed.

## 15. Free-tier protection

The system tracks approximate:
- joins,
- staff commands,
- websocket connections/messages,
- DO writes,
- D1 writes.

Operational warnings:
- 60% budget: info
- 75%: warning
- 85%: critical
- 95%: disable non-essential analytics/export refreshes

Never silently disable authoritative queue correctness to save quota.

## 16. Security

See `SECURITY.md`.

Minimum:
- secure merchant sessions,
- CSRF defense where cookie auth is used,
- rate limiting,
- capability secrets for customer ticket control,
- read-only display tokens,
- input validation,
- no secrets in frontend bundles,
- least-privilege deployment token,
- audit trail,
- no sensitive logging.

## 17. Definition of Done

V1 is not done until:
- all acceptance criteria pass,
- concurrency tests prove no duplicate allocation/double-call,
- browser E2E passes on mobile viewport,
- reconnect tests pass,
- PWA update flow passes,
- offline mutation rejection passes,
- security checks pass,
- production deployment readback passes,
- pilot runbook exists.
