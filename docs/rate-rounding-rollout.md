# Two-decimal rate policy and operator-only rollout

## Scope and implementation boundary

Rates/prices and discounts normalize with decimal-safe **ROUND_HALF_UP** to
hundredths. `12` → `12.00`, `12.345` → `12.35`, `1.005` → `1.01`.
Shared Category prices and Allergen selling prices/GST preserve the historical
64-character plain-decimal source limit, twelve integer/six fractional digits,
optional null prices, exact XML workbook lexemes and text-cell exports.
Original percentage bounds are enforced before rounding; a rounded carry over
`999999999999.99` is an error. Unsupported notation/overprecision still fails.
CSV/form sources remain plain decimals; supported XLSX numeric scientific
lexemes are validated and expanded exactly before rate normalization.

Doctor discounts accept six source places and check the original 0–100 range.
Doctor/MR payment limits and Sales Targets retain existing two-place input
constraints; presentation is fixed-two, not a relaxation of their money contracts.
Opening balances, quantities, counts, thresholds, concentrations, identifiers
and dates keep their existing rules. Allergen thresholds remain six-place.

New shared PO catalogue choices commit normalized price/GST snapshots. Existing
PO rates, immutable paise amounts, historical split rates and audit payloads are
not rewritten. Historical rate strings remain precise in the API for retained
line arithmetic. Only screen/print/PDF presentation rounds them to two places.
Split GST arithmetic retains extra internal digits (new rates may halve to three
places; historical six-place rates may halve to seven). Display rounding must
never be fed back into tax calculation. New local PO writes store decimal rate
strings and calculate in scaled integers; historical numeric local orders keep
their original arithmetic/amount validation.

Legacy local Category/Allergen/Doctor rates accept earlier numeric records and
new decimal strings. Reads do not normalize stored rates. Create/edit/import and
explicit status changes normalize only affected master records, preserving other
rows and optimistic snapshot guards. Catalogue datasets/IDs remain separate
from shared masters; no implicit mirroring or migration is introduced.
Session-only Lupin prices normalize on save and use exact BigInt cents.
Rate-bearing master samples are read-only until an explicit guarded write.

## Unexecuted migration

`0042_rate_hundredths` follows `0041_location_geography` and is **forward-only**.
Runtime identity readiness and offline directory rotation explicitly recognize
this successor because it changes no account/directory encryption contract.
The generated automatic migration/fresh-install target remains pinned to `0041`;
recognition is not permission to apply `0042` or any other pending migration.
The migration policy classifies `0042` as `operator_only`.

**Installation/release metadata is deliberately not re-approved here.** The
existing review generator requires the pinned target to equal the source head,
and a tested fresh-install catalogue for that target. Adding this pending
migration means the predecessor fresh-install review no longer covers the source
graph. Offline metadata refresh therefore stops with
`APPLICATION_REQUIREMENT_NOT_SOURCE_HEAD`; it does not justify moving the pin,
inventing catalogue evidence or weakening that guard. Fresh installation and
release approval remain blocked until a separately authorized rollout task
provides the `0042` fresh catalogue/review and coordinated release metadata.
No managed database migration, data rewrite, backup, deployment or activation
was performed for this task. Do not run a general migrate-to-head wrapper:
earlier pending operations require their own independent approvals.

Before separately approving activation:

1. Inventory the actual schema head and pending ancestry. Review every pending
   migration independently. Identify all writers, background jobs, old app
   instances and direct SQL clients.
2. Obtain a durable, access-restricted external full database backup plus the
   independently retained encryption/key recovery material. Verify restoration
   in an approved isolated environment. The migration cannot recover discarded
   digits; database downgrade is deliberately refused.
3. Run the following **read-only** preflight on the intended database under
   operator authorization. Capture counts and release/backup identifiers in the
   operator change log; do not copy prices or private data into public logs.

```sql
SELECT count(*) AS rows_including_deleted,
       count(*) FILTER (WHERE unit_price <> round(unit_price, 2)) AS changed,
       count(*) FILTER (WHERE unit_price < 0
         OR unit_price > 999999999999.999999
         OR round(unit_price, 2) > 999999999999.99) AS blocked_rates,
       count(*) FILTER (WHERE version >= 2147483647) AS blocked_versions
FROM product_categories;

SELECT count(*) AS rows_including_deleted,
       count(*) FILTER (WHERE selling_price <> round(selling_price, 2)
                          OR gst <> round(gst, 2)) AS changed,
       count(*) FILTER (WHERE selling_price < 0
         OR selling_price > 999999999999.999999
         OR round(selling_price, 2) > 999999999999.99
         OR gst < 0 OR gst > 100) AS blocked_rates,
       count(*) FILTER (WHERE version >= 2147483647) AS blocked_versions
FROM allergen_products;
```

4. Any blocked rate/version stops activation; resolve it under separate approval,
   never clamp prices or reset versions. Plan a maintenance window sized for the
   table rewrites and lock wait. Stop all writers and exclude old release access.
5. Apply only the reviewed revision range using the project's approved Alembic
   operator procedure. The migration takes access-exclusive locks in a single
   transaction, repeats blocking preflight, removes scale coercion, rounds exact
   PostgreSQL NUMERIC values, and installs explicit magnitude/two-place CHECKs.
   Positive PostgreSQL `round(numeric, 2)` is equivalent to half-up here.
6. Every master row, including unchanged/tombstoned rows, advances one concurrency
   version and receives the migration transaction time as updated time. IDs,
   relationships, creation metadata, deletion metadata and last human updater
   references stay intact. No historical audit event is modified and no human
   save is fabricated. The operator change log is the attribution for this
   system normalization; unchanged `updated_by` remains the last human updater,
   not a claim that person performed the migration.
7. Start the coordinated API/frontend release only after schema acceptance.
   For fresh-install/release authorization, obtain separately authorized
   disposable fresh-catalogue evidence for `0042`, review the target change in
   `development-contract.json`, and regenerate metadata with
   `python3 -B scripts/review-schema-release.py --refresh`. Do not do this merely
   to clear a blocked report, and do not interpret regenerated hashes as a
   validation signature or migration permission.
   Discard old import reviews (digest namespaces changed), refresh master forms
   and catalogue choices, and re-review pending PO saves. Version increments
   reject predecessor drafts; exact new DB constraints reject old six-place
   writers rather than silently rounding them. Close old application instances
   and drain pooled/prepared connections at the schema transition.
8. Record post-activation evidence under a separately approved verification plan.
   Never infer activation or live correctness from Git or offline code generation.
   Recovery after commit requires coordinated restoration of the approved
   backup and predecessor release, with an explicit plan for intervening writes.

## Task verification limitation

Per explicit request, no tests were added, changed or run; no test suites,
browser scenarios, migration execution or test-driven verification were used.
Work was inspected through source/diff searches and offline contract generation
only. Existing test expectations may still encode the predecessor rate policy;
they must be reviewed in a separately authorized test-maintenance task.
