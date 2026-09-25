# Contributing to QueueNow

## Principles

Contributions must protect queue correctness first.

A UI feature is not accepted if it weakens:
- authorization,
- idempotency,
- state-machine validity,
- concurrency safety,
- auditability,
- PWA/offline boundaries.

## Development

Expected workflow:

```text
fork/branch
→ small change
→ tests
→ self-review
→ PR
→ required CI
→ review
→ merge
```

Local checks:

```sh
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:dist
```

`npm test` builds the workspaces (including a Wrangler dry run), runs Node unit tests, and runs Worker tests in the local Cloudflare runtime. Run the API Worker locally with `npm run dev --workspace @queuenow/queue-api`. Apply D1 migrations locally with `npm run d1:migrate:local --workspace @queuenow/queue-api`; do not add `--remote` unless explicitly operating on an authorized environment. These commands do not deploy to Cloudflare.

## Pull requests

Include:
- problem
- approach
- risk
- tests/evidence
- screenshots for UI changes
- migration notes
- security/privacy impact
- documentation updates

## Domain changes

Any new lifecycle transition requires:
- `STATE_MACHINE.md` update,
- transition tests,
- API behavior update,
- audit behavior,
- E2E impact review.

Any new collected customer field requires:
- purpose,
- retention,
- privacy documentation,
- UI justification.

## Scope

V1 contribution proposals for appointments/CRM/payments/notifications should be discussed separately rather than silently added.

## CI

Do not:
- skip failing required tests,
- reduce assertions just to obtain green CI,
- expose secrets in logs,
- request broad workflow permissions without need.

## Security issues

Do not disclose exploitable vulnerabilities in a public issue. Follow the repository security-reporting process once `SECURITY.md` / GitHub private vulnerability reporting is configured.

## Style

Prefer:
- small modules,
- explicit domain types,
- deterministic functions for queue rules,
- runtime schema validation at trust boundaries,
- simple UI language,
- evidence over assumptions.
