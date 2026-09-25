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
  "ticketCapability": "returned-once-or-via-reviewed-safe-retry-contract"
}
```

The capability must not be exposed in logs.

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
- customer: only own safe ticket events or safe public queue events,
- merchant: authorized shop operational stream,
- display: read-only sanitized display stream.

Never send one customer's capability/private metadata to another connection.

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
- `QUEUE_CLOSED`
- `QUEUE_PAUSED`
- `INVALID_SERVICE`
- `TICKET_NOT_FOUND`
- `CAPABILITY_INVALID`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `ILLEGAL_TRANSITION`
- `IDEMPOTENCY_CONFLICT`
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
