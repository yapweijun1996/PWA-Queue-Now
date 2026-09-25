# QueueNow V1 State Machine

## Principle

Do not represent “Near the shop” or “Back at the shop” as ticket lifecycle states.

Two independent dimensions are used:

1. `lifecycle_status`
2. `presence_status`

This keeps queue correctness separate from customer location/intention.

---

## Lifecycle states

```text
WAITING
CALLED
SERVING
COMPLETED
SKIPPED
CANCELLED
EXPIRED
```

Terminal:
- COMPLETED
- CANCELLED
- EXPIRED

SKIPPED is non-terminal because staff may Recall.

## Presence states

```text
UNKNOWN
AWAY
NEARBY
RETURNED
```

Presence does not grant service priority unless an explicit queue policy says so.

---

## Lifecycle transitions

| From | Command | To | Actor |
|---|---|---|---|
| — | JOIN | WAITING | Customer/system |
| WAITING | CALL | CALLED | Staff |
| WAITING | CANCEL | CANCELLED | Customer/staff |
| WAITING | EXPIRE | EXPIRED | System/session policy |
| CALLED | START | SERVING | Staff |
| CALLED | RECALL | CALLED | Staff |
| CALLED | SKIP | SKIPPED | Staff |
| CALLED | CANCEL | CANCELLED | Staff |
| SKIPPED | RECALL | CALLED | Staff |
| SKIPPED | CANCEL | CANCELLED | Staff |
| SERVING | COMPLETE | COMPLETED | Staff |

Optional/manual correction transitions must not be added casually. They require a documented rule, audit event, and test.

## Forbidden examples

- COMPLETED → WAITING
- CANCELLED → SERVING
- WAITING → COMPLETED
- Customer CALL
- Customer START
- Customer changes another ticket using only `A025`

Forbidden transitions return a domain error and do not mutate revision/state.

---

## Presence transitions

Customer may normally set:

```text
UNKNOWN → AWAY
UNKNOWN → NEARBY
UNKNOWN → RETURNED

AWAY → NEARBY
AWAY → RETURNED

NEARBY → AWAY
NEARBY → RETURNED

RETURNED → NEARBY
RETURNED → AWAY
```

Presence becomes irrelevant once lifecycle is terminal.

The server may retain the last presence for audit/history but UI should not imply it remains operational.

---

## Call

On CALL:

```text
lifecycle_status = CALLED
called_at = now
grace_deadline = now + grace_period
call_count += 1
revision += 1
```

Broadcast after persistence.

## Late

`LATE` is not a stored lifecycle.

Derived:

```text
lifecycle_status == CALLED
AND now > grace_deadline
AND lifecycle_status has not changed
```

Staff sees:
- Late by N min
- Recall
- Skip
- Start

No auto-cancel.

---

## Skip / Recall

SKIP:
- CALLED → SKIPPED
- persist `skipped_at`
- add audit reason if provided

RECALL:
- SKIPPED → CALLED
- new `called_at`
- new `grace_deadline`
- increment `call_count`

Recall does not allocate a new queue number.

---

## Call Next selection

Default policy: strict FIFO among `WAITING` tickets by sequence number.

Future policy switches may consider presence, service, priority, or reservations. V1 must not implement hidden reordering.

Pseudo-rule:

```text
candidate = waiting tickets
  .sort(sequence_number ASC)
  .first()
```

Selection + transition to CALLED must occur atomically inside the authoritative queue DO.

---

## Queue state

Queue itself:

```text
OPEN
PAUSED
CLOSED
```

Rules:
- OPEN: new joins allowed.
- PAUSED: no new joins; existing tickets may still be operated.
- CLOSED: no new joins; session finalization policy runs.

Closing must not silently destroy active tickets. The close UI must explain how active tickets are handled.

---

## Revisions

Every accepted authoritative mutation increments `queue_revision`.

Rejected/duplicate-replayed idempotent commands do not produce a second logical mutation.

Clients use revision to:
- order events,
- detect gaps,
- replace stale state with authoritative snapshot.

---

## Test obligation

For every transition:
- legal transition test,
- illegal transition test,
- idempotent retry test,
- audit event assertion,
- revision assertion.

Concurrency-specific:
- simultaneous join IDs allocate unique sequences,
- same join ID retry returns same ticket,
- simultaneous Call Next commands never call the same ticket twice,
- duplicate command ID does not execute twice.
