# Two-decimal business quantities

## Delivery boundary

The source integrates exact hundredths into the approved stock, procurement,
recipe and inventory-coupled material-volume paths. The migration and automatic
schema metadata are prepared, **not executed**. Runtime behavior and database
conversion have not been verified. No tests, builds, typechecks, regression or
release wrappers, browser scenarios, service starts/restarts, database queries,
Git pushes or deployments were performed. Only offline contract/metadata
generation and source/diff inspection were used.

Do not infer an empty database from other cleanup work. Do not run startup or
post-merge automation to bypass the no-activation restriction.

## Canonical policy

- Server Decimal and browser decimal-string/BigInt normalization use half-up:
  `12.344 → 12.34`, `12.345 → 12.35`, `1.005 → 1.01`.
- Bounded plain source strings accept up to six fractional digits. Original
  range and whole-unit restrictions are checked before rounding; post-round
  bounds also apply. Invalid original percentages cannot round into validity.
- Operational operands are normalized before calculation. Quantities, derived
  opening values and monetary calculation results round at explicit boundaries.
  A positive new quantity that would round to zero is rejected; an actual zero
  remains allowed only where the original business contract allowed it.
- Business displays and decimal-string exports use exactly two places. Existing
  whole-combo restrictions and integer-paise accounting remain intact. Historical
  financial totals and issued-document facts are not recalculated.
- Signed ledger deltas use exact Decimal/BigInt arithmetic. Compatibility helpers
  retaining a thousandths **integer scale** now return multiples of ten: scale is
  not permission to retain a third operational decimal.
- Concentrations, clinical results/progression, bottle references, identifiers,
  dates, counts, file and layout dimensions are not normalized.

## Authoritative boundaries

`schemas/quantities.py` and the portal `services/quantities.js` define the common
policy. Inventory locks require the precision boundary before operational work.
Inventory, reserve movement/dilution, opening stock, adjustment, receipt,
procurement and recipe writes use canonical quantities. Saved Extract/Dilution
ml inputs use the same contract, without interpreting concentration or dosage.
Availability and low-stock comparisons operate on normalized balances/thresholds.
Actual costs/rates remain exact; internal proportional dilution-cost allocation
retains its exact factor so display rounding cannot manufacture or lose cost.

Portal entry keeps partially edited drafts unchanged. Explicit review/write
paths normalize quantities, and review responses show saved values. Original
acceptance-versus-received checks precede rounding. Existing retry/stale-write
mechanisms remain; their historical evidence is not rewritten. Browser-local
new procurement saves normalize explicitly; historical validation uses retained
original arithmetic instead of silently rewriting stored records on render.

Stock grouping, histories, ledger views, opening valuations, PO/PR documents and
PDF renderers share two-place presentation. Pricing/material summaries and Doctor
import-review discount/payment-limit numbers use two places. SPT and settlement
totals retain their existing exact paise implementation.

## Forward-only existing-data transition

`0092_quantity_hundredths` follows the main project's declared
`0093_language_status` target under the existing automatic migration policy.
The no-op `0095_quantity_staged_merge` joins newer staged Cron/Language and
Designation source branches without including them in the declared quantity
target's ancestry.
This preserves the existing staged activation scope rather than implicitly
activating unrelated Cron migrations. There is no per-revision approval gate.
The revision calls the dedicated transition adapter inside the migration
transaction, obtains inventory/reserve advisory locks and exclusive dependency
table locks, and performs authenticated preflight **before** schema/data changes.

The preflight checks retained lot/source identity, every historical posting's
before/delta/after chain, source credits, paired transfers, reserve movements,
explicit dilution factors, receipt acceptance, assembly/adjustment/disposal and
authorized order-allocation evidence. It reconstructs reserve histories using
their source records' recorded times, not random posting UUID order.

The boundary stores:

1. Original source acceptance, normalized source acceptance and exact source
   residuals. These are separate from current on-hand residuals.
2. Each inventory/reserve location's original current balance, normalized balance
   and exact residual. Mutable inventory balances become canonical hundredths.
3. Original ciphertext plus authenticated normalized operational shadows for
   current receipts, recipes, openings, reserves, costs and Extract settings,
   and original/normalized PO line snapshots. Changed legitimate business
   records cease matching their old shadows; archived originals remain immutable.
4. Original/normalized thresholds and their residuals.
5. An encrypted aggregate transition report with original inventory chains,
   normalization decisions, snapshot digests and exact reconciliation residuals.

Old postings remain epoch 1, unchanged. New immutable postings are epoch 2 and
database guards require exact hundredths for their delta/before/after values.
Ledger readers apply each location checkpoint once between epochs, insert a
clearly labelled precision reconciliation entry, and separately reconcile source
acceptance residuals. This distinction also handles later receipt reductions to
zero without incorrectly rounding a negative historical source remainder.
Reserve availability starts at its checkpoint and applies only later postings.
Old lot acceptance remains original evidence until an explicit authorized source
change; operational acceptance is reconciled against the source checkpoint.

No immutable posting, original source document, completed payment receipt or
issued financial total is silently edited. Existing truncate/update/delete guards
remain. Precision archives are themselves immutable. A downgrade is refused:
recovery requires an independently verified original backup and its original
decryption keys, not a reverse rounding attempt.

## Explicit blocked cases

Preflight aborts the transaction for unreadable ciphertext, missing or ambiguous
source evidence, broken/unordered chains, unpaired transfers, inconsistent
receipt state, normalized accepted quantities exceeding their PO line, invalid
whole-combo evidence, unrepresentable bounds, or an incomplete bounded scan.
The adapter's per-table ceiling is 100,000 rows: exceeding it requires an
explicitly reviewed bounded/paged implementation, never a truncated conversion.

Current recipes whose positive ingredients would normalize to zero require an
explicit corrected recipe. Active Extract settings or pending configured quotes
that cannot meet the canonical contract require explicit review/re-quote;
historical legacy settings and consumed order evidence are retained as originals.
Legacy local procurement records remain original evidence and cannot be repaired
by formatting or inferred server ownership; incompatible linked balances require
explicit reconciliation rather than automatic rewrites.

Archive decryption keys remain required. Directory key inventories account for
retained Extract archives, so rotation must not misreport their keys as unused.
There is no automatic historical key-retirement or archive rewriting operation.

## Contract and activation handoff

Authoritative Pydantic definitions, OpenAPI snapshot and generated client/Zod
surfaces are synchronized using generation-only commands. The aggregate
`codegen` package script is deliberately not used because it runs typechecks.
Coordinated schema/readiness metadata includes the new boundary and inherits
all predecessor readiness checks.

Implementation and migration preparation do **not** establish successful
conversion or runtime correctness. Any future activation or checks require
separate authorization under the user's standing restrictions.
