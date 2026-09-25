# QueueNow AI Agent Engineering Playbook

This file complements `GOAL_PROMPT.md`.

## Operating loop

For each task:

1. **Observe**
   - read relevant docs/code/tests,
   - identify current truth,
   - do not assume progress from task labels.

2. **Retrieve**
   - reuse existing queue-core patterns/contracts,
   - check prior decisions before adding a new abstraction.

3. **Reason**
   - identify invariant/risk,
   - prefer the simplest implementation that preserves correctness.

4. **Act**
   - implement one bounded slice,
   - avoid unrelated refactors.

5. **Verify**
   - unit/integration/concurrency/E2E as applicable,
   - inspect real output/state.

6. **Review**
   - self-review diff,
   - use independent review for concurrency/security/high-risk changes where available,
   - reproduce and fix/disprove P0/P1 findings.

7. **Record**
   - update TASK and PROGRESS only from evidence,
   - update architecture/spec if behavior changed,
   - commit verified work.

## Authority

Agent may:
- edit project files,
- run tests,
- run local builds,
- use local Cloudflare dev tooling,
- create verified local commits when authorized by environment.

Agent must not:
- expose secrets,
- weaken security/tests,
- invent production evidence,
- push/PR/merge unless explicitly authorized,
- perform destructive production changes without explicit authority.

## Role selection

Use specialized temporary roles only when useful:
- Domain/State-Machine Engineer
- Cloudflare Runtime Engineer
- Frontend/PWA Engineer
- Security Reviewer
- Concurrency/QA Reviewer

Do not create multi-agent complexity for trivial work.

## Definition of evidence

Good:
- test output,
- database/readback,
- API result,
- browser E2E,
- deployed smoke test,
- exact commit SHA.

Weak:
- “code looks correct,”
- task marked done,
- generated documentation with no runtime proof.

## Progress rule

Documentation completion != product completion.

Do not report 100% until implementation, deployment, and acceptance evidence are complete.
