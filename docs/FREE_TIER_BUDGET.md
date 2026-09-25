# QueueNow Free-Tier Budget

Verified against official service documentation on 2026-09-25. Limits may change; re-check before production decisions.

## GitHub

For a public repository using standard GitHub-hosted runners:
- GitHub documentation describes standard runner usage as free/unlimited for public repositories.
- Larger runners are not required.

## Cloudflare Workers Free

Current documented headline limits:
- 100,000 Worker requests/day
- 10 ms CPU/invocation
- 128 MB memory

Static assets:
- static asset requests can be free/unlimited when served directly as static assets rather than invoking Worker logic.

Design implication:
- do not route every static asset through Worker code unnecessarily.

## Durable Objects Free

Current documented headline limits:
- 100,000 request units/day
- 13,000 GB-s/day
- SQLite-backed Durable Objects supported

WebSocket billing behavior:
- initial WebSocket connection is a request,
- outgoing WebSocket messages are not charged as request units,
- incoming application messages use a 20:1 billing ratio for DO request billing,
- Hibernation avoids duration charges while eligible/idle.

Design implication:
- use Hibernation WebSockets,
- avoid polling,
- avoid unnecessary client heartbeat messages.

## D1 Free

Current documented headline limits:
- 5,000,000 rows read/day
- 100,000 rows written/day
- 5 GB total storage

Design implication:
- do not write every transient UI event to D1,
- project terminal/history records,
- keep live operational truth in the queue DO.

## V1 planning budget

Use a conservative operational model rather than theoretical maximum.

Reference target:
- pilot: <= 20 shops
- <= 2,000 tickets/day total

This is a planning target, not a provider guarantee.

At this scale, QueueNow should have substantial headroom if:
- static requests bypass Worker runtime,
- live updates use WebSockets,
- clients do not poll,
- each logical command performs bounded storage work.

## Budget telemetry

Track:
- Worker API requests
- WebSocket connection count
- incoming application WebSocket message count
- DO storage reads/writes if exposed
- D1 rows read/written
- ticket joins
- staff commands

Internal thresholds:
- 60%: info
- 75%: warning
- 85%: critical
- 95%: shed non-essential work

Non-essential examples:
- refresh-heavy analytics
- convenience exports
- diagnostic detail

Never shed:
- integrity checks
- authorization
- idempotency
- persistence required for an accepted authoritative command

## Failure policy

Cloudflare Free limits can cause further operations of an exceeded type to fail.

Therefore:
- never promise “free forever,”
- expose service degradation clearly,
- never fabricate local queue success,
- upgrade or reduce load before approaching sustained limits.

## Cost exclusions

“Zero-cost V1” excludes:
- optional custom domain purchase,
- SMS,
- WhatsApp paid messaging,
- email provider costs,
- paid observability,
- paid Cloudflare tier,
- paid GitHub larger runners.

These are not required for the reference pilot.
