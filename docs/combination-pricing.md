# Combination Pricing Master — prepared source only

## Activation boundary

The existing protected Super Admin **Pricing Rules** route now has one active
configuration workspace: category → saved allergens → canonical dosage →
Individual / Combination of 2 / Combination of 3. There is no second pricing
configuration page. Mix / No Mix is read-only Allergen Master metadata.

These are **configuration-only** combination rates. **No current placement,
quotation, confirmation, approval, clinical quantity or inventory consumer reads
this table. Activating combination rates in those consumers requires separate
authorization.** Existing category/count and legacy material-price consumers,
policy identifiers, order snapshots, money, dates and behavior remain unchanged.
Replacing the editor does not delete their records or convert them to combination
rates. Count evidence is available read-only for the selected category; legacy
material evidence stays a secondary read-only disclosure with its truthful INR/ml
units. The Settings Extract & Dilution editor retains its own authority.

## Identity, eligibility and exact money

A new key is Product Category UUID + canonical dosage PD, DD or B1–B8 + sorted
distinct allergen UUIDs. Each key has independent append-only dated revisions.
The amount is **Total Suborder MRP in INR**, never per ml, a per-allergen price,
a sum of individual prices or an inferred cost. Each supplied amount has two
decimal places in transport/storage. The UI accepts integer/one-decimal entry
and pads exact trailing zeroes without floating-point conversion. It never
rounds excess precision. Explicit zero is valid; blank is not zero.

Discovery uses active, nondeleted saved categories and allergens, excluding the
immutable separately bound Dilution inventory material by ID, not name.
Individuals include either Mix flag. Pairs/triples contain distinct Mix members
only, all from one category. Generation is unordered: four Mix allergens produce
four individuals, six pairs or four triples. No Mix never enters a pair/triple.

Selecting a category initially selects **all** its eligible members, not just the
visible page. Allergen search/pagination never change that selection. A deliberate
subset limits generated keys without altering Allergen Master. Categories with
more than 500 eligible members require Clear all and explicit paged subset
selection (up to 500). This is an explicit refusal, not truncated “all” coverage.

Each scope is capped at **1,000 generated combinations**, counted before
enumeration. Larger scopes are rejected with their actual count and instructions
to select fewer allergens. Generated search/pages are bounded to 100 rows and
include the complete bounded key list and a full-scope count/version. No operation
claims all combinations were covered when a bound was exceeded.

## Draft editing and atomic Save

The row Rate is an independent draft entry, shown beside the latest recorded MRP.
Nothing is seeded from Unit Price, count tariffs, per-ml rules, quantities or sums.
Untouched blank entries create no revisions; explicitly edited zero does.
Clearing a rate outside Copy omits that new revision, never deletes saved history.
With an applied Copy baseline, clearing an override is invalid until a rate is
entered or the whole draft is explicitly discarded.

**Copy rate to all** requires an explicitly entered source rate and applies to
every generated key in the selected category, dosage, allergen selection and
combination size. Search-hidden/nonvisible pages are included. It never affects
another scope or persisted history. Differing draft amounts require a platform
overwrite confirmation. A later row override affects only that row. Explicit Save
appends all supplied draft rates under one explicit Effective From date in one
transaction. A duplicate date for any affected key rejects the entire batch.
Dates retain inclusive-start semantics: the greatest saved effective date not
after a future separately authorized pricing date would be applicable; latest
recorded/dated is not necessarily effective today.

Navigation, category, dosage, size and selection changes cannot silently discard
edits. Scope changes require platform confirmation. Before-unload retains the
browser's native warning boundary. Pending/unknown saves lock editing and
navigation. The exact frozen body/key is retained in memory for retry; no browser
storage persists private drafts/rates. Auth renewal keeps the mounted draft under
the existing portal boundary; owner remounts cannot expose another user's draft.

Discovery captures category/member versions, saved Mix/name/status/category
eligibility and the Dilution binding in an eligibility digest. A separate
scope-version digest binds every latest key revision, independent of visible
search results. On Save, shared policy/configuration locks, authenticated owner
revalidation, bounded catalogue table/row locks and new reads reconstruct the
whole scope and revalidate both digests. Master changes, new applicable members,
status/membership changes, competing rate revisions and same-date conflicts fail
without partial writes. Reload keeps the draft and blocks when a captured scope
changed. The operator can review history, then explicitly discard and regenerate.
No stale copy baseline is reassigned to new members automatically.

## Persistence, evidence and transport

`app/schemas/combination_pricing.py` and the OpenAPI document define:

- GET `/admin/pricing-rules/combinations/categories`: bounded searchable choices;
  inactive/deleted categories with retained pricing evidence remain reviewable.
- GET `/admin/pricing-rules/combinations/allergens/{category_id}`: bounded eligible
  saved members and read-only flags.
- POST `/admin/pricing-rules/combinations/generate`: read-only bounded generation,
  latest saved evidence, scope identities, search and pagination.
- POST `/admin/pricing-rules/combinations/save`: atomic dated append with explicit
  source-copy baseline and per-key overrides.
- GET `/admin/pricing-rules/combinations/history/{category_id}`: bounded immutable
  saved revisions by canonical dosage, optionally by exact member key.

Every operation revalidates protected Super Admin authorization. No Staff/MR
permissions are added. Frontend transport allowlists only these exact paths and
read/write methods; generated POST discovery is explicitly not a mutation.
Save-result validation matches the original request ID, category/dosage/date,
both scope digests, complete expected key set, exact amounts and attribution.
Unknown/malformed replies never count as success.

Money and immutable saved member/category names/flags use existing PR AES-GCM
keys with AAD domain `it-combination-tariff`. Stable category/member UUID key,
dosage, date/version, authenticated actor and recorded time are queryable
operational metadata, not encrypted names or clinical quantities. The existing
actor-bound encrypted `it-pricing-request` ledger stores exact-body outcomes and
durable rejections. Shared locking serializes request-key ownership checks.
An owner/body-matched rejection sets the existing tariff rejection header only
after commit, allowing an uncertain editor to unlock safely. Unrelated-key or
nonterminal errors cannot close an already uncertain retry.

History keeps immutable member/name/Mix snapshots even after rename, category
move, No Mix conversion, deactivation or deletion. “Review all saved [dosage]
combinations” includes no-longer-generated keys. Soft-deleted categories with
retained records remain history-only choices. New eligibility never rekeys old
rates. Actor IDs, timestamps, revision IDs and versions remain visible in history.
Audit records attribute one atomic batch to the authenticated actor/session.
Keep all historical PR decryption keys; no key rotation or history rewrite is
authorized by this feature.

## Prepared migration and source handoff

`0104_combination_pricing` follows the declared `0102_category_count_tariffs`
branch, creates an empty append-only encrypted table, unique date/version
constraints and UPDATE/DELETE/TRUNCATE immutability guards. It seeds no data.
`0105_combination_staged_merge` joins that branch with the pre-existing staged
`0103` source ancestry without making staged low-stock/designation features part
of the development target. Development declaration/readiness use `0104`, and
exact `0105` runtime compatibility retains **both** predecessor probe paths.
Account/Directory maintenance inherits only the explicitly supported independent
PR-key successor; existing historical encryption inventories are not rewritten.
Automatic migration classification remains the existing policy, not permission
to apply it during this source-only delivery.

The development metadata contains the prepared target and literal source hashes.
They were updated as source metadata only, **not** by running review, validation,
release or completion-check scripts. Production fresh-install catalogs, protected
review manifests and recovery attestations were not replaced or fabricated.

Prepared changes include backend schemas/models/services/routes, two additive
migration sources, readiness/maintenance compatibility, narrow authenticated
portal transport, the replacement workspace and scoped CSS, OpenAPI and generated
client/validator source, and this handoff. Offline OpenAPI export, direct Orval
generation/constant hoisting and source formatting only were performed.

**No tests, regressions, release checks, builds, typechecks, validation wrappers,
browser/manual/runtime probes, preview tools, service starts/restarts, live
migrations, database/business writes, deployments or live repricing were
performed.** Runtime behavior, database application and visual layouts are
unverified. Any future operational activation/verification is a separate action;
source delivery does not authorize it.
