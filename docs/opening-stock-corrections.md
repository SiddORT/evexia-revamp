# Saved Opening Stock corrections

## Scope and safeguards

`opening_stock.edit` is a separate assignable permission. Existing view, add,
import and export grants do not acquire it. The editor supports item/type,
quantity, rate, location, recorded date and explicit optional expiry; technical
identities, creator, creation time and derived units/value stay server-owned.

Preview and commit revalidate the expected version, active item/location,
whole-combo and exact decimal rules under the common inventory writer lock.
Blank manual rate means zero; blank expiry means unknown.

Original opening records and lots remain immutable. Each correction reverses
the current lot's remaining opening credit, creates one revision-specific lot,
and posts the reviewed replacement once, atomically. No lot metadata is relabelled.
Saved revision evidence retains before/after fields plus editor and time.
Ledger reversal/replacement events use that revision's evidence; original
postings continue to use original evidence.

Any non-opening posting in any retained opening lot, even a net-zero transfer,
blocks corrections. Retained expiry separation, disposal or actual-cost
evidence also blocks corrections. Dated expired/expiry-today stock cannot be
revived through an item or expiry change. Unknown expiry may be explicitly
corrected on an otherwise eligible opening. Usability and Unallocated rules,
historical losses, notification schedules and already sent notifications are
unchanged. Superseded lots retain zero balances and cannot supply operations.

Imports recognize original and all retained revision business snapshots for
the immutable source/row identity. They return the current opening without
posting or undoing a correction. Unknown conflicting snapshots still fail.
Current exports keep the existing 13-column layout; the exact old 12-column
layout still treats missing expiry as unknown.

Add, import and edit retain one owner-bound unresolved request boundary.
Only opaque request identity and operation/record context are browser-persisted;
draft business fields remain in memory. Terminal negative reconciliation
durably cancels the key under the same inventory lock, so late requests cannot
commit after a reported non-save. Legacy pending identities remain readable.
Committed reconciliation requires the originating operation's permission.

## Opening-only development activation

The correction migration is
`artifacts/api-server/backend/alembic/versions/0098_opening_corrections.py`.
Its previously unapplied ancestry was narrowed to `0096_hsn_master` for the
opening-only activation. It adds the encrypted,
immutable `opening_stock_revisions` table and non-null
`inventory_lots.opening_revision`, and replaces the one-lot-per-opening unique
constraint with one lot per opening/revision. Existing lots default to revision
one; no existing payload or stock transaction is repaired or rewritten.

`0099_opening_staged_merge` retains a future, DDL-free join with the unrelated
`0097_hsn_staged_merge` branch. It is **not** the development target. Advancing to
that merge would also activate the staged low-stock and designation ancestry;
opening-only approval does not authorize that work.

The declaration and generated application constant now require exactly
`0098_opening_corrections`. Readiness checks the correction history projection,
revision-specific lot uniqueness and both immutable-history triggers, then
retains every `0096` predecessor probe. Account readiness and directory
maintenance retain exactly the reviewed `0096` identities, field inventories
and lock coverage at `0098`; unknown future revisions remain rejected.
No historical encryption contract or role grant was expanded.

The editor checks the running API's exact schema identity and read-only
readiness before loading or reviewing an edit. An unavailable editor and the
typed `opening_not_found` record error are distinct. Mounted drafts are not
replaced merely because a development refresh reruns the loading effect.
Commit/retry journaling is unchanged: an uncertain save still requires
reconciliation, never an automatic replay or a definitive claim of non-save.

The existing version-2 automatic development policy classified the exact
`0096` → `0098` path as automatic, with one pending migration and no protected
operator-only steps. No approval manifest, policy reclassification, recovery
bypass, stamp or broad migration-to-head was used. The existing target binding,
migration lock, atomic transaction and readiness postcondition were retained.
The forward-only downgrade restriction remains unchanged.

Production was not accessed or activated. Any other environment must inspect
its actual target, applied ancestry and applicable recovery/approval gates
independently. Do not apply a rewritten staged migration to an environment
where its earlier definition was already activated.

## Narrow operational evidence — 2026-11-12

- The prior missing-opening-balances task was marked merged before shared
  activation; its investigation and data were not modified.
- Before activation, the current API already exposed both POST edit routes.
  An authorized `POST /api/v1/admin/opening-stock/{existing_id}/edit/preview`
  returned **503 `inventory_unavailable`**. The original-bound development
  database was at `0096`, with neither the correction table nor lot-revision
  column. Readiness incorrectly still returned 200 for this feature's code.
  The user's earlier route-level 404 was **not reproduced by this newer
  process**, so an outdated original API remains unconfirmed as its cause.
  No entered expiry date was identified as the cause.
- Source integrity metadata was generated with the existing generator. A narrow
  migration-plan observation showed only `0098_opening_corrections` pending.
  The existing development synchronizer applied that exact migration atomically
  and returned `READY`. No unrelated staged migration was applied.
- The existing API workflow was stopped. Only the API and its existing private
  scanner were then started directly, without the project Run action, workflow
  restoration or a startup validation wrapper. The frontend workflow was
  likewise replaced by its inspected development-only Vite launcher, because
  its frozen startup identity still named `0096` despite HMR serving new modules.
  Automatic page reload protection was retained; no browser reload was requested.
  These direct listeners, not restored managed workflows, served the evidence.
  After that frontend restart, its served `/release-runtime.json` reported
  `0098` and the same backend source identity as the running API. Updated editor
  and transport modules were served successfully. The running API's OpenAPI
  declaration included both POST edit-preview and edit-commit handlers.
- On the user's actual development HTTPS preview origin, `/api/v1/version`
  reported `0098`, `/api/v1/health/readiness` returned 200, and authenticated
  saved opening listing and eligible edit review both returned 200. The review
  included a review token. A nonexistent-record edit review returned the
  distinct **404 `opening_not_found`**.
- After migration, correction history contained zero rows and existing lots
  retained revision one. The unrelated low-stock settings table remained absent.
  No opening was re-entered, reposted, corrected or saved for verification.
  Authenticated inspection sessions were explicitly signed out.

**Confirm-and-save remains operationally unverified.** No specific correction
was authorized for verification, so no edit-commit request was sent. The existing
review-token, audit, exact-quantity, eligibility, concurrency and idempotency
implementation was not reimplemented or relaxed.

No tests, builds, typechecks, browser automation, screenshots, regression suites,
release checks or generic validation/completion wrappers were intentionally
invoked. Release workflows were already running when initial inspection began;
they were stopped immediately after discovery. Their prior execution is not
claimed as absent or as a passing validation result. No production deployment
was performed. Completion must skip configured automated validation.
