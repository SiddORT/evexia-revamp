# Category Count Pricing History — prepared source

## Policy and scope

New governed MR Immunotherapy placements, including final placement of a private
incomplete draft, use `category_count_total_mrp_v1`. One tariff amount is the
**Total Suborder MRP**, not an INR/ml rate. Its key is the saved Product Category
UUID, exact clinical allergen count (1, 2 or 3), and Effective From date.
The order total is the exact integer-paise sum of header MRPs. Never multiply
the tariff by count, ml or bottle quantity. Dilution is not a clinical child
and adds no separate monetary charge.

Existing same-category/Mix grouping and No Mix isolation remain authoritative.
The boundary is three clinical allergens **per suborder**, never three across
the whole order. Historical/unrestricted Admin creation is not automatically
enrolled in this policy. SPT, Kits, Lupin, catalogue prices, purchase prices,
taxes, discounts and permissions are unchanged.

## Combined master

Pricing Rules is protected Super Admin-only. Choose a real saved category using
the paged searchable picker; “Search saved tariffs only” restricts this search
to categories with tariff history. The selected category has exactly three
main rows: Single, Double and Triple. Each row has one dated MRP, with one,
two or three independent Extract/Dilution pairs stacked inside its quantity
cells. Quantities retain PD, DD and B1–B8 dosage context and stable skin-test
rank assignment. The amount is independent of dosage and ranked quantity rows.

The quantity editor calls the **same** Extract Settings service as Settings →
Immunotherapy. There is no copied quantity store. Null means not recorded,
not zero. Existing configuration versions and original order assignments remain
evidence. Clinical quantities are never seeded from prices, divided between
children or inferred from MRP.

For a count without history, the selected category's current Unit Price is an
editable suggestion, visibly labelled with its source and category version.
It is never multiplied, automatically saved or given an inferred date.
An unreadable/missing Unit Price is reported and leaves an empty input; entered
zero is valid. Saved count tariffs load their own most-recent effective amount
and never reload today's master price over edits/history.

Tariffs and quantities are independent operations:

- **Save count N tariff only** appends one explicitly dated MRP.
- **Save quantity changes only** saves the six ranked pairs for the selected
  category/dosage using its existing expected version.
- Success messages explicitly identify the domain saved. An unconfirmed tariff
  attempt locks its exact body/key/version and offers unchanged retry.
- Only an owner/body-matched durable rejection releases an uncertain tariff
  attempt. Generic HTTP/session/network errors do not prove rejection.
- Stale/duplicate-date rejection retains edits and requires history reload and
  comparison. Reload does not overwrite the retained input.
- Category changes and navigation guard unsaved work. Rate edits remain
  independent when changing dosage; no tariff operation writes quantities.

Legacy material-price rules remain searchable read-only evidence in the page.
The older endpoints are retained for contract/retry compatibility, not exposed
as the new editor and never consulted as new-policy fallback.

## Timeline, writes and protected history

`GET /v1/admin/pricing-rules/count-tariffs/categories` returns bounded
category search pages; `savedOnly=true` filters to saved tariffs.
`GET /v1/admin/pricing-rules/count-tariffs/{category_id}` reads chronological
history and the current master suggestion.
`POST /v1/admin/pricing-rules/count-tariffs` accepts categoryId, allergenCount,
totalMrp, effectiveFrom, expected_version and idempotencyKey.

Each category/count has an independent monotonic revision version. Writes share
the existing pricing/quantity configuration locks with quotes and final writes.
The current version must match exactly. Duplicate starting dates are rejected
even when amounts match. Each successful change appends a distinct dated
revision; old values are not edited or deleted. A newly supplied earlier date
is an explicit new entry, not inferred historical backfill.

Selection is the latest saved starting date **on or before** the immutable
order date. Starting dates are inclusive. Before the first configured date,
`imm_count_price_missing` reports the exact category/count/date; no live
catalogue, legacy per-ml or zero fallback is used. An unreadable selected
revision fails explicitly. History shows amount, starting date, revision,
version, actor UUID and recorded time. Displayed “until before” dates are
derived from the next chronological entry, not separately stored endpoints.

Request outcomes reuse the actor-bound encrypted Pricing Rules request ledger.
Success and definitive conflict outcomes commit atomically. Unchanged owned
retries return the original revision/error even after newer tariff revisions.
`X-IT-Tariff-Outcome: rejected` is emitted only after durable rejection.

## Orders, confirmation and inventory

The existing quote/eligibility/confirmation/final-write path uses the new total
before MR exposure decisions. The confirmation displays the exact sum of
Total Suborder MRPs, with no ml charge. The quote token binds dated revision
evidence, selected price, category/count/date, clinical membership, quantity
assignment, ownership and financial evidence. A changed applicable quote
requires confirmation again. Already committed unchanged order retries bypass
new decisions and return their original outcome.

Each saved priced header carries the immutable selected tariff revision,
version, amount and date/actor evidence, plus separate inventory components
containing actual Extract/Dilution ml and the bound material identity. Those
components have **no new monetary rate/charge**. Saved order reads and tariff
changes do not recalculate orders. Protected rate/history configuration is not
available to MR configuration endpoints; saved review presentation does not
show protected tariff history to MRs.

Explicit Admin quantity corrections preserve original clinicalAssignment
evidence and the saved tariff; correction evidence records before/after
quantities and actor/time. Changed clinical/pricing basis still requires a
separate explicit quote. Refreshing an existing count quote retains already
assigned quantities and explicit corrections, instead of reapplying current
quantity settings. Newly introduced children resolve the existing shared
configuration, and prior confirmed quote evidence is retained on refresh.

Approval understands both policies and validates saved evidence only, not
today's tariffs/settings. Explicit approval still requires verified prescription,
complete actual quantities, the real separately bound Dilution material and
sufficient usable allocated stock. Consumption uses the existing atomic ledger,
FEFO, expiry and no-partial-deduction safeguards. Placement reserves/deducts no
stock. Legacy `configured_material_ml_v1` orders keep their actual charges,
saved policy, explicit-refresh behavior and consumption path; no historical
tariff conversion, repricing or stock deduction occurs.

## Schema and verification limits

Prepared migration `0102_category_count_tariffs` follows the declared
`0100_applicable_gst` branch. It creates an empty encrypted append-only tariff
table with unique category/count/date and category/count/version constraints
and immutable UPDATE/DELETE/TRUNCATE guards. It seeds no rates, dates, clinical
quantities or order evidence. `0103_tariff_staged_merge` is a DDL-free source
join, not the development activation target. Readiness inherits all predecessor
probes and checks the new table, timeline uniqueness and immutability guards.
Account/directory maintenance compatibility is explicitly limited to the new
reviewed successor. Historical migration/encryption inventories are unchanged.

Tariff amounts use PR AES-GCM keys with the distinct `it-count-tariff` AAD domain.
Request outcomes retain `it-pricing-request`. Keep original PR keys for immutable
tariff and retry history; key replacement is not permission to rewrite history.

Only source/diff review and offline API/client generation/formatting were used.
The schema declaration and source hashes describe prepared bytes, not a
reproduced database. **Migrations were not executed; runtime behavior remains
unverified.** No tests, builds, typechecks, regression/release checks,
validation/completion-check wrappers, runtime/browser probes, service
starts/restarts, live mutations, deployment or production access were run.
The direct contract/client generators were used without their check wrappers;
the source-review wrapper was not run. Existing production catalog/release
evidence has not been fabricated or advanced.
