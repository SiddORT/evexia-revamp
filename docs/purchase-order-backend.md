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
The historical fresh-install approval ended at domain admission and did not
authorize this successor. The new [0038 fresh-install candidate](fresh-install.md)
explicitly reviews this DDL for **genuinely empty production installations only**,
requires human approval of the exact release manifest and target, and retains
all recovery/retirement gates. Candidate metadata is not production approval.
Populated installations still require their own separately reviewed operator
procedure. Do not rehash an unreviewed manifest or bypass its guards.

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
**round half up**, then independently round each applicable GST component half
up on that rounded subtotal. Sum rounded components for line GST, then rounded
lines for order totals. Equal component **rates** can differ from the former
aggregate-only result: a 1-paise subtotal at 50% gives two 25% components rounded
to zero, whereas aggregate GST rounded to 1 paise. Never alter historical totals
to reconcile this. Halved six-decimal rates retain seven decimal places.
The draft uses scaled BigInt; preview/create use Python Decimal with explicit
precision. Unfinished/invalid rows are excluded from the **draft estimate**,
not allowed through review. The dynamic partial-line-count notice is intentionally
absent; estimates are not presented as final totals. Empty drafts show zero. Missing tax basis
shows **Tax pending**, distinct from valid zero-rated GST or unavailable prices.
Server preview binds the exact input, current reference versions, names,
prices and GST into a review token. Changed catalogue/reference details
between preview and submission return `409 po_review_stale`, requiring review.

Create persists only after confirmation. Its owner-scoped durable retry key
is written before submission, and the server atomically stores the successful
response. An identical retry returns that response without another mutation.
A reused key for different data is refused. Uncertain attempts lock editing
until the same request is reconciled. Corrupt/unavailable retry storage blocks
new sends explicitly. This is retry metadata, not a local PO dataset.

## Ordinary domestic tax contract

Each new/reviewed edit requires a supported **Place of supply (State/UT)**.
A newly selected shared Storage Location suggests its structured Indian State/UT;
this is never derived by parsing an address or assuming Maharashtra.
An explicit manual override remains available. A location switch requires a
choice before replacing a manual or saved destination: keep the current destination,
use the new suggestion (or clear it for manual selection), or cancel the switch.
Missing/non-Indian geography clears a previous automatic suggestion and requires
explicit destination selection. It does not establish import/export treatment.
This means the applicable place of supply for **ordinary domestic
goods**, not necessarily the storage-location address. Supplier state comes from
the server vendor GSTIN, never client assertions. Different state codes apply the
full catalogue rate as IGST. Matching codes apply equal CGST and SGST, except
Chandigarh (04), merged Dadra and Nagar Haveli and Daman and Diu (26),
Lakshadweep (31), Andaman and Nicobar Islands (35), and Ladakh (38), which use
CGST + UTGST. Delhi (07), Puducherry (34), and Jammu and Kashmir (01) use SGST.
Unsupported/retired/special codes (including 25, 28, 97, 99) block review with
actionable errors, never zero tax.

The shared allowlist is `app/services/gst_states.json`. Reviewed sources:
[NIC e-waybill State Codes](https://docs.ewaybillgst.gov.in/apidocs/state-code.html),
[government GST state-code list](https://nagalandtax.nic.in/docs/GST/Statistics/GST_State_Code_List.pdf),
and [CBIC GST concept/status, sections 10.1–10.2](https://cbic-gst.gov.in/pdf/01042019_GST-Concept-Status.pdf).
The UTGST distinction follows union territories without legislatures; Jammu and
Kashmir retains SGST while Ladakh uses UTGST. This is not a registration
verification service or comprehensive statutory tax engine. Rate/HSN selection,
ITC, reverse charge, composition, SEZ, imports/exports, and special bill-to/
ship-to determinations are outside scope.

## Tax snapshot activation and historical compatibility

`0040_po_tax_basis` is a new **operator-only, additive** successor to
`0039_communication`. It adds two nullable JSON order snapshot columns; existing
line JSON gains component rates/amounts only on explicit saves. It does not
backfill/recalculate orders, change prior migrations or rewrite retry responses.
Orders without a basis retain original aggregate amounts and display
“Historical tax breakdown unavailable”; no destination or split is fabricated.
For an explicit legacy edit, select a destination and load/select an available
vendor with valid GSTIN, then obtain a new review. Retained nonlegacy vendors
use saved GST identity on edits; changed vendors use current server data.
Retained products continue using saved names/prices/rates.

Opening a saved PO never hydrates its destination from the current location
master. Its saved State/UT and tax snapshots remain authoritative. Only deliberate
location selection or destination editing changes this draft; all resulting
changes still require authoritative server preview/save. Shared location geography
is returned by the protected PO reference helper, without a Location edit grant.
`0041_location_geography` adds the optional location fields and requires separate
operator approval, including any pending predecessor. It neither recalculates
historical orders nor modifies legacy browser-local procurement data.

The review digest includes destination, supplier basis, treatment, components and
reference versions; audit summaries identify tax-basis changes. Successful retry
responses are returned before current-basis validation. The input destination is
optional **only on the wire** for old retry reconciliation: new previews and
uncommitted saves require it. Old pending browser journals retain their exact
body, token and UUID without adding a destination or issuing a new create.
A definitively uncommitted old request must be re-reviewed.

No managed/shared database or deployment is activated by this work. Obtain
separate approval of `0040_po_tax_basis` and unapplied predecessors, backup/restore
evidence, and a maintenance window before activation. Existing 0038-only activators,
0039 fresh-install manifests and release authorizations remain pinned: they are
**not** permission to upgrade to head or apply this successor. Application
readiness requires the new revision and correctly blocks a predecessor database
until approved activation.

Focused commands (disposable data only):
```
node --test artifacts/evexia-portal/src/services/serverPurchaseOrders.test.js
sh scripts/test-api-foundation.sh tests/test_purchase_orders.py tests/test_purchase_order_tax.py
sh scripts/test-purchase-orders-smoke.sh artifacts/evexia-portal/tests/purchase-orders-tax.spec.mjs
```
The browser command uses private temporary PostgreSQL/API/Vite processes, synthetic
accounts, separate ports and generated output. Its legacy fixture helper refuses
configured/shared databases. No broad release suite is required for this feature's
focused verification.

Verification on 2026-10-16: the four client arithmetic/state groups, 47 focused
backend cases (including populated additive DDL preservation), 45 migration-policy
checks, generated-client/library typechecks, API contract comparison, and direct
portal compilation passed. The authenticated Chromium tax journey passed against
the private disposable fixture, including mobile sticky geometry, stale vendor
review, save/reload parity, retained tax basis, real legacy reads, and original
pending create/edit identities. No Firefox/Safari or full release pass was run.
The managed preview remains **blocked**, not verified: its database is still
`0039_communication`; code now requires separately approved `0040_po_tax_basis`.

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

The listing has separate named View/Edit/Delete icon controls; Edit enters the
editor directly and deleted rows expose only View. List and detail deletion share
an accessible modal over the initiating page, including PO identity, retained
version, busy protection and durable owner/order-scoped retry. Cancel returns
focus without a request; uncertain deletion can be reopened and retried with the
same key/version, including after reload. Stale deletion reloads the latest order
in the same dialog and requires a second confirmation. Successful listing deletion
refetches rows/counts/overview while retaining filters and the applicable page.
If a triggering row disappears, focus returns to the listing refresh control.
The listing also discovers a bounded set of the current owner's durable deletion
journals, allowing in-place reconciliation after reload even if the committed
delete removed its row from the current filter/page. This reads retry metadata,
not a browser-local order dataset; the selected order's identity/amount come from
an authorized server detail read before opening the same confirmation modal.

Create/Edit keeps supplier GSTIN, registration-state availability, and supply
guidance together in the right-hand totals card, stacking on narrow screens.
Place-of-supply help remains associated with its control. The requested redundant
editor/detail/review notices were removed without changing tax rules, required
server review, idempotency, or the absence of stock/supplier effects.

### Structured-location implementation execution boundary

No tests, builds, typechecks, release suites, validation scripts or broad
compatibility diagnostics were run for this change, as explicitly requested.
Existing browser assertions were adjusted for the new modal/estimate presentation
but not executed. Contract export and direct client generation are authoring steps,
not evidence of passing checks. Only the bounded read-only runtime identity and
recorded database revision comparison was requested; results and rollout blockers
are in `storage-location-runtime-comparison.md`. No managed migration, pending PO
activation, production deployment, release-gate policy bypass or key change occurred.

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
