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

A rule references a real shared category UUID and 1–100 distinct shared allergen
UUIDs. Every target must be active, non-deleted, and currently in that category
when saved. Names are read from the shared masters, not used as identities.
Historical reads show inactive/deleted references and category moves explicitly.
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

Copy preloads the source cutoff/rates but clears the destination category and
allergens. It is editable and requires an explicit create save. Changing category
clears all selected allergens. Copy never mutates the source or overwrites an
existing destination.

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

Delivery was reviewed by source/diff only: UI/API envelopes, date inclusion,
exact money normalization, authorization, reference checks, target conflicts,
idempotent retry/rejection handling, stale edits, and the absence of order
consumers. Static OpenAPI/client generation and development schema source
metadata generation were performed; they do not start services or validate
runtime behavior.

**No regression/release suites, typechecks, builds, browser/runtime checks,
managed-service restarts, live-data edits, migrations, deployment, or production
activation were performed.** The additive migration is unapplied. Database
constraints, concurrency, encrypted round-trips, shared-browser persistence,
navigation/accessibility, and responsive appearance remain runtime-unverified.
No fresh-install catalogue fingerprint or release-validation evidence was
fabricated. The coordinated source target now names the new revision; a later
authorized lifecycle/startup may attempt schema reconciliation. That activation
and any required release/fresh-install review are separate from this source
delivery.
