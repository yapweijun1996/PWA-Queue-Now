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

Each queue DO stores only that queue's operational state.

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
```

Only one active session per DO.

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
actor_scope
command_type
request_fingerprint
result_json
accepted_revision
created_at
expires_at
```

Used for safe retry/idempotency.

### join_receipts

```text
join_request_id
ticket_id
safe_result_json
created_at
expires_at
```

The safe result must not become a general disclosure path for the ticket secret. Implementation must decide how the original capability is replayed safely to the same joining client.

### events

```text
event_id
queue_revision
event_type
ticket_id NULL
actor_type
actor_id NULL
occurred_at
safe_payload_json
```

Retain enough recent events for reconnect/audit. Long-term retention can be projected/compacted.

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
