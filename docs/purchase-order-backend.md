# Shared Purchase Orders

The live Purchase Orders listing and creation form use FastAPI/PostgreSQL,
not the legacy browser PO, PR or master stores. Only the verified protected
system Super Admin is authorized, including reference helpers. This does not
add staff procurement permissions to the eight-master catalogue.

## Activation boundary

`0038_purchase_orders` is an explicit **operator-only** forward migration.
No shared/managed database was migrated as part of implementation. Obtain
separate operator approval before applying it. Until activation, application
readiness reports the schema mismatch; do not claim the live service is ready.
The previously reviewed fresh-install runner still ends at its reviewed
domain-admission target; its approval does not authorize this successor.
Do not silently extend that runner's review manifest or bypass its guards.

The separately approved Replit Helium development activation, verified backup
and live API results are recorded in
[development activation](purchase-order-development-activation.md). This does
not activate or approve VPS, UAT, production, or another workspace database.

The new tables start empty; no local records are migrated, merged, mirrored,
seeded or deleted. The migration adds headers, ordered lines, durable retry
responses and one-to-one metadata on existing `audit_events`. Foreign keys
retain master references, while names/prices/taxes are saved snapshots.

## Arithmetic and review

Allergen `selling_price` and `gst` are read-only source values, with up to six
decimals. Missing price is unavailable, not zero. Explicit zero is supported.
Quantities are positive plain decimals with up to three decimal places and
maximum 1,000,000. There are 1–100 lines and a ₹10 crore per-order limit.

For each line, multiply quantity by catalogue price, round to paise using
**round half up**, then calculate GST on that rounded subtotal and round half
up again. Sum the rounded line subtotals, GST and totals. The draft uses scaled
BigInt; preview/create use Python Decimal. No IGST/CGST/SGST split is inferred.
Server preview binds the exact input, current reference versions, names,
prices and GST into a review token. Changed catalogue/reference details
between preview and submission return `409 po_review_stale`, requiring review.

Create persists only after confirmation. Its owner-scoped durable retry key
is written before submission, and the server atomically stores the successful
response. An identical retry returns that response without another mutation.
A reused key for different data is refused. Uncertain attempts lock editing
until the same request is reconciled. Corrupt/unavailable retry storage blocks
new sends explicitly. This is retry metadata, not a local PO dataset.

## Queries and audit

List search covers saved PO number, vendor, destination and product names.
Status, historical vendor/product filters, inclusive PO dates and deterministic
newest/oldest order work together, with server paging and filtered/all counts.
Overview cards are global, independent of listing filters/pages.

Activity uses committed audit-linked create/update/delete events, not browser
page visits, client-reported events, failed writes or idempotent retries.
It retains PO number, readable change summary, verified actor attribution and
timestamp, with stable newest-first paging/search. Analytics counts mutations,
not distinct orders, and groups Open GST-inclusive value by retained vendor
identity/name. A renamed vendor can have separately labeled historical groups;
the global distinct-vendor count uses the retained master identity.

Protected Super Admin UI now includes server detail, versioned edit-preview/update
and confirmed soft deletion. Desktop/mobile list links and readable Activity links
open the saved record, including deleted records in read-only mode. An edit
retains names, prices and taxes for retained references/products; new selections
are validated under locks. Every edit requires a new server review. A stale
version preserves the draft but blocks saving until the operator explicitly
discards it and reloads the latest order. Unconfirmed edit/delete requests retain
their owner/order-scoped durable retry key, exact version and payload across
reloads; editing stays locked until reconciliation. Unreadable/unavailable retry
storage fails closed. Successful changes update detail immediately; listing,
global cards, Activity and Analytics refetch on mount, visible-window focus and
every 30 seconds. Active editors are never refreshed underneath a draft.

There is no supplier submission, receiving, stock/payment effect, invoice
preview/PDF, status transition or sample loader. Legacy receiving retains its
separate untouched data and is not backend evidence. Managed activation approval
remains separate; this UI does not apply the operator-only migration.

## Focused checks only

- `sh scripts/test-api-foundation.sh tests/test_purchase_orders.py`
- `sh scripts/test-purchase-orders-smoke.sh`

Both use private disposable socket-only PostgreSQL with synthetic accounts
and keys. The smoke command runs only the new PO Chromium spec, not existing
regression suites or the root build/release gate.

### Saved-order UI verification (2026-10-16)

- Portal Vite production compilation passed. Retry-storage unit check passed:
  `node --test artifacts/evexia-portal/tests/purchase-order-retry.test.mjs`.
  It checks owner isolation, matching browser locks for writes/clears, conflicting
  attempts, corrupt/unavailable storage and missing-lock rejection.
- Targeted disposable-database Chromium journey:
  `EVEXIA_CHROMIUM_PATH=<installed chromium> sh scripts/test-purchase-orders-smoke.sh purchase-orders-mutations.spec.mjs`.
  Detail, retained duplicate-product snapshots, current-catalogue price changes,
  edit review/save and overview were observed in the initial partial run.
  A test-only Activity locator ambiguity was corrected; the continuation prepared
  the already-verified version-2 state through server services and passed the
  remaining journey (**1 passed**). It verified Activity/Analytics refresh,
  competing-update rejection with draft preservation, confirmed reload,
  response-loss edit/delete retries with identical payload/version/key and
  nonduplicated audit events, nonmutating deletion cancellation, deleted read-only
  detail, Open/Deleted visibility, mobile links and readable Activity links.
- The fixture's default browser executable was absent; the continuation used an
  installed Chromium binary. No Firefox/Safari matrix, enlarged-text matrix,
  managed migration or production rollout was performed for these UI changes.
  Completion attempted `pnpm run validate:release`: its service/API checks ran,
  but the broad browser stage stopped before launch because its configured Nix
  browser-library source directory did not exist. The full release gate did not
  pass; task acceptance records that environment limitation separately from the
  passing focused PO checks. Managed activation remains separate.

### Implementation verification (2026-10-15)

- Focused disposable-database API checks: **13 passed**. They cover CRUD,
  retained identities/snapshots, exact decimals/rounding/limits, missing and zero
  prices, stale review/version conflicts, duplicate retries, rollback, shared
  references, combined listing filters/paging, audit attribution/search/paging,
  global cards and exact multi-vendor historical analytics.
- Exported OpenAPI and regenerated clients/validators; shared-library TypeScript
  checking passed. Unchanged API contracts remain semantically unchanged.
- Direct portal Vite compilation passed; this was the artifact compilation
  command, **not** the root build/release command.
- Narrow Chromium smoke: real isolated login and shared-master setup passed.
  The initial route import failure (missing key-generator export) was fixed and
  compilation confirmed. The resumed run reached the form and verified shared
  selection, read-only catalogue price/GST and replacement/clearing. It then
  stopped at a test-only `0` versus displayed `0.00` expectation, now corrected.
  The full create/list/filter/cards/activity/analytics/sticky browser flow was
  **not completed**; no passing browser evidence is claimed for those steps.
- No cross-browser matrix, existing regression suite or root release gate was
  invoked for this work. Managed schema activation/live authenticated PO
  verification remains **blocked pending separate operator approval**.
