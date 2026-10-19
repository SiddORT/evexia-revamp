# PR Batch Number Settings

## Delivery and verification boundary

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
