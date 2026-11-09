# IT Pricing Rules — configuration only

## Scope and access

`/admin/pricing-rules` is a standalone Super Admin page directly after the
Orders navigation group. Both the page/transport and every server operation
require the protected Super Admin identity. Staff master or order grants do not
grant access; MRs have no access. No new assignable permission is introduced.

These settings are reserved for eventual **Immunotherapy only** use. Automatic
price lookup or application has not been authorized. No order screen or order
service imports or fetches these settings. Existing IT SUB/header pricing,
clinical defaults, extract/dilution, grouping, prescriptions, approvals, totals,
historical orders, and catalogue prices are unchanged.

## Saved contract

A single rule references 1–100 explicit shared category UUIDs and 1–100 distinct
shared allergen UUIDs in total. Every target must be active, non-deleted, and
currently in a selected active category when saved. Selecting a category does
not select its present or future allergens. Names come from shared masters, not
identity matching. Each target also records its category **at explicit save**;
historical reads show inactive/deleted references and category moves explicitly,
even when the new category is another category selected in the same rule.
A physically missing reference fails the read rather than returning an empty
successful list.

The date is a real date-only `YYYY-MM-DD` **Order Date Cutoff**. The two prices are
alternatives: before the date versus **on or after it, including the cutoff day**.
No evaluation endpoint is provided. Both values are required nonnegative INR
decimal strings using the shared catalogue rate contract: up to twelve integer
and six source fractional digits, exact half-up rounding to two decimals, maximum
`999999999999.99` after rounding. Blank does not mean zero. Saved/listed prices
have two decimal places; date display follows Admin preferences.

Only one rule may claim an allergen UUID at a time (an allergen has one current
category). Any overlap is rejected, even if the cutoff or rates differ. This is
configuration conflict rejection, not approval of a future lookup precedence.
Moving a master allergen does not move or rewrite its existing rule.

Copy preloads the source cutoff/rates but clears the destination categories and
allergens. It is editable and requires an explicit create save. Changing category
selection retains compatible selections: adding a category keeps existing
allergens; removing one removes only allergens attributed to that category.
Copy never mutates the source or overwrites an existing destination.

Both category and allergen controls are searchable finite multi-selects with
selected counts and removable selections. The allergen popup groups by stable
category UUID and readable category name; choices remain checked while searching
and paging. There is no category Select all.

Allergen **Select all** collects every matching active allergen in the currently
selected categories, not just the displayed page. With no search this means all
eligible allergens in those categories. Every page carries a fingerprint of the
complete filtered catalogue; changed fingerprints/totals, duplicate or missing
results, transport failure, or a union exceeding the 100-target cap leave the
selection unchanged. Narrow the search/categories or remove selections when
over the cap. Existing selections outside the search are retained. Search/scope
changes, popup closure and editor teardown cancel pending work. No partial or
future membership is implied.

The saved-rule list has one live search bar, not separate filter/apply/refresh
controls. Literal category/allergen-name matching runs on the full server-side
dataset before pagination, including historical inactive/deleted references,
with each matching rule counted once. Query changes reset pagination and cancel
previous requests. No-matches is distinct from a never-configured empty list.
Saves reload the current result set automatically; load failures offer Retry.

## Persistence and concurrency

The `/api/v1/admin/pricing-rules` API provides paged list/detail, bounded active
category/allergen choices, create, and version-checked edit only. There is no
resolver, delete, bulk import/export, or order consumer.

`0086_it_pricing_rules`, following `0085_placement_email_details`, adds:

- `it_pricing_rules`: stable category relationship, version, actor/timestamps and
  encrypted cutoff/rates.
- `it_pricing_rule_targets`: FK-backed memberships and unique allergen target
  constraint.
- `it_pricing_rule_requests`: actor-bound encrypted immutable request/outcome.

Forward migration `0087_pricing_rule_categories` follows the existing
`0086_immunotherapy_extract` head; no applied migration is rewritten. It adds
explicit `it_pricing_rule_categories` membership and a saved `category_id` on
each target. Existing membership and attribution are copied from each rule's
original category, **never** today's possibly moved allergen. Rates, cutoff,
versions, actor history, requests and encrypted outcomes are not rewritten.
The original rule category column remains a compatibility anchor, not the full
category set. Coordinated source/readiness/maintenance metadata names the
successor and retains all predecessor readiness probes and encryption inventories.

New requests use `categoryIds`; the original `categoryId` format remains
accepted, including historical exact retries. Both formats together are rejected.
The UI also sends `allergenCategoryIds` to assert the category seen at selection
time, so a move during editing cannot be silently reclassified at save. Legacy
edits without this map reject moves of retained historical targets. An explicit
remove/reselect in the UI records the new attribution. Saved responses contain
`categories`, the compatibility `category`, current allergen `categoryId`, and
`savedCategoryId`. Historical encrypted responses are adapted in memory only;
the original canonical request identity and stored outcomes remain intact.

The existing validated PR encryption keyring is reused with independent
`it-pricing-rule` and `it-pricing-request` authenticated field domains. Category
and allergen identities, rule membership, actor IDs, versions, and timestamps
remain relational plaintext; prices/cutoff and retry payloads do not. Old
decryption keys must remain available for retained request history.

The policy lock orders access revalidation before reference/rule locks. A
configuration advisory lock serializes save/retry decisions. Target membership
replacement, version increment, encrypted retry response, and value-free audit
event commit atomically. Active category/allergen relationships are checked
again on the server under locks. No catalogue row is updated.

Each explicit attempt uses an idempotency UUID. Identical retries return the
original committed response without another write/audit event. Reusing a key
for another actor or different normalized operation/body is rejected. Definitive
stale/reference/target failures record an encrypted durable rejection before
responding, preventing delayed originals from committing later under that key.
Storage/transport/session/malformed-response uncertainty is never reported as
success. The editor retains its immutable attempt and locks fields for an
unchanged retry; stale drafts cannot overwrite a newer version. The latest
saved version can be viewed beside a stale draft without replacing it.

Attempts/drafts are memory-only, not browser-local persistence. Explicit leave
or close confirmations explain that abandoning an uncertain attempt loses its
safe retry and that the rule may already be saved. Users must inspect the shared
list before creating another attempt after abandoning one.

Readiness probes the new tables/keyring and then continues every predecessor
probe. Exact account/directory maintenance revision allowlists include the
successor without changing encryption inventories or accepting unknown heads.

## Source handoff and activation limitations

Delivery was reviewed by source/diff only: UI/API envelopes, multi-category
membership and historical attribution, complete paged selection, search/counts,
date inclusion,
exact money normalization, authorization, reference checks, target conflicts,
idempotent retry/rejection handling, stale edits, and the absence of order
consumers. OpenAPI, generated-client source and coordinated schema-source metadata
were updated directly. Code-generation/check wrappers were not run because they
can chain typechecks or broader validation; regeneration remains unverified.

**No regression/release suites, typechecks, builds, browser/runtime checks,
managed-service restarts, live-data edits, migrations, deployment, or production
activation were performed.** The new additive migration is unapplied. Database
constraints, concurrency, encrypted round-trips, shared-browser persistence,
navigation/accessibility, and responsive appearance remain runtime-unverified.
No fresh-install catalogue fingerprint or release-validation evidence was
fabricated. The coordinated source target now names the new revision; a later
authorized lifecycle/startup may attempt schema reconciliation. That activation
and any required release/fresh-install review are separate from this source
delivery.

## Pricing editor error investigation — 2026-11-03

This investigation used source/diff review, the two supplied screenshots, and
already-existing workflow log files only. No tests, builds, typechecks,
regression/release checks or completion/release wrappers, browser/runtime
probes, service starts/restarts, migrations, live-data changes, or deployment
were performed. Runtime behavior of the changes remains unverified.

### Confirmed source defect in save confirmation

The shared authenticated transport let Pricing Rule mutations fall through to
its Purchase Order success validator. A valid Pricing Rule has neither an order
`number` nor `lines`, so even a successful create was converted into an ambiguous
save error **before** `serverPricingRules.savePricingRule` could parse it.
The existing API workflow logs contain a `POST /admin/pricing-rules` with status
201. This supports the source finding, but does not establish the outcome of
any particular pictured attempt: the logs intentionally contain no request body
or saved-rule identifier.

Pricing Rule mutations now use their own response branch. The transport checks
the basic identity/version envelope and the existing strict service parser still
confirms UUIDs, categories, explicit saved allergen membership, normalized
two-decimal rates, the date-only cutoff, and the expected resulting version.
No strict Pricing Rule validation was removed.

The editor still freezes category/allergen IDs, saved category attribution,
normalized rates, cutoff, key and expected edit version once per attempt.
The backend still validates active references under locks and atomically stores
membership, encrypted rates/date, encrypted actor-bound request/outcome, and an
audit event. Identical retries retrieve that original outcome before current
master validation or edit-version checks. No persistence, encryption, request
canonicalization, or retry-history schema was changed.

Genuine uncertainty retains the exact attempt and locks edits. A later rejected
HTTP retry alone also cannot clear an already-uncertain attempt to permit a new
key. The uncertainty notice is no longer concatenated with a second transport
warning. Locked selectors describe saving/unconfirmed state, rather than
incorrectly asking for categories already selected.

### Allergen loading: operational cause remains unresolved

Source trace: the editor passes the complete sorted category-ID set; the
transport appends a separate `categoryIds` query parameter for each UUID;
FastAPI accepts that repeated list. The protected reference service validates
all selected categories are active, filters active/non-deleted allergens by
that set and literal search, computes the filtered total/fingerprint, and
orders bounded pages by category and allergen. The response schema retains
allergen `categoryId`; the client checks pagination, UUIDs, active status,
selected-category membership, and the catalogue fingerprint before displaying
category groups. No comma-separated encoding defect was found.

Existing API logs contain successful reference-route responses (status 200),
but record only `/admin/pricing-rules/references/{kind}` without query
parameters, kind, response contents or browser-side fetch/JSON errors. They
cannot identify which request belongs to the screenshot, whether the browser
received a complete JSON body, or whether a timeout/intermediary failure or a
different running revision was involved. Older frontend startup logs also
contain port-in-use errors; these do not establish the cause of this request.
There is insufficient evidence to claim the underlying dropdown failure has
been repaired. No speculative query, serialization, keyring, or schema change
was made, and no local dummy choices were introduced.

Reference delivery/invalid-JSON/service-rejection errors now name allergen or
category choices, retain selections, and point to Retry choices without
exposing arbitrary backend details or blaming every error on the connection.
Strictly malformed successful replies still fail rather than becoming empty
choices. Loading, successful empty results, failures and obsolete-scope
responses retain their distinct existing handling.

Select all now uses a Pricing-only content-width compact action and short
scope text. All-pages matching, explicit finite membership, the 100-allergen
union cap, all-or-nothing updates, cancellation, busy feedback and keyboard
focus behavior are unchanged in the shared New/Edit/Copy control.

Resolving the remaining operational question requires a separately authorized
investigation correlating a failing browser reference request's status,
response content type, JSON validity and timing with its API request log and
running revision. Do not record tokens, cookies, request bodies or sensitive
response content. This handoff does not authorize starting services, probes,
regression/release checks, migrations or deployment.

## Select all focus interruption — source-only repair

Source review identified a self-cancellation path shared by New/Edit/Copy:
Select all reports busy to the editor, which locks Dialog dismissal. Dialog
previously focused its section unconditionally when that lock became active.
That focus left PricingMultiSelect, whose blur handler closed the popup and
aborted the collection before applying its result. This path can interrupt even
a single matching allergen; it was not reproduced at runtime.

Select all now focuses its still-enabled search input before disabling its
action button, preventing the focused button's disabled transition from causing
a destination-less blur. Dialog retains enabled, rendered, non-inert focus
already inside itself when dismissal locks; it still focuses the section if
focus is outside or on disabled/unavailable contents. Its Tab trap, Escape and
backdrop dismissal guards remain intact. The editor's own Cancel button and
close handler also honor selection busy state.

The dropdown's Cancel Select all action remains enabled and keyboard-reachable
while collecting. Explicit cancellation, focus/pointer departure, query/category
scope changes, disabled state and teardown retain their existing abort paths.
The controller-identity cleanup still prevents an older request from clearing
a newer action's busy state. The collection still applies one complete union
only after every page passes the existing checks; selected counts, checks and
chips derive from that updated draft. Existing selections and saved category
attribution, active/category response validation, catalogue fingerprints,
duplicate/missing-page rejection and the 100-target union cap are unchanged.
No backend, schema, pricing calculation or saved-rule contract was changed.

This repair was reviewed by source/diff only. No tests, builds, typechecks,
regression/release/completion check wrappers, browser/runtime probes, service
starts/restarts, preview restoration, migrations or deployment were performed.
Single-match and multi-page selection, pointer/keyboard focus transitions,
cancellation and modal behavior remain runtime-unverified.
