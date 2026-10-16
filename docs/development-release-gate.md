# Development coordinated release gate

This gate applies only to the managed Replit development preview. There is no
production activation in this work. Production artifact commands, installation
tools, approvals, migration policy and public API behavior remain unchanged.

## Completion sequence

1. A completed merge installs the existing locked dependencies, then runs
   `pnpm check:development`. A nonzero result stops reconciliation setup.
   No migration, bootstrap, backup, key provisioning, secret replacement or
   Communication activation is performed.
2. Read the JSON report. `required_revision` is the loaded application's exact
   requirement. `current_revision` contains only known migration identifiers
   (or `unknown`); multiple/empty revisions fail. Every check is explicitly
   `pass`, a stable failure category, or `not_verified`. Configuration rules
   validate signing/host settings and independent Directory, Staff and
   Communication keyrings; Directory/account anchors and the existing exact
   readiness rules are also checked against a read-only transaction.
3. Obtain separate operator approval before any schema/crypto rollout or
   Secrets setup. Follow the existing directory/account rollout and
   [Communication configuration](communication-configuration.md) instructions.
   A blocked report is the expected outcome until this work is approved and
   completed. Never generate or replace keys just to make this gate pass.
4. Restart **artifacts/api-server: API Server** using its existing managed
   workflow. Restart **artifacts/evexia-portal: web** only when its command or
   configuration changed; keep existing draft tabs open, using a separate tab
   if the frontend needs a new page.
   API startup executes the same bounded preflight and exits nonzero before
   starting the normal service if prerequisites fail. The Vite preview remains
   available to show the blocking screen even when no API can start.
5. Run `pnpm verify:development`. This checks the source identity through Vite's
   browser-facing ingress, then the actual loaded API's compatibility/readiness
   response, through the normal HTTPS development hostname. It rejects HTML
   fallbacks, redirects, malformed/unknown JSON, stale processes and timeouts.
   No localhost proxy, hosts override or ingress replacement is installed.
6. In each existing browser tab, select **Retry compatibility check**. Only a
   successful check of that tab's contract, candidate and running API enables
   interaction. A candidate preflight pass is never activation evidence.
   Post-merge also runs the ingress verifier, so a merge over a stale running
   API reports failure instead of claiming successful setup. Restart separately
   and repeat verification; this is not an automatic restart/promotion.

## Failure categories and recovery

- `revision_mismatch` / `revision_unverified`: inspect the selected development
  database; do not upgrade, stamp, or reclassify migrations automatically.
- `missing_or_invalid_configuration`: configure the named key family through
  existing Secrets tooling after approval, retaining keys required by old data.
- `configuration_or_schema_invalid`: keyring anchors, required columns, or
  other existing functional readiness rules failed; investigate with existing
  approved operator diagnostics. No underlying exception is exposed.
- `database_unavailable`: verify database access. `not_verified` never means
  success.
- Browser `incompatible runtime` or verifier `stale_or_incompatible_api`:
  restart the managed API; it may still be serving older loaded code.
- `browser contract changed`: the browser bundle expects an older explicit
  contract. Keep this tab and its drafts; use a separate tab with the updated
  frontend to finish setup. Do not promise safe in-place conversion of a
  draft across an incompatible contract.
- `unavailable` / `unavailable_or_invalid_json` / `timeout_or_unverified`: fix
  the managed service or ingress and explicitly retry.

Operator reports contain fixed categories, non-secret contract/source identity,
known revisions and timings, never URLs, credentials, business records or raw
exception text. Public development compatibility exposes only identity and a
boolean; detailed configuration diagnostics remain a local operator command.

When the API is running but becomes incompatible, health/version/compatibility
remain reachable and readiness returns a generic 503; all other development
API paths require the browser contract header and a passing cached probe.
Authentication/permissions are still required after this check. When startup
itself fails, API endpoints are unavailable; use the Vite blocking screen and
the local preflight command as recovery access.

## Drafts, HMR and bounded work

Initial unknown/incompatible loads never mount the application. A mounted
subtree is kept hidden **and inert** during rechecks and failures, not replaced.
The gate does not log out, rotate credentials, reload, clear local drafts, or
replay mutations. Auth verification skips renewal while compatibility is
blocked. Definitive authentication denial retains its existing behavior.
In-flight completions from an older verification generation cannot reopen the
preview. A request crossing invalidation is rejected locally, not replayed:
operators must reconcile uncertain mutations through the existing workflow.

The explicit shared contract is `development-contract.json`; change its
contract identifier when frontend/API semantics become incompatible. The
process also captures a SHA-256 of application Python source and the manifest
**before** importing application routes. Vite computes the candidate identity
independently. This detects stale processes even without a Git commit change.
Backend source/manifest edits notify the browser through the existing HMR
channel. Frontend HMR invalidates compatibility before updating; recovery is
explicit. Backend-only edits can recover after API restart without reloading
the browser. A new incompatible frontend contract cannot silently authorize
the old bundle.

Healthy tabs check every 15 seconds and on focus/visibility return. Failed tabs
require explicit retry. The API uses a single-flight five-second finite cache,
including failures; no per-request DB probe flood. Preflight has an eight-second
process deadline, two-second connect and bounded SQL/lock timeouts; API child
probes are killed after ten seconds. Browser checks time out after twelve
seconds; operator ingress verification has a 25-second total deadline. These
are upper bounds for checks, **not** promises of activation timing.

There is no immutable staging, atomic promotion, automatic rollback or
last-known-good guarantee. In-place source/HMR can be diagnosed and blocked,
not undone by this gate. Full-page updates explicitly requested by the user
can still discard browser-local drafts; normal HMR preserves state only where
React supports it. Keep browser tabs open during recovery.

Vite normally reloads on some full-update paths and after server reconnection.
For the gated development service only, the served Vite client replaces those
automatic reload calls with a blocking notification. Dependency files and
production clients are not modified. An unrecognized Vite recovery interface
fails closed. A full-page update remains blocked even after retry; open a
separate preview tab while retaining the old draft tab. Portaled menus/dialogs
are hidden and inert as well as the main app; their mounted state is preserved,
and their focus traps cannot capture the recovery controls.

## Focused evidence

Run `pnpm test:development-gate` for synthetic unit and ingress checks,
`sh scripts/test-api-foundation.sh tests/test_development_gate.py` for
disposable PostgreSQL/API checks, and
`EVEXIA_TEST_DEVELOPMENT_GATE=1 sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/development-gate.preview.spec.mjs`
for Chromium initial-block/recovery and mounted real-editor retention checks.
The dedicated test switch affects development Vite only, never production
builds. Isolated fixtures retain their existing test-only migration/bootstrap
guards; the release gate itself never invokes them.

The full regression suite remains `pnpm validate:release`; it is not run on
ordinary edits or as part of recurring probes. Record observed lightweight
timings separately from test harness setup, regression and build durations.

Observed in this workspace on 2026-10-16: the blocked development candidate
report took 482–561 ms; the failed ingress verification took 138 ms (Vite passed,
API unavailable). These are **failure-path measurements**, not activation
evidence. Synthetic unit checks took about 0.3 seconds, seven disposable API/
database tests took 6.95 seconds excluding database harness setup, and the two
Chromium tests took 6.3 seconds excluding fixture startup. The frontend build
took 5.5 seconds and is separate from recurring compatibility cost.
