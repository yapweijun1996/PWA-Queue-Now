# QueueNow Architecture Decision Log

## ADR-001 — Cloudflare reference runtime
**Decision:** Workers + SQLite-backed Durable Objects + D1.

**Why:** no self-managed server, real backend, realtime coordination, free-tier-first, open-source reproducibility.

**Consequence:** reference self-hosting is Cloudflare-specific in V1.

## ADR-002 — One Durable Object per live queue
**Decision:** map each `queue_id` to one authoritative DO.

**Why:** sequence allocation and Call Next are coordination-sensitive.

**Consequence:** live queue state must not be independently mutated in D1/browser.

## ADR-003 — Single web application for V1
**Decision:** one React/Vite app with customer, merchant and display routes.

**Why:** smaller repo/build/maintenance surface.

**Consequence:** route security must still be enforced server-side; sharing a bundle is not sharing authorization.

## ADR-004 — Lifecycle and presence are separate
**Decision:** ticket lifecycle does not contain `NEARBY` or `RETURNED`.

**Why:** presence should not corrupt queue-state reasoning.

## ADR-005 — Anonymous customer by default
**Decision:** no mandatory name, phone, email, account, or GPS.

**Why:** faster QR conversion and privacy minimization.

## ADR-006 — Capability-protected ticket
**Decision:** public display number is not ticket authentication.

**Why:** `A025` is guessable/public.

## ADR-007 — No offline mutation queue
**Decision:** authoritative mutations are blocked offline and never Background-Sync replayed.

**Why:** delayed queue commands can corrupt real-world ordering.

## ADR-008 — Hibernation WebSockets
**Decision:** realtime uses DO Hibernation API rather than polling.

**Why:** better realtime UX and lower free-tier usage.

## ADR-009 — Deterministic prediction
**Decision:** no AI/LLM in V1 wait estimation.

**Why:** explainability, cost, simplicity, lack of training data.

## ADR-010 — D1 is history/config, not live ordering authority
**Decision:** terminal/history projection goes to D1; live authority stays in DO.

**Why:** preserve one coordination owner.

## ADR-011 — Apache-2.0 recommended
**Decision:** use Apache-2.0 unless project owner later selects another OSI license.

**Why:** permissive open-source use with explicit patent terms.

**Action before public release:** add the canonical `LICENSE` file; do not treat this decision document as the license itself.

## ADR-012 — Free-tier-first, not free-forever
**Decision:** architecture targets S$0 pilot operation within current quotas.

**Why:** provider plans/usage change.

**Consequence:** usage must be measured and documented.

## ADR-013 — Realtime invalidation-only events
**Decision:** WebSockets send a strict `queue.changed` message containing only the queue revision and timestamp; clients retrieve role-authorized snapshots over HTTP.

**Why:** one small wire contract minimizes accidental cross-role/customer data disclosure and keeps snapshots authoritative.

**Consequence:** each update requires a scoped snapshot read; reconnects and revision gaps recover from a fresh snapshot. Persisted audit-event payloads must not be broadcast directly.

## ADR-014 — Deterministic return-window estimator
**Decision:** use the median of the supplied recent valid service-duration samples when at least five exist, otherwise the configured service default. Estimate remaining active work, schedule eligible tickets ahead in queue-selection order across the configured capacity, then center a return window on the projected start using a server-supplied buffer.

**Why:** this is explainable and deterministic without implying precision or relying on prediction models.

**Consequence:** the queue owner must provide the eligible ordered ticket durations and buffer; the estimate is advisory and refreshes with authoritative queue state.

## ADR-015 — Persisted queue-open command
**Decision:** Opening a queue creates a server-generated session ID, snapshots the validated queue/service configuration, and stores the command receipt in the same DO SQLite transaction. The open result is immutable at revision 0. Store a hash of the authenticated actor scope, not its raw value. Command receipts expire after a documented 24-hour retry horizon and are pruned during a later command transaction.

**Why:** session creation, its configuration snapshot, and retry behavior need one atomic owner; D1/config changes must not alter an already-open session or its exact retry result.

**Consequence:** the Worker must authenticate and authorize before querying a receipt or calling the DO. The internal DO command is not a public endpoint, `actorScope` is server-derived, and other command types still require the generic receipt implementation.

## ADR-016 — Separate proof for anonymous join recovery
**Decision:** each logical join uses a client-generated 32-byte recovery secret in addition to its UUID `joinRequestId`. The UUID selects a receipt but does not authorize replay. The DO stores no raw recovery secret or capability: it stores the ticket capability hash and a versioned HKDF-SHA-256/AES-256-GCM envelope in the 24-hour join receipt. An exact retry must match queue/session/service intent and decrypt the envelope with the recovery secret before returning the original result and capability.

**Why:** a committed join must be safely recoverable if its HTTP response is lost, without turning the idempotency identifier into a bearer credential or storing the raw ticket capability.

**Consequence:** the client must persist the pending ID and recovery secret before sending, then replace them with the ticket/capability only after safely storing the response. Wrong proof returns no ticket data; altered intent conflicts. Retries are explicit and online-only, never background-replayed. The cryptographic envelope and atomic retry behavior still require Cloudflare runtime implementation and tests.
