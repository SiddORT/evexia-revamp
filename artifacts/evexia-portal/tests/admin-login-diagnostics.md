# Admin sign-in diagnosis

## Evidence and boundary (2026-10-14)

The reported message alone does not identify the failing service operation.
`adminSession.js` uses one request helper for login, refresh and `/me`.
HTTP responses other than 401, 403 and 429 map to
“The sign-in service is unavailable. Try again later.” This includes routing
errors such as 404/405 and genuine 5xx outages. A network rejection has separate
connection feedback, and malformed successful responses have separate invalid
response feedback. No arbitrary server response text is displayed.

Read-only checks of this workspace found:

- The managed portal listener started successfully on its configured port.
  The earlier reported port conflict was not reproduced.
- Through the development preview router, `GET /admin/login` returned 200 HTML,
  `GET /api/v1/health/readiness` returned 200 with `status: ready`, and
  unauthenticated `GET /api/v1/auth/me` returned the expected 401 JSON.
- `OPTIONS /api/v1/auth/login` returned 405 JSON, confirming that this URL
  reaches the API rather than a static HTML fallback. This is not a login test.
- A read-only database transaction found revision `0036_reference_privacy`;
  the existing account-crypto readiness guard passed with the runtime settings.
  No account rows, secret values, credentials, or database identifiers were
  printed. No account changes, migrations or login attempts were made against
  the configured workspace database.

These checks establish local routing and relevant runtime readiness only.
They do not prove that the reported deployment has the same revision,
configuration or healthy services, or that a real account can sign in.
No bounded authentication/routing defect was confirmed, so no security checks,
session rules or server error handling were changed. SMTP readiness is a
separate recovery prerequisite, not an established cause of login failure.

## If the deployed failure persists

The missing evidence is a failing request's **operation** (`login`, `refresh`,
or `me`), **HTTP status**, timestamp and server-generated request ID, correlated
with sanitized server logs in that same runtime. Record those fields only:
do not export a HAR, request bodies, identifiers, cookies, authorization
headers, tokens, response payloads or full URLs with queries/fragments.

Proposed next action, subject to separate operator approval: reproduce once
with an approved synthetic identity in the affected environment and collect
those bounded fields, then run the existing read-only readiness/account-crypto
checks in that runtime. A synthetic login creates a session and audit records
and replaces earlier sessions for that identity; it must not use a real user's
account. A failed attempt also consumes rate-limit budget.

If this establishes a schema/configuration blocker, report the exact required
revision or fixed configuration category before proposing any change. Do not
run migrations, change keys, reset passwords, restart deployed services, push
to a deployment-triggering branch, or deploy as part of this diagnosis.

## Reproducible isolated checks

Run these serially, not against configured workspace/production accounts:

```sh
sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/admin-auth.preview.spec.mjs
sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/password-recovery.preview.spec.mjs
```

The harness uses disposable PostgreSQL, distinct private API/portal listeners
and synthetic credentials. The recovery suite replaces delivery with a local
outbox and must run alone to select that fixture. The Admin assertions cover
unavailable responses from refresh, login and `/me`, fail-closed access,
explicit successful retry, existing invalid/throttled/network feedback, and
desktop/mobile click-triggered guidance. The recovery assertions cover the
separate staff entry, reset and subsequent authenticated staff sign-in.

Verification in this session: the Admin suite passed 13 scenarios on its first
pass; one new test incorrectly expected the public login route to refresh a
session. After correcting only that test to enter through `/admin`, a targeted
run collected exactly that one scenario and passed. All 14 Admin scenarios
therefore have passing evidence against unchanged application code. The
standalone recovery suite passed both scenarios. All 36 session-module unit
tests and the portal production build also passed.

The existing workspace release workflow was already failing four historical
Allergen migration tests before these changes. That unrelated release failure
is not evidence of a login outage and is outside this repair's scope.
