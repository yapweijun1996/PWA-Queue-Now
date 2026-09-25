# QueueNow V1 Product Design

## Design principle

QueueNow should feel like a small operational tool, not enterprise queue-management software.

The main design question is:

> “Can the customer confidently leave, and can the shop confidently know who is ready to be served?”

## Surfaces

### 1. Customer queue page

URL pattern:

```text
/q/{public_queue_slug}
```

Required information above the fold:
- Shop name
- Queue open / paused / closed state
- Number waiting
- Estimated wait band
- Service selector
- Primary `Join Queue` action

Do not ask for a name, email, account, or phone before joining.

After joining, replace the acquisition screen with the live ticket view.

### 2. Customer live ticket

Primary visual hierarchy:

```text
A025
2 people ahead

Return around
1:35 PM – 1:45 PM

[ I'm nearby ]  [ I'm back ]

Live status: Waiting
```

Secondary actions:
- Cancel queue
- Refresh/reconnect status
- Explain late/grace behavior

The UI should never imply second-level prediction accuracy.

### 3. Merchant dashboard

Mobile/tablet-first operational board:

```text
QUEUE OPEN          6 waiting

NOW
A021   SERVING

READY / RETURNED
A022   [CALL]

WAITING
A023   Nearby
A024   Away
A025   Unknown

[ + Walk-in ]
```

Actions must be contextual. Avoid showing every possible command on every card.

Examples:
- WAITING: Call / Skip (only if policy allows)
- CALLED: Start / Recall / Skip
- SERVING: Complete
- SKIPPED: Recall / Cancel

Dangerous or irreversible actions require a clear confirmation or undo policy.

### 4. Public display

URL pattern:

```text
/display/{read_only_display_token}
```

Large-distance readability:
- NOW SERVING
- Queue number
- Optional station
- Next 2–4 numbers

Never show customer names, phone numbers, ticket secrets, staff emails, or internal IDs.

## Presence design

Presence is not the ticket lifecycle.

`presence_status`:
- `UNKNOWN`
- `AWAY`
- `NEARBY`
- `RETURNED`

Customer-controlled:
- “I’m leaving” → AWAY
- “I’m nearby” → NEARBY
- “I’m back” → RETURNED

Presence may guide staff but must not silently change ticket lifecycle.

## Grace design

When staff calls a customer:
- ticket becomes `CALLED`,
- `called_at` is stored,
- `grace_deadline` is calculated.

If the deadline passes, show `Late` as a derived condition. Do not automatically erase the ticket.

Staff chooses:
- Recall
- Skip
- Start service if the customer arrives

## Return window

V1 uses deterministic estimates:
1. service configured duration or historical median,
2. active serving tickets and expected remaining duration,
3. number of waiting tickets,
4. configured service capacity,
5. uncertainty buffer.

Display a range, for example:

```text
Return around 1:35 PM – 1:45 PM
```

Never market the estimate as a guarantee.

## Accessibility

Minimum:
- semantic controls,
- keyboard-accessible merchant dashboard,
- visible focus,
- no color-only state meaning,
- 44px-class touch targets where practical,
- readable status labels,
- reduced-motion support,
- WCAG-oriented contrast,
- screen-reader announcement for `CALLED` status.

## PWA behavior

Merchant:
- encouraged to install
- standalone layout
- safe-area aware
- explicit update prompt with version
- update-now / later choice
- no silent forced refresh during active operation

Customer:
- works immediately in browser
- installation never required
- may cache static shell and last snapshot
- authoritative mutations disabled while offline

Display:
- full-screen friendly
- auto-reconnect
- obvious disconnected/stale indicator

## Tone

Short, operational language:
- “Join queue”
- “2 people ahead”
- “Return around 1:35–1:45 PM”
- “You’re being called”
- “Connection lost — status may be outdated”

Avoid:
- technical jargon,
- fake certainty,
- aggressive notifications,
- forced profile collection.
