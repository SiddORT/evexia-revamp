# Stock-enabled Product Master

## Scope and authority

Products & Supply now includes Product Master. It uses the existing singleton
Super Admin boundary; no Staff capability, MR capability or second stock store is
introduced. Products are recipes of **existing individual allergens**, not
clinical mixing instructions. Saving a recipe does not manufacture stock,
change allergen prices or initialize historical receipts.

Each live name (including inactive products) is unique after whitespace and case
normalization. A recipe has 2–100 distinct allergen IDs, each with a positive
exact quantity, at most 1,000,000, to three decimal places in its established
`procurement quantity units`. No nested product IDs or unit/pack conversions are
accepted. Existing unchanged inactive references can be retained in an edit;
they cannot be used in a new assembly.

MRP and selling price are independent decimal strings, not component totals.
The existing catalogue policy applies: up to twelve significant integer and six
source fractional places; half-up rounding to two places; nonnegative; maximum
999999999999.99 after rounding; rounded selling price cannot exceed rounded MRP.
Edits are optimistic versioned replacements, with immutable before/after
recipe/price history. Deletion is soft. Historical labels remain retained.

## Assembly and retained stock

`POST /api/v1/admin/products/assemblies/preview` accepts a saved product version,
one location, 1–1,000,000 whole combos and explicit source lot allocations.
Quantities must exactly equal every recipe member's requirement multiplied by
the output count. Every source must be an available individual-allergen lot at
that location; active product, allergen and location references are rechecked.
No implicit sourcing, invented stock or cross-location debit is performed.

The existing inventory contract requires explicit output batch and expiry.
The output batch is an operator-authored identifier, never inferred from source
batches. Output expiry cannot be after **any** source expiry. A source with
unavailable expiry cannot be used. Neither an earlier date nor this validation
is a medical formulation or stability approval. Source batch/expiry values,
including unavailable historical values, remain visible independently.

The review token covers the recipe version, reference versions, selected lot
identities and balances, prices, output and location. Commit recomputes it under
the existing inventory writer lock. It atomically:

1. Debits the exact component lots in the authoritative ledger.
2. Creates an independently identified combo lot and credits whole-combo output.
3. Saves encrypted assembly provenance, original recipe/prices, source
   allocations, source and output before/after balances, actor and time.
4. Commits the business history, success audit event and retry outcome together.

The existing transaction order is preserved: authenticated user/session,
inventory advisory writer lock, then current recipe/reference rows. Receipt
corrections, initialization and transfers use that same writer lock. Receipt
batch/expiry/product identity is frozen after assembly consumption, as after a
transfer. Receipt evidence reconciles accepted quantity against remaining stock
**plus assembly consumption**, so legitimate consumption is not mistaken for a
broken receipt or initialized twice.

Assembly is append-only: no edit, delete, reversal or disassembly endpoint.
Future recipe/price changes do not recalculate old lots. Deactivation/deletion
blocks new assembly, not viewing or transferring retained combo lots. Transfers
require whole combo quantities and preserve the source assembly and snapshots;
they never consume component stock again.

## Requests, UI and reporting

All mutations carry actor-bound UUID request identities. An identical replay
returns the stored result; a changed command or other actor is rejected. Unknown
outcome reconciliation takes the same writer lock. An absent identity is
durably cancelled before `not_committed` is returned, blocking delayed originals.
Only the opaque owner/key recovery journal is browser-persisted; product,
recipe, allocation and price drafts stay in memory.

The portal reuses the platform's tables, pagination, selectors, quantity controls,
confirmations, date preferences and drawers. Unknown responses keep the mounted
draft and identity. Recovery is explicit, including cancellation of absent
requests. Recipe/balance refresh preserves assembly draft fields. A stale master
can show its current saved recipe/prices alongside the draft; using that version
requires an explicit confirmation, never silent overwriting. Shared navigation
uses the platform confirmation; tab close/reload uses the browser's native guard.

Stock Status labels individual allergens versus assembled combos. Its retained
lot details and the existing Move Stock Actions drawer show source assembly,
recipe, original assembly quantity/prices and source lot allocations. Product
details, including soft-deleted records, can be opened from those snapshots.
Product activity includes recipe/price/status/deletion changes and assemblies.
Posting history labels assembly consumption/output separately from receipts.

Catalogue queries and history are bounded (the existing 2,000-row bounded-read
policy); exceeding a bound fails explicitly instead of returning false totals.
Master counts, assembly counts and quantity summaries cover the authorized
matching scope, not only the table page. Quantities stay grouped by product/unit
and location. MRP and selling price are catalogue/assembly snapshots, not sales
revenue. No clinical, accounting, sales or reservation metrics are invented.

## Persistence and encryption

`0047_stock_products` extends `0046_live_inventory`'s lot identity rather than
creating another ledger. Its migration bytes are preserved unchanged.
`0049_product_language_merge` joins it with main's independently merged
`0047_languages` → `0048_language_unicode` history. The merge has no replacement
DDL and neither branch's applied migration is renamed or rewritten. New encrypted
payloads use the existing independent PR keyring, through InventoryCrypto's
`inventory:*` forward AAD namespaces:

| Table | Row identity / forward purpose |
| --- | --- |
| combo_products | product UUID / `product` |
| combo_product_revisions | revision UUID / `product_revision` |
| product_assemblies | assembly UUID / `assembly` |
| product_requests | request UUID / `product_retry` |
| inventory_lots | lot UUID / existing `lot`, now retaining combo snapshots |
| inventory_movements | movement UUID / existing `movement`, now retaining combo lines |

Recipe labels, prices and snapshots remain encrypted. Operational UUID
relationships, status/version/times, exact member quantities, lot balances and
ledger postings remain plaintext for integrity and locking. The live-name HMAC
reveals equality within its key scope; a bounded decrypted check also detects
duplicates written with retained old keys. This is not encrypted-computation or
equality-hiding storage.

Future forward key-rotation/retirement planning must cover every row above,
existing inventory retry outcomes and immutable assembly/revision history.
Old PR keys remain required until a separately reviewed rotation covers all
retained data and immutable-storage constraints. No key was replaced, rotation
API added, immutable trigger disabled, or historical staging/retirement field
inventory retroactively expanded.

## Automatic lifecycle and acceptance boundary

The canonical declaration, generated schema constant, development integrity
review, fresh-install catalog and reviewed release metadata target
`0049_product_language_merge`. Both original historical migrations and their encryption
and recovery guards remain unchanged. Normal managed startup/deployment performs
the new migration using the existing automatic policy; no new operator-only
schema runner or predecessor-readiness allowance was added.

The existing receipt-initialization tool is declaration-compatible with the
reviewed successor while preserving its original identity, backup/key, stopped
writer and explicit receipt review requirements. **It was not run**. Neither
sample stock nor receipt initialization is part of Product Master activation.

Catalog metadata comes from two independent disposable PostgreSQL 17.5
Unix-socket clusters. One followed the preserved product branch and the other
main's Unicode language branch; both normal upgrade paths produced identical
complete 0049 catalogs. Each earlier observed checkpoint (0045, 0046, 0047 stock
and 0048 language) exactly reproduced its existing digest/table set. Only synthetic
configuration and unchanged historical test-only empty-data guards were used.
This is catalog evidence, not a fresh-install, backup restoration, production,
CI or original-development activation claim.

Focused verification: `sh scripts/test-products-crud.sh` explicitly names only
Product Master/assembly, inventory and directly affected receipt CRUD files in
a disposable synthetic PostgreSQL cluster. It includes optimistic conflicts,
unavailable references, exact quantities, expiry restriction, retry/cancellation,
rollback after an injected first debit, retained deletion/history/transfer,
server-wide counts beyond one page and concurrent assemblies/transfer/receipt
correction. No regression, release, broad/default or browser suite, build,
production action or original-target migration command is authorized here.

Final live acceptance requires **after merge**, through normal main-workspace
synchronization: read-only `alembic_version`, running `/api/v1/version`,
`/api/v1/health/readiness` and served `/release-runtime.json` must agree on the
successor `0049_product_language_merge` and running source identity. An isolated/source-only observation
cannot substitute. Any latest-main merge/schema conflict or blocked activation
must be resolved without editing applied migrations or bypassing identity or
historical guards. Record actual observations and remaining limitations in the
handoff, rather than treating this document as runtime evidence.

### Recorded task-workspace observations (2026-10-19)

- Latest focused operation pass after reconciling main and the complete
  `0049_product_language_merge` graph: **14 passed**. This includes the final
  provenance response assertions, rollback and concurrent posting cases.
- All twenty changed frontend JavaScript/JSX files parsed, with no unresolved
  non-browser references in the scoped AST check. Generated client/Zod sources
  were regenerated and formatted; no library-wide typecheck/build was invoked.
- At `2026-10-19T08:25:59Z`, a read-only database query returned exactly
  `0047_stock_products`. The running `/api/v1/version` returned HTTP 200 with
  that schema and source
  `80003496a8ca8a454bc1be19edcdb1f7e7d842d975a9abbe1def5bec0554623f`.
  `/api/v1/health/readiness` returned HTTP 200, `status: ready`. The actual
  served `/release-runtime.json` returned HTTP 200 with the identical backend
  declaration and frontend identity
  `d458305c2ed0b85d6bd9e3cd700a25450c1ab6c1040944bb113ba1d77d7e3bf6`.
  These are **pre-merge task-workspace observations**, not after-merge main
  acceptance, even though the configured database cluster matches its pinned
  identity. The final managed API restart reported `applied: []`.
- The public screenshot of the protected Product Master route reached Admin
  sign-in. It confirms the preview/login shell is not manifestly broken, not
  the authenticated product forms, drawers, keyboard interactions or responsive
  layouts. Browser automation was not run.
- Directly fetching newer main source was blocked by repository authentication;
  no credential was requested or guard bypassed. Completion synchronization
  supplied current main, including Language Master, and the source conflicts
  were reconciled using the history-preserving 0049 merge above. The earlier
  0047 runtime observations are now historical **not final 0049 alignment
  evidence**. No original-target migration/restart was invoked to activate
  pending 0049 from this fork. Final post-merge three-way observation remains
  explicitly unverified here.
