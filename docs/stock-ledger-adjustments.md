# Individual allergen ledger and manual adjustments

## Authority and access

Stock Status → Actions keeps **View** and adds **Ledger** and **Manual
adjustment** for individual allergens. Combo rows retain View only. The read
endpoint reuses the existing inventory authorization: currently protected Super
Admin with `admin.access`, revalidated against the protected singleton inside the
transaction. Adjustments use that same protected check; no new staff grants or
permission-management scope are introduced.

Balances remain exclusively `inventory_balances`, maintained by
`inventory.post`; there is no browser stock store or replacement balance API.
The schema successor is `0063_inventory_adjustments`, after the actual previous
head `0062_kits_orders`, under the standing automatic migration policy.

## Ledger semantics

`GET /api/v1/admin/inventory/stock/{product_id}/ledger` defaults to every
available recorded posting for that individual allergen, not a financial year.
Dates are timezone-qualified recorded-time boundaries: `from_date` inclusive,
`to_date` exclusive. The UI uses UTC days. No business-date filtering or backdating
is implied. Deterministic ordering is recorded timestamp then stable event ID.
Transfers/allocation use the retained movement timestamp and one grouped event
per allergen, with all lot/location legs available.

Before pagination the read, under the shared inventory transaction lock:

1. Checks receipt initialization coverage.
2. Includes exhausted lots and all product postings/balances.
3. Validates every lot/location chain from zero against recorded before/after
   and reconciles every final quantity against the authoritative balance.
4. Groups movement legs, then computes product-wide (or selected-location)
   carry-forward, running balance and totals.
5. Applies the display-only type filter, then offset/limit.

The **period opening balance** is carry-forward from earlier recorded postings,
not an actual Opening Stock entry. All-location transfers/allocation are net zero
and never inflate additions/reductions. A location ledger includes their actual
stock in/out; Unallocated is a real NULL-location opening bucket. Summary totals
always include **all types** within the date/location scope, even when only one
type is displayed. Current on-hand is lifetime quantity for that location scope.
All-history closing and current on-hand must agree at the serialized snapshot.

No partial lifetime calculation is returned. Existing bounded reads support
2,000 records per relevant relation/scope and at most 100 visible entries per
page. An exceeded bound, unsupported source, discontinuous posting chain or
uninitialized receipt fails explicitly instead of giving an incomplete total.
Narrowing dates is not a workaround for a lifetime chain exceeding this bound:
the complete carry-forward still has to be verified.

Coverage describes **recorded system history**, never all physical history.
Pre-system movement and batch provenance, unretained old document versions,
legacy actor labels, reasons and document dates are unavailable rather than
reconstructed. Receipt history supplies the matching retained version where
available, not today's product/recipe. Opening finished products do not
retroactively consume current components. Sales, reservations, returns, wastage,
shipping and other non-posting workflows remain outside coverage.

The separate procurement section contains retained PO lines and PR versions.
PO quantities are commitments only, with no delta. Rejected PR quantity does not
credit inventory. PR stock is counted once, from postings, never from this
section. Retained reduced/deleted receipt versions remain context. This is not
a complete PO document-change audit; removed line versions not retained by the
existing document model are not invented. Existing authorized source viewers
open available receipts, movements, openings, assemblies and adjustments;
deleted/unavailable sources keep safe plain references.

## Adjustment contract

- `GET /stock/{id}/adjustment-choices`: active locations, existing positive
  lot/location buckets, identity/unit and snapshot time.
- `POST /adjustments/preview`: product UUID, Add/Reduce direction, positive
  decimal-string quantity, nonblank reason and exact location. Reduce requires
  an existing lot; Add forbids one and creates its own distinct lot.
- `POST /adjustments`: same input plus opaque `idempotencyKey` and `reviewToken`.
- `GET /adjustment-requests/{key}`: actor-bound durable reconciliation.
- `GET /adjustments/{id}`: immutable encrypted saved snapshot.

Quantities have at most three fractional digits and are limited to 1,000,000 per
lot/location as in existing inventory. Reject invalid precision before database
coercion. Zero and negatives are not changes. Add requires an active allergen and
real active location. Optional batch/expiry describe only its new adjustment lot;
absence is allowed and does not infer receipt or Opening Stock evidence. Existing
assembly rules continue rejecting source lots with unknown expiry.

Reduce checks the exact existing lot/location and its fresh availability,
including known Unallocated openings. It never creates an unallocated adjustment
lot. Retained inactive/deleted catalogue identity can still be reduced safely.
Preview explicitly names the affected scope: a new lot starts at zero; a
reduction reviews its chosen lot/location, not the total allergen balance.

Commit revalidates the actor, obtains the same short inventory lock used by PR,
transfers and assemblies, locks catalogue/location references, verifies the
review digest and fresh availability, then persists in one transaction:

- immutable reasoned adjustment and optional same-allergen correction reference;
- authenticated actor/time and audit event;
- distinct adjustment-origin lot for Add, or the exact existing lot for Reduce;
- authoritative posting and balance;
- encrypted actor-bound retry result.

Any failure rolls the unit back. There are no edit/delete endpoints. Database
guards reject mutation/truncation of adjustments and retry evidence and mutation
of adjustment-origin lots. Corrections are new compensating Add/Reduce records,
with a reason and the prior adjustment UUID. A receipt lot whose evidence has
been consumed by an adjustment can no longer have its product/batch/expiry
reassigned, just as after transfers/assembly.

The browser stores only the opaque owner-bound pending request identity, under a
Web Lock; sensitive drafts stay in memory. Unknown saves never claim success or
generate a fresh request identity. Explicit retry uses the same frozen request.
After reload only reconciliation is possible. A negative reconciliation takes
the shared write lock and durably cancels the original identity before allowing
a newly reviewed request. Even a rejected retry does not erase pending identity:
a delayed earlier request must still be reconciled. Session renewal preserves
the mounted draft. Confirmed commits refresh authoritative stock; reopened
details/choices/ledger fetch current data.

## Forward encryption and key custody

The independent PR keyring is reused with InventoryCrypto domain separation.
Do not change historical directory/account encryption inventories.

| New surface | Encrypted descriptive data | Operational plaintext |
| --- | --- | --- |
| inventory_adjustments.payload_ciphertext | Required reason, product/concentration/unit, location label, batch/expiry, before/change/after review scope, actor display, saved response | IDs/FKs, direction, exact quantity, actor/event/time, optional correction UUID |
| inventory_adjustment_requests.payload_ciphertext | Complete saved result or terminal cancellation marker | Opaque actor-bound UUID and keyed digest |
| inventory_lots.payload_ciphertext (new origin) | Adjustment provenance, product/unit, optional batch/expiry, original recorded time, origin location label | Adjustment/product/location IDs, original positive quantity |

AAD purposes are `inventory:adjustment`, `inventory:adjustment_retry` and the
existing `inventory:lot`; keyed fingerprints keep the `inventory:v1` domain.
Retain old PR keys for these payloads **and** every existing receipt, history,
batch setting/allocation, lot, opening, product, assembly, movement and retry.
Append-only trigger guards prohibit online ciphertext rewriting. Future offline
rotation must explicitly include these forward fields/purposes and immutable
history, with write exclusion and independently reviewed maintenance/recovery.
No trigger bypass, key replacement or historical inventory rewrite is included.
Account/directory maintenance accepts this explicitly reviewed successor because
it changes no account/directory encrypted fields or anchors, not arbitrary future
revisions.

## Focused verification and handoff

Run `sh scripts/test-inventory-ledger.sh` for named checks on a new private
socket-only PostgreSQL database. It does not read or alter configured stock.
The tests cover zero-stock additions, exact reductions, corrections, encryption,
append-only guards, rollback, authorization, invalid input, recorded opening,
allocation/transfer all-location versus location balance, date/type/pagination
semantics, PR accepted/rejected/correction/deletion, retained assembly evidence,
scope rejection, missing chain detection and real committed concurrency.

Fresh catalog metadata was observed on disposable PostgreSQL 17.5 after applying
the actual complete migration graph to an empty cluster, via the collector in
`tests/test_inventory_ledger.py::test_fresh_catalog_observation`. Its digest is
recorded in `scripts/fresh-install-catalog.json`; generated source/release pins
are reproducibility metadata, not deployment authorization or live acceptance.
The existing focused Chromium tester completed the initially interrupted journey
after correcting test-only locator/expectation mismatches. Its final run passed.
It verified zero-stock Actions and ledger identity/summary; blank optional batch
and expiry; reason/positive quantity/precision rejection without draft loss;
before/change/after review; and explicit commit. The real adjustment POST was
committed while its acknowledgement was deliberately dropped. Reload preserved
only the opaque owner/request identity; Check outcome confirmed that one commit,
refreshed stock and cleared the pending identity. A separate editor draft
survived session renewal. Exact-lot overdraw was rejected without losing input;
reasoned compensating reductions and their correction/source details were shown.
Recorded-date, location and type filters, real two-row server pagination and
closing-balance reconciliation passed. At 390px, dialog/page overflow, keyboard
focus containment and Escape focus return were checked. Screenshots and the
authenticated spec use the isolated disposable API/database harness, never
configured stock. Cross-engine and enlarged-text checks were not run.
No production access/deployment or real stock mutations are part of development
verification.

The final focused API run passed all 24 cases; the portal production compilation,
OpenAPI regeneration/library type checks, whitespace check and both offline
schema-source checks passed. The preview API restarted ready at
`0064_category_description`; automatic development synchronization applied the
reviewed successor without posting inventory. This follow-up CHECK relaxation
repairs the release-discovered mismatch between authored category description
whitespace and its former trim-only database constraint, with no row rewriting.
The inventory persistence change remains migration `0063_inventory_adjustments`.
The portal restarted cleanly and its unauthenticated login rendered without
browser errors. Fresh-install checks passed all 92 cases and release-policy
checks passed all 234 cases. The complete registered release gate is still being
checked/repaired; these focused results are not a claim that every stage passes.
