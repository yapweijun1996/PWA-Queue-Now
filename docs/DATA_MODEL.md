# QueueNow V1 Data Model

This is the conceptual baseline. Migration details may change, but ownership and security boundaries should remain stable.

## D1 tables

### merchants

```text
merchant_id          TEXT PK
email_normalized     TEXT UNIQUE
password_hash        TEXT
status               TEXT
created_at           TEXT
updated_at           TEXT
```

If a different auth mechanism is selected during implementation, document the replacement in `DECISIONS.md`.

### shops

```text
shop_id              TEXT PK
owner_merchant_id    TEXT FK
name                 TEXT
timezone             TEXT
status               TEXT
created_at           TEXT
updated_at           TEXT
```

Default pilot timezone: `Asia/Singapore`, configurable per shop.

### shop_staff

```text
shop_id              TEXT
merchant_id          TEXT
role                 TEXT
status               TEXT
created_at           TEXT
PRIMARY KEY(shop_id, merchant_id)
```

### queue_definitions

```text
queue_id                 TEXT PK
shop_id                  TEXT FK
public_slug              TEXT UNIQUE
name                     TEXT
prefix                   TEXT
start_sequence           INTEGER
grace_period_seconds     INTEGER
service_capacity         INTEGER
status                   TEXT
created_at               TEXT
updated_at               TEXT
```

### services

```text
service_id                TEXT PK
shop_id                   TEXT FK
name                      TEXT
default_duration_seconds  INTEGER
active                    INTEGER
sort_order                INTEGER
created_at                TEXT
updated_at                TEXT
```

### display_tokens

Store a hash, not a raw reusable secret where possible.

```text
display_token_id       TEXT PK
queue_id               TEXT FK
token_hash             TEXT
status                 TEXT
created_at             TEXT
rotated_at             TEXT NULL
```

### ticket_history

Terminal/read-model projection.

```text
ticket_id                TEXT PK
queue_id                 TEXT
queue_session_id         TEXT
sequence_number          INTEGER
display_number           TEXT
service_id               TEXT
joined_at                TEXT
called_at                TEXT NULL
service_started_at       TEXT NULL
terminal_at              TEXT
terminal_status          TEXT
service_duration_seconds INTEGER NULL
wait_duration_seconds    INTEGER NULL
call_count               INTEGER
projection_revision      INTEGER
```

Do not store customer phone/name because V1 does not require them.

### audit_history

Optional D1 projection for merchant audit queries.

```text
audit_id             TEXT PK
queue_id             TEXT
queue_session_id     TEXT
actor_type           TEXT
actor_id             TEXT NULL
command_type         TEXT
ticket_id            TEXT NULL
occurred_at          TEXT
result               TEXT
safe_metadata_json   TEXT
```

Never put raw capability/session secrets into metadata.

---

## Durable Object SQLite

Each queue DO stores only that queue's operational state. SQL schema migrations are versioned in a local `schema_migrations` table and applied transactionally by the DO.

### schema_migrations

```text
version INTEGER PRIMARY KEY
applied_at TEXT NOT NULL
```

### queue_session

```text
session_id
queue_id
status
opened_at
closed_at
prefix
next_sequence
grace_period_seconds
service_capacity
config_snapshot_json
queue_revision
is_current
```

Only one active session per DO. A partial unique index enforces one `is_current = 1` row; closed sessions have `is_current = 0`. At session creation, initialize `next_sequence` from the queue definition's `start_sequence`. Store only active services in `config_snapshot_json`, including each service ID, name, and default duration, plus the prefix, grace period, and service capacity. Generate `session_id` server-side.

The strict config snapshot accepts a 1–8 character uppercase alphanumeric prefix, a positive safe `start_sequence` that leaves room for the next counter value, nonnegative grace seconds, positive service capacity, the V1 server-owned 300-second return-window buffer, and 1–100 active services. Service IDs must be unique (1–128 characters); service names are trimmed and limited to 120 characters; default durations are positive whole seconds.

`next_sequence` is the next unused positive safe integer for that session. The pure `calculateNextSequenceAllocation` helper returns that value and its successor; it rejects invalid or overflowing counters. Display numbers concatenate the session prefix with the decimal sequence padded to a minimum of three digits (for example `A025` and `A1000`). Display numbers are presentation data, not credentials.

The helper does not reserve a number or provide concurrency safety by itself. The queue DO must atomically insert the ticket and advance `next_sequence` before returning success. The unique `(session_id, sequence_number)` constraint remains the persistence-level collision guard.

### tickets

```text
ticket_id
session_id
sequence_number
display_number
service_id
lifecycle_status
presence_status
joined_at
called_at
grace_deadline
service_started_at
completed_at
cancelled_at
skipped_at
expired_at
call_count
capability_hash
last_mutation_revision
```

Constraints:
- unique `(session_id, sequence_number)`
- unique `ticket_id`
- raw capability is never stored; store a verifier/hash

### command_receipts

```text
command_id
actor_scope_hash
command_type
request_fingerprint
result_json
result_revision
created_at
expires_at
```

`command_id` is unique among retained receipts for the queue. `actor_scope_hash` is a SHA-256 digest of a stable authenticated principal/ticket scope, never a session token or capability; use canonical IDs rather than email addresses. `request_fingerprint` is a digest of the validated command intent (including target and parameters, excluding `command_id` and authentication material). `result_json` contains only the safe accepted or rejected HTTP status/body. `result_revision` records the revision associated with that result.

Authenticate and authorize each retry before looking up its receipt. An exact match on command ID, actor-scope hash, command type, and fingerprint replays the stored result without another mutation, revision, or event. Reuse of an ID with any different identity is `IDEMPOTENCY_CONFLICT`. Persist accepted state and its receipt in the same transaction. V1's documented retry horizon is 24 hours; the DO deletes expired receipts during the next command transaction, and the guarantee ends at `expires_at`. The pure queue-core decision helper does not provide persistence or concurrency guarantees.

Opening a queue persists its session snapshot and the `OPEN_QUEUE_SESSION` receipt in one transaction. The internal command's request fingerprint covers the target `queue_id`; configuration is server-supplied from D1 and is snapshotted only on first acceptance. The client-visible open response is immutable and starts at revision 0, so an exact retry replays it even if the queue is later paused or closed. If no receipt exists, the internal Worker must supply a valid snapshot; at most 100 active services are currently accepted per snapshot.

### join_receipts

```text
join_request_id
session_id
request_fingerprint
ticket_id
safe_result_json
ticket_capability_envelope_json
created_at
expires_at
```

`request_fingerprint` is SHA-256 over UTF-8 `JSON.stringify([queueId, sessionId, serviceId])` in that exact field order; it excludes `join_request_id` and `joinRecoverySecret`. `safe_result_json` stores the original ticket response without `ticketCapability`. `ticket_capability_envelope_json` stores a versioned envelope containing HKDF salt, AES-GCM nonce, and ciphertext for the server-generated capability. Derive the AES-256 key with HKDF-SHA-256 from the client-provided 32-byte recovery secret, a fresh 16-byte salt, and the domain-separated info string `QueueNow join capability recovery v1`. Use AES-256-GCM with a fresh 12-byte nonce. Define AAD as UTF-8 bytes of `JSON.stringify(["queuenow.join-capability", 1, queueId, sessionId, joinRequestId, serviceId, ticketId])` in that exact field order.

The recovery secret is never persisted. The ticket row keeps only the capability hash; the receipt keeps only the encrypted capability envelope. On retry, require a matching request fingerprint, decrypt with the supplied recovery secret, and verify the plaintext capability against the ticket hash before returning the stored result and capability. Wrong proof fails with `JOIN_RECOVERY_INVALID` without disclosing ticket data or mutating state; changed intent fails with `IDEMPOTENCY_CONFLICT`. Atomically persist the ticket, sequence allocation, revision/event, safe result, and envelope. Retain receipts for 24 hours; retry guarantees end at expiry.

### events

```text
event_id
session_id
queue_revision
event_type
ticket_id NULL
actor_type
actor_id NULL
occurred_at
safe_payload_json
```

`queue_revision` is unique within a session, not across the DO lifetime, because a reopened session starts again at revision 0. Enforce `UNIQUE(session_id, queue_revision)`. Retain enough recent events for audit/projection as required. These persisted records are not WebSocket payloads: realtime sends only the strict `queue.changed` invalidation, and clients fetch authorized snapshots. Long-term retention can be projected/compacted.

### projections_pending

```text
projection_id
projection_type
entity_id
revision
attempt_count
next_attempt_at
last_error_code
```

Used when D1 history projection fails after authoritative DO mutation already succeeded.

---

## Customer ticket identifiers

Separate:
- `ticket_id`: internal random ID
- `display_number`: human value `A025`
- `ticket_capability`: high-entropy secret shown only to holder

Never authorize using `display_number`.

A practical customer URL may contain a non-secret public ticket ID plus capability stored in browser state, or another reviewed capability URL design. The final implementation must avoid leaking reusable secrets into analytics/referrer logs.

---

## Indexes

D1 indexes should support:
- merchant by normalized email,
- shops by owner,
- queues by shop,
- queue by public slug,
- services by shop + active,
- history by queue + terminal time,
- history by session,
- staff by shop.

Do not add indexes without an actual query path.

---

## Data retention

V1 proposal:
- Active DO operational state: current session + bounded recent sessions/events.
- Ticket history: merchant-configurable future feature; initial pilot may retain 90 days.
- Security/audit logs: retain enough for incident review, with secrets redacted.

Retention is a product decision and must be stated in the privacy notice before public launch.
