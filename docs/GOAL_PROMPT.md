# QueueNow Autonomous Goal Prompt

Build QueueNow V1 as an open-source, free-tier-first QR digital queue product for small walk-in businesses. Product promise: **Leave the line without losing your turn.**

Use React + TypeScript + Vite for one web app with customer, merchant and display routes; Cloudflare Workers for API; one SQLite-backed Durable Object per active queue as the authoritative live state; Durable Object WebSocket Hibernation for real-time sync; D1 for merchant/config/history data; GitHub Actions for CI/CD; Vitest + Playwright for verification.

V1 MUST support: merchant setup/login; open/pause/close queue; QR generation; anonymous customer join; server-generated queue number; service selection; return window; presence Away/Nearby/Returned; customer cancel; staff walk-in add; Call Next; Start; Complete; Skip; Recall; grace handling; reconnect; public display; history; PWA install/update flow.

Invariants: browsers never generate authoritative queue numbers; ticket number is not authentication; retries cannot duplicate joins/commands; concurrent Call Next cannot call the same ticket twice; illegal state transitions fail closed; authoritative mutations never queue offline; persisted state survives DO restart/hibernation; minimize customer personal data.

Do not add appointments, CRM, payments, loyalty, WhatsApp/SMS, AI prediction or ERP integration in V1.

Work in small verified slices. For each slice: inspect → implement → test → self-review → fix P0/P1 → update TASK/PROGRESS/docs → commit verified changes. Use external reality evidence: tests, API readback and browser E2E. Never claim done from code alone. Do not weaken tests to pass. Record blockers and continue other safe work. Push/PR/merge only when explicitly authorized.
