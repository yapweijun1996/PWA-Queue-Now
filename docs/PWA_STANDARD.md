# QueueNow PWA Product Standard

QueueNow treats PWA as a product quality requirement, not “manifest + service worker = done.”

## Merchant PWA

MUST:
- installable manifest
- correct icons
- standalone display
- responsive mobile/tablet/desktop
- safe-area handling
- opaque/theme-consistent browser/system chrome where supported
- explicit service-worker update notification
- show available version before activation where practical
- `Update now` / `Later`
- loader/transition during activation/reload
- reliable build/cache version
- no surprise reload during queue operation
- offline/disconnected state visible
- accessibility checks
- security/privacy regression checks

## Customer experience

Customer does not need to install.

MUST:
- load as a normal mobile web page from QR
- prioritize first interaction speed
- avoid installation nags before joining
- retain ticket access in browser storage for the active ticket
- restore safe ticket context after navigation/reload
- show stale/disconnected state clearly
- never perform authoritative mutations offline

## Public display

MUST:
- work in ordinary browser full-screen mode
- auto-reconnect with backoff
- show connection status when stale
- remain readable at distance
- not expose private fields

## Service worker cache policy

Cache:
- versioned static assets
- app shell
- offline page
- optionally last-known read-only ticket snapshot

Do not cache as authoritative:
- live queue command responses in a way that can replay stale success
- authenticated merchant mutations
- join mutation
- capability-bearing sensitive responses beyond reviewed need

## Offline policy

When `navigator.onLine` or actual API connectivity is unavailable:

Merchant:
- disable call/start/complete/skip/recall/open/close
- show clear connection banner

Customer:
- disable join/cancel/presence
- show last snapshot timestamp

No Background Sync for queue mutations.

## Update UX

Flow:

```text
New version v1.2.0 available
[Update now] [Later]
```

If Update now:
1. preserve non-secret recoverable UI state,
2. activate waiting worker,
3. show updating indicator,
4. reload after activation,
5. reconnect/fetch authoritative queue state.

Do not silently `skipWaiting` and reload an operator in the middle of an action.

## Versioning

- semantic app version from package/release metadata
- immutable build identifier from Git commit SHA
- cache keys include build identifier
- UI can expose version in Settings/About

## QA viewports

Minimum representative browser QA:
- mobile ~390×844
- small mobile ~360×800
- tablet ~834×1112
- desktop ~1440×900

Check:
- no accidental horizontal overflow,
- safe-area correctness,
- focus/keyboard,
- touch targets,
- modal/sheet usability,
- queue state legibility.
