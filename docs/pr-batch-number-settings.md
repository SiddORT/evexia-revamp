# PR Batch Number Settings

## Alignment repair — main-workspace handoff accepted, 2026-10-19

The user directed continuation using the updated main-workspace handoff and
explicitly prohibited rerunning 0045. The current main-workspace version of
[`development-schema-activation.md`](development-schema-activation.md), section
**Original-development 0045 activation completed — 2026-10-19**, supersedes the
earlier activation blockers recorded below. No migration, restoration, backup
rehearsal, compatibility command or service restart was repeated on this
continuation.

### Authoritative main-workspace evidence — not executed by this fork

The updated handoff records:

- Confirmed original development primary `helium` / `heliumdb`, cluster
  `7689828272860483604`, OID `16384`, PostgreSQL 16.10.
- Stopped services, advisory lock `145002`, predecessor table writer exclusion,
  full snapshot backup, authenticated private-storage readback and denied
  anonymous access. The main-workspace archive SHA-256 is
  `8f5d47df03d23c599621b6a99b446438908936d5f58b6bf8dde267afcf1e8856`.
  Its separate recovery/activation receipts, not this fork's earlier backup,
  are authoritative for that live operation.
- Actual independent restoration of **43 tables / 2,199 rows**, complete
  canonical schema/data agreement, successful exact-path rehearsal and
  readiness. Existing keys validated without replacement; the previously
  confirmed separate key recovery remained a prerequisite.
- Committed original database revision: **`0045_pr_batch_numbers`**.
  All original business rows/columns remained unchanged.
  `pr_batch_settings` contained exactly `(1, 1, NULL)`, and both
  `pr_batch_counters` and `pr_batch_allocations` were present and empty.
- Both managed services restarted. Loaded backend schema and served frontend
  declaration agreed with database **`0045_pr_batch_numbers`**;
  `pnpm verify:development` passed in the main workspace. That handoff also
  records 75 focused activation/recovery/policy checks, not a full release
  result. None of those commands was run by this task continuation.

This closes the original-workspace activation handoff without replaying it.
The supplied handoff does not retain the individual runtime source/frontend
hashes or raw HTTP readiness response, so those values are not invented here.
The Settings typography/error-recovery changes in this task remain additional
source changes to be merged; the main handoff does not claim to have tested
those later changes.

### Fork observations and verification limits

The fork's independently queried database remains at **0044**, with all three
batch tables absent. Its configured physical target identifiers match the
recorded binding, but this is not proof that its database copy is the same
original-workspace resource. The fork API remains stopped by its pending
operator path. **Do not migrate this copy to imitate the main-workspace
result, or treat its old revision as evidence that the main activation failed.**

Read-only requests to the original preview origin named in main's configuration
returned HTTP 200 **HTML**, not application JSON, for `/api/v1/version`,
`/api/v1/health/readiness`, `/release-runtime.json` and the protected batch
settings path. These do not establish any API status, loaded identity,
authorization result or successful settings read. No login or write was
attempted. A static fork screenshot showed the hostname-lookup unavailable
screen with a gateway failure, not the Settings panel; it is not a layout pass.

Source inspection confirms unchanged literal route order, input-free GET,
versioned POST, authorization and counter semantics. Failure states never
select Manual as a fallback; failed reloads retain edits and require an explicit
successful saved-state read before another save. The typography changes are
Settings-scoped and preserve the global display heading and theme tokens.
Authenticated load/save, stale-save recovery, long-format wrapping, themes and
narrow-screen rendering have **not** been exercised by this task. The earlier
reported 422 remains historically unattributed; it is not explained away as a
missing-table validation error.

No tests, builds, source-review checkers, compatibility checks, deployment,
inventory migration or sequence reset was run during this continuation.
The inventory task retains ownership of its successor migration and alignment
gate. Never downgrade a newer approved release to reproduce this handoff.

## Historical fork investigation and recovery preparation

The following records describe the fork's earlier state and actions, before the
main-workspace completion handoff. They are not current activation instructions
or a request to repeat backup or migration work.

### Authorized recovery preparation — 2026-10-19

The user authorized private backup/recovery checks and **only** the development
0044→0045 activation after all safeguards pass. This permission does not itself
attest independently recoverable current keys or maintenance ownership.

`scripts/prepare-batch-settings-recovery.py` completed a fresh full-database
backup, actual independent restoration, complete schema/data comparison and
exact 0044→0045 migration/readiness rehearsal **on the disposable restoration
only**. It has no live activation mode and does not invoke the predecessor
activation entry points, a source-review runner or any test/release suite.

- Confirmed target remained the recorded development primary at 0044.
  The standard operator mutex and SHARE writer-exclusion locks were held during
  backup/rehearsal. No competing operator held the mutex when acquired.
- Used the existing PostgreSQL **16.10** tools, matching the source server,
  not the default PostgreSQL 17 tools. All **43 original tables / 2,199 rows**
  matched after full archive restoration into a distinct private cluster.
  A separate schema-only reference database reproduced the complete canonical
  restored schema; no SQL definitions or constraints were normalized away.
- Private App Storage retained the archive and recovery report under
  `operator-recovery/development-0045/evexia-batch-recovery-87ud4g9d/`.
  Archive SHA-256:
  `9e6f196a98c50a9d14c930505195deeb4dfc5658706c8d71c2d2ee8e0d8c798e`.
  Authenticated readback matched and anonymous access was denied. Local
  recovery directory/files are outside the repository, mode 0700/0600.
- The disposable successor contained exactly the three new batch tables,
  the `(1, 1, NULL)` initial configuration, empty counters and allocations.
  Every historical table's row content was preserved. Direct explicit
  readiness returned `{"status":"ready"}` **on the disposable connection**.
  This is not a loaded managed API or HTTP-readiness observation.
- The real target was rechecked at **0044**, with **zero live migrations
  applied**. Keys were validated through the application but were not exported,
  replaced, reset or independently recovered by this process. The disposable
  PostgreSQL server was stopped on completion.

Remaining safeguards: current independent key-custody/recovery confirmation,
confirmed activation ownership with the active inventory task, and an approved
operator execution context. This task runs in a fork; the original-development
workspace identifier used by the historical activation command does not match.
That command's original-only restriction has not been changed or bypassed.
The read-only physical target binding does match, but it must not be used to
silently waive a workspace or operator restriction. No new live migration
runner, broader approval flag or target override was introduced here.

Recovery evidence alone does not establish activation. A future original-target
operation must recheck the revision, keys, source bytes, writer exclusion and
inventory owner immediately before mutation; a newer approved release must
never be downgraded to this candidate.

### Actual development observations

- A read-only transaction using the configured development connection matched
  the independently recorded binding in `scripts/development-database.json`.
  The committed database revision was exactly `0044_purchase_received`.
  `public.pr_batch_settings`, `public.pr_batch_counters` and
  `public.pr_batch_allocations` were all absent; no seeded configuration exists.
- Both managed API and portal workflows were initially `not_started`.
  Port 8080 refused connections. There was no loaded backend identity,
  route contract or healthy readiness response to inspect.
- One coordinated service start was attempted after the source edits. The API
  startup stopped before Uvicorn with `OPERATOR_MIGRATION_REQUIRED`:
  current `["0044_purchase_received"]`, required `0045_pr_batch_numbers`,
  pending and operator-only both `["0045_pr_batch_numbers"]`,
  `migrations_applied: 0`. The startup/operator protection was not bypassed.
  No release, test, CI or compatibility workflows were started by this repair.
- The portal started successfully. Its served `/release-runtime.json` declared
  schema `0045_pr_batch_numbers`, contract `evexia-preview-2026-10`, frontend
  identity `a4bf4ec06e6a992832565b75e855d8ae9d76d893122ee0661a540bc0a7046e91`,
  and candidate backend source
  `8b6a5344c248cf053c65bbbb931f5aa9592628af667abcdf7ce3df91003c5f45`.
  This is a **frontend-served candidate declaration**, not a loaded API identity.
- After the startup attempt, direct API readiness still had no listener
  (curl HTTP `000`); the actual preview-origin readiness request returned
  gateway HTTP **502**, not API HTTP 200 or an API schema error.

The screenshot shows `Invalid request`, but does not establish its HTTP status,
response fields or the process that served it. Current source sends
`GET /api/v1/admin/purchase-received/batch-settings` without a body or query
fields. Its literal route precedes the UUID receipt route; the versioned POST
contract is unchanged. Missing relations are handled as storage failures, not
request validation. The historical reported 422 has **not been reproduced or
attributed**. No credentials were accessed, no authenticated request or save
was made, and no synthetic data was written to the target.

### Source changes only

- Settings-scoped legend, mode label/help, prefix input, format examples,
  feedback and action spacing use adjacent Settings sizes and theme tokens.
  Removed dependencies on MR/Purchase Order form classes. Kept the existing
  Settings headings and global font declarations unchanged. Long examples and
  action buttons can wrap; radio and prefix focus indicators are explicit.
- Failed initial reads leave no selected mode or enabled editor. Failed
  reloads retain draft and previously loaded version, but block further saves
  until an explicit successful saved-state read. Existing stale/uncertain-save
  reconciliation, actor guards and optimistic version checks remain.
- Batch settings reads distinguish a rejected input-free GET from genuine POST
  field validation and unavailable route contracts. Backend schema absence,
  missing/unreadable configuration and general recoverable storage failure
  remain unavailable states, separate from 422 validation and 409 conflicts.
- Explicit readiness still rejects the predecessor revision. At the batch
  revision it additionally validates the actual saved policy or exact initial
  Manual marker, without issuing tokens or allocating/resetting counters.
  No automatic readiness/compatibility gate was added.

These are source-inspected changes, **not** observed successful load/save,
visual, narrow-screen, theme, stale-response or concurrent-writer checks.
No automated suites, builds, schema-review commands or UI automation were run.
The later authorized recovery/rehearsal above is separate from these UI/write
claims.

### Earlier required continuation — superseded by main-workspace handoff

Keep this task open until a separately approved operator can satisfy the exact
development `0044_purchase_received` → `0045_pr_batch_numbers` target,
independent existing PR-key custody/recovery evidence, approved execution
context and coordinated writer exclusion. A fresh durable backup and verified
restoration/rehearsal have now been prepared as recorded above. Neither the
earlier 0040→0044 runner nor its previous recovery evidence authorizes this
successor; do not widen or reuse its execution target.

The active Live Stock Inventory work owns its subsequent migration and live
alignment gate. No successor beyond 0045 is present in this checkout. Activation
ownership/maintenance coordination with that work remains **unconfirmed**;
no inventory code, successor migration, source/review declaration, production
authorization or historical migration was modified here. Reinspect the actual
revision and full pending chain immediately before any future operation. If a
newer approved release has activated, do not downgrade it to 0045.

After authorized activation, restart managed services and record the committed
revision, all three batch tables and configuration metadata, loaded API identity,
served frontend identity and explicit HTTP readiness. Separately obtain
permission for any authenticated save/UI acceptance that exceeds read-only
inspection. Do not infer working saves or layout from declarations or source.

## Original delivery and verification boundary

This is a source-only delivery. **No tests were added or run.** No browser
automation, screenshots, diagnostic harnesses, builds, type checks, release
gates, compatibility checks, live API calls, database migrations or key changes
were performed. Runtime behavior, concurrency, browser behavior, layout and
PDF/export output are **unverified**.

Static source inspection covered:

- Protected Super Admin UI registration and repeated backend identity checking.
- Version-checked settings writes, explicit missing-schema errors, captured
  policy semantics, failed/lost-response handling and encrypted retry binding.
- Transactional counter locks, first-use inserts, deterministic product lock
  ordering, actor/request isolation and source PO-line/product identities.
- PR row initialization, manual overrides, removal/restoration, review return,
  same-account session renewal, PO changes and obsolete response suppression.
- The existing saved batch path through server review, encrypted receipt,
  encrypted history/retry, detail, document model/renderer and CSV export.

The FastAPI contract and shared clients/validators were regenerated as source
artifacts only. The underlying generators were invoked directly, **not** the
package codegen script that also invokes TypeScript checking.

## Shared policy

Settings > **Batch Number Settings**, stable section ID `batch-numbers`, is
searchable through the existing Settings navigation. Both endpoints and UI
are protected Super Admin-only; custom staff master permissions grant nothing.

Modes are shown in this order:

1. **Manual**: the explicit initial migration marker. Users must enter batches
   for positive received rows. The required, non-whitespace batch and
   120-character backend limit remain enforced.
2. **System sequence**: one persistent counter, shared by every product, PO,
   PR and authenticated browser. Optional prefix is up to 64 ASCII letters,
   digits, dots, underscores and hyphens, copied literally with no implicit
   separator. For prefix `BATCH-`, the initial output is `BATCH-00000001`.
3. **Product-based**: a separate persistent counter per full catalogue product
   UUID. Output is `P-<32 uppercase UUID hex digits>-00000001`. All 128 bits
   distinguish products without depending on mutable names or changing
   Product Master. Two PO lines for the same product consume separate numbers
   from that product's shared counter, not a single reused product preview.

Every suffix starts at 1 and is zero-padded to **at least eight decimal
digits**, expanding rather than wrapping when needed. The operational bigint
stores the next unused number. At exhaustion the operation refuses further
allocation; it never resets, wraps or fabricates a number. All outputs fit
within the existing 120-character batch limit.

Mode and prefix changes never reset or migrate counters. Manual edits,
including valid reused supplier batches, neither advance nor reset them.
There is deliberately **no uniqueness constraint on saved batch strings**.
Batch text is checked for non-whitespace content and length but the exact
validated submitted string is saved; the system does not strip or replace a
manual override. PR document numbering remains independent and unchanged.

Allocations reserve real numbers at row initialization, not just at receipt
save. Removed/skipped rows, abandoned drafts, changed POs and replaced automatic
batches may leave **gaps**. This is not gapless numbering. Prefix changes can
make formatted values in different scopes resemble manually entered batches;
the guarantee is unique allocated numbers within each sequence scope, not
global uniqueness of arbitrary batch text.

## API and persistence

All routes are under `/api/v1/admin/purchase-received`:

- `GET /batch-settings`: current mode, prefix, version and an encrypted,
  actor-bound `policyToken`.
- `POST /batch-settings`: mode, prefix and `expected_version`; stale writes
  reject with 409. The UI retains edits and can load/display the current
  server version before an explicit new save. Uncertain writes require this
  saved-state read, not an automatic overwrite.
- `POST /batch-allocations`: a UUID `idempotencyKey`, PO UUID, one to 100
  distinct source-line UUIDs and the captured `policyToken`. Product IDs,
  labels, counters, next numbers and batch values are not accepted as input.

The token authenticates the saved policy captured at initialization. Later
settings changes do not invalidate it or change an already initialized draft.
It is bound to the actor UUID, not a short-lived session/access token, so
ordinary same-account session renewal preserves it. The token is memory-only
in the browser and is never a substitute for live authorization.

Allocation revalidates the protected actor, takes the request advisory lock,
and returns an already committed result only if both actor and original
request match. A new request takes the PO's existing mutation lock, verifies
the PO is open and each selected active source line belongs to that PO, and
derives scope from the source line's actual product FK. Counter rows are
created with conflict-safe inserts and locked in sorted scope order.
Counter advancement and the encrypted complete retry record commit together.
No locks or transactions span user interaction; no receipt/review token or
receiving balance is changed by allocation.

Failed or timed-out requests retain exactly the same allocation body and key in
the mounted draft. Explicit retry returns the original committed result, even
if settings changed or the PO subsequently became unavailable. It never silently
starts a replacement request. A genuine new PO/draft initialization is distinct
and may leave prior allocations unused.

The PR editor captures one policy per PO initialization, allocates new rows
once, and applies results only to untouched blank eligible rows. A touched field
stays user-owned even when cleared. Removed rows retain their full draft and
allocated value; restoration uses that retained state without another request.
Saved receipt lines are excluded regardless of the current policy, while
previously unsaved source lines in an edit may use the current default.
Review return and same-account renewal keep the mounted allocation context.
Account/PO changes and unmounting invalidate obsolete responses.

Loading/errors block review of new rows until the shared default is resolved,
but retain editable row contents. No local counters, stored business-setting
copies or automatic fallback to Manual exist. Settings changes affect future
initializations only. Existing receipt review/save/reconciliation, quantity
controls and navigation confirmation ownership are unchanged.

## Forward encryption inventory and custody

`0045_pr_batch_numbers` adds the following tables after
`0044_purchase_received`:

| Table | Plaintext operational fields | Protected payload |
| --- | --- | --- |
| pr_batch_settings | singleton ID, optimistic version | saved mode/prefix |
| pr_batch_counters | scope (`system` or full product UUID), next unused bigint | none |
| pr_batch_allocations | opaque request UUID, actual actor UUID FK | original request including captured token/PO/line IDs, result including every allocated batch |

The only null policy payload is the migration's explicit version-1 Manual
marker. A missing table/row or unreadable ciphertext is an unavailable error,
not an intentionally saved Manual choice.

All descriptive settings/allocation values use the existing independent PR
AES-GCM keyring and `v1` envelope. AAD purposes are `batch-settings` with owner
`1`, `batch-policy` with owner actor UUID, and `batch-allocation` with owner
request UUID. Descriptions/batches/prefixes are not copied into logs or
plaintext audit/history. The existing PR transaction boundary refuses SQL
parameter logging and rolls back allocation/counter writes together on error.

**Retain old PR decryption keys** for all original receipt/history/retry
payloads **and these new settings/allocation payloads**. A reviewed offline
rotation at this revision must include all five encrypted storage surfaces
(receipt, receipt history, receipt requests, batch settings, batch allocations),
with the correct AAD owners/purposes; keep counters unchanged. Drain active
memory-only draft policy tokens before retiring their old key, otherwise
unsent old-policy allocations will fail explicitly. Retrying an already
committed allocation compares the original token as opaque request data.
No rotation tool, key replacement or historical inventory rewrite is included.
The encrypted original policy token inside an allocation request is retained
for exact retry matching, not used as a second authorization mechanism.

## Operator-only activation handoff

1. Obtain separate approval for **only** the additive
   `0044_purchase_received` → `0045_pr_batch_numbers` transition. Confirm the
   target environment, existing exact revision and existing PR key custody.
   This delivery does not authorize PR predecessor activation, email-template
   changes, other pending migrations, managed/production changes or deployment.
2. Back up the complete target database and retain all independent encryption
   material separately under existing custody rules. Arrange a coordinated
   maintenance window and verified recovery before migration.
3. If the database is not exactly at `0044_purchase_received`, stop and obtain
   a separate reviewed predecessor plan. Do **not** run `upgrade head` or an
   unreviewed broader activation script to reach the batch feature.
4. Only after approval, from the backend directory, an operator may apply the
   explicit `alembic upgrade 0045_pr_batch_numbers` target against that verified
   predecessor. No migration is executed by app startup.
5. Coordinate compatible API/frontend delivery. Account/readiness recognition
   names this additive successor explicitly and inspects the new projections;
   it does not accept arbitrary future revisions. Existing development target,
   protected installer evidence, release approvals and the separate predecessor
   activation script are deliberately not advanced. The migration is classified
   `operator_only`; source-manifest hashes only record the new source bytes.
6. Runtime verification remains separately unapproved in this source-only
   task. Arrange explicit permission for acceptance/concurrency checks before
   running them. Until then, do not describe the feature as runtime-verified.

Downgrade refuses to discard any allocated counter/history or saved settings.
Use a separately reviewed external recovery plan instead of deleting batches,
resetting counters or removing keys.
