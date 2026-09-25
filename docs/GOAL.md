# QueueNow V1 Goal

## Mission

Build an open-source QR digital queue product that lets customers leave a physical line without losing their turn, while giving small walk-in businesses a simple, reliable way to operate the queue from phones, tablets, or desktops.

## Primary user

V1 is optimized for a small barber / salon / beauty shop:
- 1–10 staff
- Walk-in customers
- One primary queue per location
- Customers may wait outside the shop
- Staff should not need dedicated queue hardware

## Customer outcome

A customer should be able to scan a QR code and, within seconds:
- understand whether the queue is open,
- join anonymously,
- receive a unique queue number,
- see a realistic return window,
- leave and monitor status,
- tell staff they are nearby or back,
- know when they are called.

No account, app-store download, customer name, or phone number is required for the core V1 flow.

## Merchant outcome

A merchant should be able to:
- create/configure a shop and queue,
- print/share a QR code,
- install the merchant PWA,
- operate the queue with a few high-confidence actions,
- safely handle late/skipped customers,
- keep all active screens synchronized,
- review a basic daily history.

## Engineering outcome

The project must be:
- public/open-source,
- reproducible from the repository,
- continuously tested with GitHub Actions,
- deployable without a self-managed server,
- free-tier-first on Cloudflare,
- deterministic for authoritative queue decisions,
- resilient to retries and concurrent staff actions,
- privacy-minimizing by default.

## Product thesis

QueueNow is not “another ticket-number app.”

Its V1 differentiators are:
1. **Return window** instead of fake minute-level precision.
2. **Presence state**: Away / Nearby / Returned.
3. **Grace handling**: called customers are recoverable rather than instantly deleted.
4. **Anonymous core flow**: no mandatory customer profile.
5. **Small-business simplicity**: no enterprise hardware or complex setup.

## V1 success

The V1 milestone is successful when one real shop can operate a full business day with QueueNow and:
- no duplicate queue numbers,
- no double-call of the same next ticket,
- no lost terminal ticket records,
- live customer/staff/display synchronization,
- safe reconnection behavior,
- merchant actions auditable,
- customer flow usable on a normal mobile browser,
- the merchant experience installable as a product-grade PWA,
- CI and deployment reproducible from GitHub.
