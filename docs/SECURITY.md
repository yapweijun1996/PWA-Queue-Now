# QueueNow V1 Security & Privacy Model

## Threat model

QueueNow is public internet software with:
- anonymous customer endpoints,
- predictable human ticket labels,
- merchant control actions,
- realtime connections,
- public display endpoints,
- a public source repository.

Assume attackers can inspect all frontend code and route shapes.

## Security principles

1. No security through obscurity.
2. Queue number is public presentation data.
3. Customer control requires a separate high-entropy capability.
4. Merchant actions require authenticated and authorized sessions.
5. Validate every state-changing request on the server.
6. Never trust client lifecycle/position/estimate calculations.
7. Minimize stored personal data.
8. Logs are treated as potential disclosure surfaces.
9. Deployment credentials never enter the repo.
10. Fail closed on ambiguous authorization/state.

## Customer capability

Generate with cryptographically secure randomness.

Requirements:
- high entropy,
- not derivable from queue/ticket number,
- verifier/hash persisted rather than raw token when practical,
- revocable on ticket termination/session policy,
- not emitted in public display/realtime broadcast,
- redacted from logs and error telemetry.

Do not treat `A025` as authorization.

## Merchant session

Implementation requirements:
- secure cookie: `HttpOnly`, `Secure`, appropriate `SameSite`,
- session rotation on login,
- logout revocation,
- bounded lifetime,
- rate-limited authentication,
- password storage only through an approved password-hashing/KDF design,
- CSRF protection for cookie-authenticated mutations.

If implementation replaces password auth with passkeys/OAuth/Access, document the decision and preserve these authorization goals.

## Authorization

Every merchant command checks:
- valid session,
- staff membership,
- shop/queue ownership relationship,
- action allowed for role,
- state-machine legality.

Frontend hidden buttons are not authorization.

The API Worker must authenticate and authorize before forwarding any mutation to the DO or looking up a command receipt. A Durable Object namespace binding is an internal service boundary, not an end-user authorization mechanism. Derive actor scope from the authenticated principal, use a canonical ID, hash it for receipt storage, and never accept it from the browser. Keep `/_internal/*` DO paths unforwarded by public routes.

## CSRF

For cookie-auth merchant mutation:
- verify origin where appropriate,
- use CSRF token strategy compatible with architecture,
- reject cross-site mutation attempts.

Customer capability endpoints must still validate content type/origin/rate policy as appropriate.

## XSS

- React escaping is not a complete policy.
- Avoid raw HTML.
- Sanitize any future merchant-provided rich content.
- Use CSP where compatible.
- Keep secrets out of DOM attributes that third-party scripts could read.
- V1 should avoid third-party analytics scripts.

## Rate limiting

Protect:
- login,
- join,
- presence churn,
- cancel,
- WebSocket establishment,
- public status scraping,
- merchant commands.

Rate policy should combine safe dimensions such as queue, session, IP-derived abuse bucket, account, and endpoint. Avoid long-term unnecessary IP storage.

## Realtime isolation

WebSocket connections are authorized for their role and queue/ticket scope. Every message is only a payload-free `queue.changed` revision notification; ticket, merchant, and display data is fetched through role-authorized HTTP snapshots. Customer snapshots require the ticket capability; merchant snapshots require staff authorization; display snapshots contain only sanitized public data. Never broadcast a full object and rely on frontend hiding.

## Public display

May expose:
- queue status,
- display numbers,
- optional station label.

Must not expose:
- names,
- phone/email,
- ticket capabilities,
- merchant login identity,
- internal audit metadata.

## Secrets

GitHub Actions secrets:
- Cloudflare API token
- Cloudflare account identifiers if treated as secret/config
- production secret keys

Rules:
- `.env*` ignored except safe `.env.example`
- secret scanning
- least-privilege Cloudflare token
- rotate after suspected leakage
- no secret values in Actions logs

## Privacy

Core customer flow requires no personal profile.

V1 should not request:
- customer name,
- phone,
- email,
- GPS/location,
- contacts.

Operational record can remain pseudonymous:
- ticket ID
- service
- timestamps
- lifecycle
- durations

Before public use, publish:
- what is collected,
- why,
- retention,
- merchant responsibility,
- deletion/contact process.

## Audit

Merchant commands record:
- actor identity,
- command,
- target,
- result,
- safe timestamp/revision.

Never audit raw passwords, session cookies, capability tokens, or authorization headers.

## Dependency/supply chain

CI:
- lockfile required,
- Dependabot,
- CodeQL,
- dependency review on PR where available,
- minimal GitHub Actions permissions,
- pin high-risk third-party actions to reviewed versions/SHAs where practical.

## Incident states

The UI must have explicit:
- disconnected,
- backend unavailable,
- unauthorized/session expired,
- stale data.

Do not show a successful queue action unless the authoritative server accepted it.
