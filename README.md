# QueueNow

**QueueNow** is an open-source, free-tier-first QR digital queue system for small walk-in businesses.

> **Product promise:** Leave the line without losing your turn.

A customer scans a QR code, joins anonymously, receives a queue number, sees a realistic return window, and can leave the physical waiting area. Staff operate the queue from an installable merchant PWA. Customer pages, staff tablets, and a public display stay synchronized in real time.

## V1 target

Primary launch niche: small barber / salon / beauty businesses with walk-in traffic.

V1 deliberately does **not** include appointments, CRM, payments, loyalty, SMS/WhatsApp, AI prediction, or ERP integration.

## Core V1 flows

### Customer
1. Scan shop QR.
2. See queue status and approximate wait.
3. Select service.
4. Join without mandatory login/name/phone.
5. Receive ticket such as `A025`.
6. See people ahead and an estimated return window.
7. Optionally mark presence: Away / Nearby / Returned.
8. Receive live in-page updates while connected.
9. See `YOUR TURN` when called.
10. Cancel their own ticket if still eligible.

### Merchant
1. Sign in.
2. Open / pause / close the queue.
3. View waiting, called, serving, skipped, and completed tickets.
4. Call Next.
5. Start service.
6. Complete service.
7. Skip or recall a ticket.
8. Add a walk-in ticket for a customer who cannot scan.
9. View basic daily history and service-time statistics.

### Public display
Shows only non-sensitive operational information:
- Now serving
- Next few queue numbers
- Queue status

## Architecture

- **Frontend:** React + TypeScript + Vite PWA
- **API:** Cloudflare Workers
- **Live authoritative queue:** SQLite-backed Cloudflare Durable Objects
- **Real-time:** Durable Object WebSocket Hibernation API
- **Long-term relational data / history:** Cloudflare D1
- **CI/CD:** GitHub Actions
- **Tests:** Vitest + Playwright
- **Open source:** Apache-2.0 recommended
- **Hosting goal:** S$0/month for development and small production pilots within free-tier limits

The system does not require a self-managed VPS, Nginx, PM2, PostgreSQL server, or always-on Mac mini.

## Repository shape

```text
queuenow/
├─ apps/
│  └─ web/                 # planned: customer, merchant and display routes
├─ workers/
│  └─ queue-api/           # Worker health route and SQLite DO schema foundation
├─ packages/
│  ├─ contracts/           # shared API/event schemas and types
│  └─ queue-core/          # deterministic queue rules
├─ docs/
├─ .github/workflows/
├─ package.json
├─ package-lock.json
└─ biome.json
```

## Non-negotiable invariants

1. Queue numbers are generated server-side, never by the browser.
2. One active queue has one authoritative Durable Object.
3. Every mutation is authenticated/authorized as appropriate and idempotent where retries can occur.
4. A visible queue number is not a secret and is never sufficient to control a ticket.
5. Offline clients may read a clearly marked stale snapshot but may not perform authoritative queue mutations.
6. Staff commands must obey the state machine.
7. Multiple staff pressing `Call Next` concurrently must never call the same ticket twice.
8. Live state survives Durable Object hibernation/restart because authoritative state is persisted.
9. Customer personal data is optional for the core queue experience.
10. No production acceptance without automated concurrency, state-machine, security, PWA, and E2E evidence.

## Documentation

Start with:
- `GOAL.md`
- `SPEC.md`
- `ARCHITECTURE.md`
- `STATE_MACHINE.md`
- `DATA_MODEL.md`
- `API.md`
- `ACCEPTANCE_CRITERIA.md`
- `TASK.md`
- `PROGRESS.md`

`GOAL_PROMPT.md` is the compact autonomous engineering contract for an AI coding agent.
