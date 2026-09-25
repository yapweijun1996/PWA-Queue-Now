# QueueNow V1 API Contract

Illustrative REST shape. Exact route names may change only with synchronized contract/tests/docs.

All timestamps: ISO 8601 UTC over API.

All mutations accept a client/request idempotency identifier where retry may occur.

## Public queue

### `GET /api/public/queues/:slug`

Returns:
- shop display name
- queue open state
- waiting count
- approximate wait/return information
- active services
- no private ticket data

### `POST /api/public/queues/:slug/join`

Body:

```json
{
  "joinRequestId": "uuid",
  "joinRecoverySecret": "<base64url-encoded 32-byte random secret>",
  "serviceId": "..."
}
```

Response:

```json
{
  "ticket": {
    "ticketId": "...",
    "displayNumber": "A025",
    "lifecycleStatus": "WAITING",
    "presenceStatus": "UNKNOWN",
    "peopleAhead": 3,
    "returnWindow": {
      "from": "...",
      "to": "..."
    },
    "queueRevision": 42
  },
  "ticketCapability": "<server-generated high-entropy secret>"
}
```

The capability must not be exposed in logs.

For each logical join, the client generates a separate 32-byte CSPRNG `joinRecoverySecret` and persists it with `joinRequestId` before sending the request. It reuses both only for an explicit online retry of the same queue/session/service intent. `joinRequestId` locates a receipt; it is not authorization. The recovery secret is proof required to replay a retained join result and is never returned by the API.

The Durable Object stores the capability verifier on the ticket and a versioned encrypted capability envelope in the join receipt; it stores neither raw secret. The request fingerprint is SHA-256 of UTF-8 `JSON.stringify([queueId, sessionId, serviceId])`, excluding the request ID and recovery secret. A matching receipt is replayed only after envelope decryption and capability-hash verification; accepted ticket, sequence, revision, event, safe result, and envelope are committed atomically. Invalid proof returns `JOIN_RECOVERY_INVALID` without ticket data or mutation; changed intent returns `IDEMPOTENCY_CONFLICT`. Join receipts have a 24-hour retry horizon. The client replaces the pending recovery secret with the returned ticket capability only after safely persisting the ticket and capability. Never log either secret or automatically replay a pending join offline/background.

`peopleAhead` counts earlier tickets in the active session whose lifecycle is `WAITING`, `CALLED`, or `SERVING`; skipped and terminal tickets are excluded. The initial return-window calculation uses configured default service durations, current serving-ticket elapsed times, service capacity, and the session's server-owned 300-second V1 buffer. D1 history samples are not yet wired into the runtime, so the configured defaults are used for now. The public Worker must resolve the queue slug and active session server-side before forwarding an internal join; it must not accept a client-selected Durable Object identity. The current Worker still exposes only `/health` and does not yet publish this join route.

## Customer ticket

Authentication: ticket capability.

### `GET /api/tickets/:ticketId`

Returns holder-safe ticket status.

### `POST /api/tickets/:ticketId/presence`

Body:

```json
{
  "commandId": "uuid",
  "presence": "NEARBY"
}
```

### `POST /api/tickets/:ticketId/cancel`

Body:

```json
{
  "commandId": "uuid"
}
```

Only eligible states may cancel.

## Realtime

### `GET /api/realtime/queues/:queueId`

WebSocket upgrade.

Authorization depends on connection role:
- customer: own-ticket scope or public queue scope,
- merchant: authorized shop scope,
- display: read-only public display scope.

Every authorized connection receives only this strict invalidation message:

```json
{
  "type": "queue.changed",
  "queueRevision": 42,
  "occurredAt": "2026-09-25T13:40:00Z"
}
```

The message carries no ticket or customer payload. Clients fetch a role-authorized snapshot over HTTP after a newer revision; on reconnect or a revision gap, fetch a fresh snapshot. The revision orders messages; the timestamp is informational. Never send one customer's capability/private metadata to another connection.

## Merchant auth

Implementation must use secure HTTP-only sessions or another documented secure mechanism.

Representative routes:

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
```

Rate limit login.

## Merchant configuration

```text
GET    /api/merchant/shops
POST   /api/merchant/shops
GET    /api/merchant/queues/:queueId
PATCH  /api/merchant/queues/:queueId
GET    /api/merchant/queues/:queueId/services
POST   /api/merchant/queues/:queueId/services
PATCH  /api/merchant/services/:serviceId
```

## Merchant operations

Every command:
- authenticated and authorized for the queue before receipt lookup,
- has a `commandId` UUID reused only for retries of the exact same intent,
- validated against state machine.

An exact retry returns its original safe result without another mutation. Reusing a command ID for a different actor scope, command type, target, or parameters returns `IDEMPOTENCY_CONFLICT`.

```text
POST /api/merchant/queues/:queueId/open
POST /api/merchant/queues/:queueId/pause
POST /api/merchant/queues/:queueId/close
POST /api/merchant/queues/:queueId/walk-ins
POST /api/merchant/queues/:queueId/call-next

POST /api/merchant/tickets/:ticketId/start
POST /api/merchant/tickets/:ticketId/complete
POST /api/merchant/tickets/:ticketId/skip
POST /api/merchant/tickets/:ticketId/recall
POST /api/merchant/tickets/:ticketId/cancel
```

### Open queue command

Request body:

```json
{
  "commandId": "uuid"
}
```

After authenticating and authorizing the queue, the Worker derives the actor scope and calls the DO only through its internal namespace binding. The DO checks a retained receipt before requiring current configuration, so an exact retry can replay even if D1 is unavailable or the service configuration has changed. A new open requires a validated queue/service snapshot from D1 (`QUEUE_CONFIG_REQUIRED` is an internal DO response); never accept `actorScope` or configuration from the browser, and never expose the DO's `/_internal/*` paths through the public Worker.

The DO atomically stores a server-generated session ID, the configuration snapshot, and the command receipt. A session opens at revision 0. Exact retries within the 24-hour retry horizon return the original result; reusing the command ID for a different actor or queue intent returns `IDEMPOTENCY_CONFLICT`. Configuration changes made after initial acceptance do not alter the stored session or its replayed response.

Response:

```json
{
  "sessionId": "server-generated-uuid",
  "queueId": "...",
  "status": "OPEN",
  "openedAt": "2026-09-25T13:40:00Z",
  "queueRevision": 0
}
```

This describes the target public contract; the current Worker scaffold does not expose this route until merchant authentication/authorization and D1 configuration are implemented.

### Call Next command

```text
POST /api/merchant/queues/:queueId/call-next
```

Request:

```json
{
  "commandId": "uuid"
}
```

A successful response contains only the selected ticket's safe operational fields and the committed queue revision:

```json
{
  "sessionId": "server-generated-session-id",
  "ticket": {
    "ticketId": "server-generated-id",
    "displayNumber": "A025",
    "serviceId": "service-id",
    "lifecycleStatus": "CALLED",
    "callCount": 1,
    "calledAt": "2026-09-25T13:40:00Z",
    "graceDeadline": "2026-09-25T13:45:00Z"
  },
  "queueRevision": 43
}
```

When no ticket is waiting, return `409 NO_WAITING_TICKETS`; a closed queue returns `409 QUEUE_CLOSED`. These outcomes are receipt-backed: exact retries return the original result, and a rejected empty-queue command cannot call a ticket that joined later. Reusing an ID with different actor scope or command intent returns `IDEMPOTENCY_CONFLICT`. The internal DO applies strict FIFO by sequence and commits the ticket transition, grace fields, revision, `TICKET_CALLED` event, and receipt atomically. Existing tickets remain operable while the queue is PAUSED.

The DO handler is implemented only on its internal path. The public Worker still does not expose Call Next until merchant authentication/authorization and queue routing exist.

## Snapshot

```text
GET /api/merchant/queues/:queueId/snapshot
```

Returns:
- queue revision
- session
- active tickets appropriate for merchant
- serving/called/waiting counts
- connection hints

Customer snapshot is scoped to own ticket.

## History

```text
GET /api/merchant/queues/:queueId/history?date=YYYY-MM-DD
```

Reads D1 projection, not live queue truth.

## Error format

```json
{
  "error": {
    "code": "ILLEGAL_TRANSITION",
    "message": "This action is not available for the ticket.",
    "requestId": "..."
  }
}
```

Do not return stack traces or secret-bearing internal details.

Representative codes:
- `QUEUE_ALREADY_OPEN`
- `QUEUE_SESSION_ACTIVE` (internal DO response when a current session prevents creating another)
- `NO_WAITING_TICKETS` (Call Next had no eligible ticket; exact retries replay this result)
- `QUEUE_CLOSED`
- `QUEUE_PAUSED`
- `QUEUE_STATE_CHANGED`
- `QUEUE_SEQUENCE_EXHAUSTED`
- `QUEUE_REVISION_EXHAUSTED`
- `QUEUE_CALL_COUNT_EXHAUSTED`
- `QUEUE_CONFIG_INVALID`
- `INVALID_SERVICE`
- `TICKET_NOT_FOUND`
- `CAPABILITY_INVALID`
- `JOIN_RECOVERY_INVALID`
- `INTERNAL_ERROR`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `ILLEGAL_TRANSITION`
- `IDEMPOTENCY_CONFLICT`
- `QUEUE_ID_MISMATCH` (internal DO routing/configuration error)
- `QUEUE_CONFIG_REQUIRED` (internal response when a new session has no validated D1 snapshot)
- `REVISION_CONFLICT`
- `RATE_LIMITED`
- `SERVICE_UNAVAILABLE`

## Contract validation

Use one shared runtime schema source for:
- request validation,
- response validation in tests,
- TypeScript inference when practical,
- WebSocket event validation.

Frontend/backend hand-written duplicate types are not accepted.
