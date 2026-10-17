# Manual development compatibility diagnostics

EVEXIA development compatibility checks run **only when explicitly requested**.
Opening the preview, waiting, returning focus, changing visibility, going
offline/online, reconnecting Vite, or editing source does not run a compatibility
probe. There is no compatibility blocking screen, fetch wrapper, special
development contract header, or compatibility-based API quarantine.

**Tradeoff:** frontend/API/schema compatibility is no longer automatically
verified. Normal access is not evidence that the frontend, loaded API source,
and database schema match. Source edits can leave a running API stale; operators
must explicitly diagnose and restart it when appropriate.

## Explicit commands

- `pnpm check:development`: read-only candidate preflight against the selected
  development configuration/database. Reports configuration, schema revision,
  required columns and functional encryption anchors. A candidate pass does
  not establish that the running API or preview ingress matches.
- `pnpm verify:development`: one bounded ingress verification against the
  development preview. Uses the shared running-release verifier to compare
  `/release-runtime.json`, `/api/v1/version` and ordinary database readiness
  against candidate frontend/backend identity. It reports success or failure
  and schedules no recurring work. The separate `/__development-release` and
  `/api/v1/development/compatibility` endpoints remain explicit diagnostics.

These commands can inspect the configured development environment: invoke them
only when the user/operator requests compatibility diagnostics. Regression
tests use disposable databases or synthetic responses, not these commands
against shared data.

The compatibility endpoint is an explicit diagnostic, not a readiness or access
gate. It returns only `{format, identity, ready}`, with HTTP 200 for a passing
check and 503 for an unverified/incompatible runtime. It is available only on
the managed development API, not production. Requests are single-flight with a
five-second finite cache (including failures); cache expiry does not start
work. A later explicit request is required. The child preflight is killed
after ten seconds. Candidate preflight has an eight-second process deadline,
bounded connection/SQL/lock timeouts; ingress verification has a 25-second
total deadline. Neither diagnostic response nor command output enables or
disables normal application access.

Reports retain fixed non-secret failure categories; missing keys, mismatched
schema revisions, unavailable databases, stale loaded source and malformed/
unreachable ingress responses remain failures, never fabricated readiness.
Detailed local reports do not expose credentials, raw exception text, URLs or
business records. Public diagnostics expose only non-secret identity and a
boolean. Inspect `checks` in the local report to distinguish
`missing_or_invalid_configuration`, `revision_mismatch`, `database_unavailable`
and `not_verified`; the latter never means success.

## Normal startup and security

Managed API startup runs Uvicorn without a development preflight.
Post-merge setup still installs frozen Node/Python dependencies; it runs neither
compatibility preflight nor ingress verification. The incoming main branch's
separately approved additive database synchronization is retained in API startup
and post-merge setup, including its migration integrity postconditions; this
task neither changes its policy nor authorizes/executes shared-data migrations.
The frontend launcher starts Vite without waiting on a live-verification loop.
The process still captures its source identity for later explicit diagnostics.
Passive served-release metadata is retained for explicit checks and production
release tooling; computing that metadata does not invoke API/database probes
or authorize access. Vite's compatibility endpoint computes its response only
on an explicit diagnostic request.

Normal API requests do not invoke development compatibility diagnostics or
require their header/result. Independent startup security configuration checks
(signing key, allowed origins, bootstrap hosts and proxy peers), host policy,
request limits, login/session validation, permissions, encryption needed by
actual operations and domain/database integrity protections are unchanged.
Ordinary health/readiness retain their independent existing semantics; they do
not invoke the development preflight. Production release, installation,
approval and validation behavior is unchanged.

## Drafts and HMR

There is no compatibility-induced logout, credential clearing, request replay,
page reload, editor reset, hidden/inert subtree or auth-renewal suppression.
Authentication denial retains its ordinary behavior.

For managed development only, the served Vite client continues suppressing its
automatic full-page reload calls (including reconnection paths). This preserves
already-mounted drafts where feasible without quarantining the app. A
notification event is emitted but does not run compatibility work or block
access. The incoming non-blocking update notice links to a separate tab without
reloading or hiding the old one. Normal React HMR still operates and only preserves state where React
supports it. An unrecognized Vite reload interface produces an explicit
development tooling error, not a fabricated successful transform. Dependency
files on disk and production clients are untouched.

Some changes require a fresh page. Open a separate preview tab yourself while
retaining an old draft tab; no automatic recovery promises to reconcile stale
frontend code or uncertain mutations. Explicit reloads/closing tabs can still
lose unsaved drafts.

## Focused regressions

- `pnpm test:development-gate`: synthetic identity, manual probe/verifier success
  and failure, cache/timeout, no automatic startup hooks or frontend gating.
- `sh scripts/test-api-foundation.sh tests/test_development_gate.py`: disposable
  PostgreSQL diagnostics, ordinary managed requests without compatibility
  enforcement, real launcher and mandatory signing validation.
- `EVEXIA_TEST_DEVELOPMENT_GATE=1 sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/development-gate.preview.spec.mjs`:
  isolated lifecycle/authentication and mounted-editor HMR regressions. The
  legacy fixture variable enables development diagnostic tooling/draft reload
  protection only, never compatibility gating or production behavior.

`pnpm validate:release` remains the separately invoked regression suite, not an
automatic development compatibility check.

## Verification evidence (2026-10-17)

Synthetic diagnostics regressions passed (7 Python and 28 Node checks).
Disposable API/database regressions passed (8 cases), including actual managed
startup with both valid and missing diagnostic prerequisites, truthful explicit
HTTP 200/503 diagnostics, ordinary HTTP 401 protection before/after diagnostics,
and rejection of missing signing configuration. Session service tests and the
frontend production build passed (existing large-chunk warning only).

The isolated Chromium scenarios passed: normal portal rendering, 31 seconds
across former polling intervals, offline/online/focus/visibility events with no
diagnostic calls or special header, protected navigation returning to login,
and the same mounted editor node/value after HMR and full-reload messages.
An initial assertion omitted the welcome heading's punctuation; correcting that
test locator and rerunning that scenario passed. The mounted-draft scenario
passed on its first run.

Both existing managed workflows restarted cleanly. Actual routed preview
screenshots showed the normal portal at `/` and the Admin login at the protected
`/admin/masters/zones` path; an unauthenticated managed API request returned 401.
No compatibility command or endpoint was invoked against the shared environment.
These checks cannot access the user's original Replit-host iframe or already-open
draft tab; the exact original embedded-preview experience remains unverified.

The completion attempt also ran `pnpm run validate:release`. Its backend/unit
groups and the first 139 broad browser cases passed, but the runner exhausted
its validation polling budget and terminated the command during the next case.
The full release suite therefore has **no passing terminal result**. Completion
records this runner limitation explicitly rather than changing or weakening
the release validation command; the scoped results above remain the task's
completed verification.
