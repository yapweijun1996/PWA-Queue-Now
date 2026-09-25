# QueueNow GitHub Actions CI/CD

## Objectives

- public repository
- deterministic PR checks
- no production secret exposure to untrusted fork PRs
- deployment only after required verification
- reproducible releases
- low operational cost

## Workflows

### `ci.yml`

Triggers:
- pull_request
- push to main

Jobs:
1. install with lockfile
2. lint
3. format check
4. TypeScript typecheck
5. unit/domain tests
6. state-machine tests
7. concurrency/integration tests where stable in CI
8. production build
9. Wrangler configuration/dry validation
10. artifact metadata summary

Use standard GitHub-hosted runners only.

### `e2e.yml`

Triggers:
- pull_request
- main
- manual

Runs:
- local Cloudflare-compatible dev runtime
- built web app
- Playwright mobile/tablet/desktop core flows

Required before merge once stable.

### `codeql.yml`

Triggers:
- pull_request/main where appropriate
- weekly schedule

Use GitHub-supported CodeQL workflow for JS/TS.

### `dependency-review.yml`

For PRs:
- dependency review
- reject disallowed severe dependency changes based on policy

### `deploy-production.yml`

Trigger:
- successful main workflow / protected manual dispatch

Requirements:
- GitHub Environment `production`
- least-privilege Cloudflare token
- no deploy on fork PR
- run build/tests before deployment
- run database migration in controlled step
- deploy Worker/static assets
- production smoke/readback
- record deployed SHA and URL

If post-deploy smoke fails:
- report failure clearly,
- do not claim deployment success,
- follow documented rollback/redeploy procedure.

### `release.yml`

Trigger:
- version tag

Creates:
- changelog/release notes
- version/build metadata
- GitHub Release

## Permissions

Set top-level workflow permissions to read-only where possible.

Grant per job only what is needed.

Do not use broad `write-all`.

## Secrets

Expected production secrets/config:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Other IDs may be repository variables rather than secrets if not sensitive.

Rules:
- never echo secrets
- no `.env` upload artifact
- fork PRs never receive production secrets
- deployment job only on trusted ref/environment

## Branch protection

Recommended `main` rules:
- PR required
- required CI checks
- branch up to date or merge queue policy
- no force push
- no deletion
- optional review requirement as project matures

## Dependabot

Enable for:
- npm
- GitHub Actions

Prefer bounded update cadence.

## GitHub Actions cost

Official GitHub documentation states that standard GitHub-hosted runners for public repositories are free and unlimited. Larger runners are a different billing class and are not needed for QueueNow V1.

See `SOURCES.md`.

## Example CI shape

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

Implementation should review/pin action versions according to supply-chain policy before production use.

## Quality rule

Never modify/skip a required test merely to make CI green. Fix the product or document a justified test correction with review evidence.
