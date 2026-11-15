# Combination Pricing Master — prepared source only

## Activation boundary

The protected Super Admin **Pricing Rules** route is a saved-records master list.
**Add Rule** opens `/admin/pricing-rules/new` with the **Add Pricing Rule**
workspace: category → saved allergens → canonical dosage → Individual /
Combination of 2 / Combination of 3. Mix / No Mix is read-only Allergen Master
metadata. Exact-key **Edit** opens `/admin/pricing-rules/:id/edit`; the ID anchors
an immutable revision and resolves its latest category/dosage/member-key record.
No inline draft, Copy controls or unconfigured generated rows appear on the list.

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

### Separate entry and independent configuration status

The saved list uses the standard master DataTable, toolbar, status badges,
confirmation dialog and TablePagination. It shows Sr No, saved Product Category
and Allergens, Dosage, Combination Size, Latest Recorded MRP (including explicit
zero), Effective From, Status and row-specific Edit, Activate/Deactivate and
History actions. The default includes Active and Inactive keys. Historical
category/count and legacy material evidence remain read-only disclosures.
Loading, errors with explicit retry, and empty results are separate states.

GET `/combinations/rules` returns bounded pages of latest **recorded version**
per exact key, with complete total/filtered counts, never catalogue-generated
combinations. Unsearched/status-only reads paginate in SQL and decrypt only that
page. Search matches encrypted saved category/member names and dosage, streaming
batches of 100 and retaining only the requested page. Above 20,000 saved keys it
refuses search rather than show partial results or invented counts. Clearing search
still allows ordinary pagination. There is no plaintext name search index.
GET `/combinations/rules/{record_id}` resolves the saved exact key.

Edit freezes category, dosage, size and member IDs. It prefills the latest rate,
but leaves Effective From blank: a new revision requires an explicit unused date,
including corrections to past rates. The existing atomic append endpoint, exact
decimal normalization, eligibility/scope digests and unchanged-body uncertain
retry are reused. An exact-key edit cannot change another combination.
Ineligible saved members stay readable, but new rate revisions still require
current eligibility. Back/Cancel retain the existing draft confirmation/unknown
save guards; confirmed saves clear the draft and return to a freshly loaded list.

POST `/combinations/rules/{record_id}/status` appends independent status evidence.
Every existing/new key has a persisted **Active** baseline at status version 1.
The additive migration prepares baseline rows for existing keys; new-key creation
initializes its baseline in the same atomic transaction. Baseline evidence is
explicitly labelled: its actor identifies the original source rate owner, its
timestamp is baseline initialization time, and its revision ID preserves source
provenance. It never claims a historical user activation. Later events record the
actual status-change actor/time. Existing-key rate revisions do not touch status,
so neither editing nor Copy/batch creation can reactivate inactive rules.
Missing status rows fail explicitly rather than assume Active.
GET `/combinations/rules/{record_id}/status-history` exposes paged immutable
status evidence alongside dated rate history. Catalogue status stays independent.

Status actions require the unchanged latest rate revision and expected status
version. The shared transaction serializes rate/status changes. The actor-bound
encrypted request ledger uses a separate operation identity for exact-body retry
and durable rejection. Unknown/malformed outcomes lock navigation and other
actions until **Retry same submission** resolves them. A definitive stale
rejection requires closing, explicitly refreshing and reviewing before a fresh
action. Activation reconstructs the exact eligible group; it never revives
deleted/inactive categories, moved/inactive members, No Mix pairs/triples or the
bound Dilution material. Deactivation remains available for historical keys.

`0106_combination_rule_status` follows only `0104`, adding an append-only status
table with initial Active baselines, per-key version uniqueness and
UPDATE/DELETE/TRUNCATE guards. It does not rewrite rate history.
`0107_combination_status_merge` retains the separate staged ancestry via `0105`.
Development declaration/readiness now target `0106`. Exact `0107` compatibility
checks status, combination, count-tariff and both inherited predecessor branches.
Account/Directory maintenance supports only reviewed exact successors, without
altering historical encryption inventories. Source policy classifications and
literal development hashes are coordinated, not permission to execute migrations
or activate unrelated staged features.

The source handoff includes the four new contracts and generated client/Zod
source. Only offline scoped OpenAPI export, direct Orval generation, constant
hoisting and generated-source formatting were used. The package codegen wrapper
was not used because it chains a prohibited typecheck. An initial offline export
stopped on mismatched declarations; it generated after declaration coordination.
Unrelated contract semantics were retained.

**Source review is not runtime verification.** No tests/builds/typechecks,
regression/release checks or validation wrappers, runtime/browser/preview probes,
service starts/restarts, live writes, migration execution or deployments were
performed by this task. UI, API and responsive/theme behavior remain operationally
unverified. The new database changes are prepared, not applied.

### Previous combination-only migration ancestry

`0104_combination_pricing` follows the declared `0102_category_count_tariffs`
branch, creates an empty append-only encrypted table, unique date/version
constraints and UPDATE/DELETE/TRUNCATE immutability guards. It seeds no data.
`0105_combination_staged_merge` joins that branch with the pre-existing staged
`0103` source ancestry without making staged low-stock/designation features part
of the development target. The predecessor declaration/readiness used `0104`, and
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
