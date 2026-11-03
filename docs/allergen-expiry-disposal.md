# Allergen expiry, actual costs and disposal

## Source-only delivery and activation limits

This implementation prepares forward migration `0084_allergen_expiry`, the
coordinated development declaration/source hashes, API contract, generated
clients, protected inventory screens and a lifecycle-managed worker. It does
**not** establish that any database has migrated or that a running service has
loaded these changes.

No regression suites, release/development gates, check wrappers, type checks,
browser/runtime probes, service restarts, live emails, deployments or manually
executed migrations were run for this work. OpenAPI export, client generation
and generated-source formatting were performed as source generation only,
without the usual codegen wrapper's trailing type-check command.

Migration execution, fresh/populated-database compatibility, worker lifecycle,
Kolkata-midnight behavior, competing disposals, SMTP delivery and rendered UI
behavior remain unverified. Existing production fresh-install catalog evidence
has not been fabricated or advanced. The normal automatic migration runners
retain their existing activation prerequisites; this document does not bypass
them or authorize a deployment.

## Date and quantity contract

- The authoritative date is a **calendar date in Asia/Kolkata**. A batch is
  unusable from **00:00 on its saved expiry date**, not the following day.
- Expiring Soon separates expiry-today (already unusable) from tomorrow through
  day 15 inclusive. Both groups sort by expiry, then product and stable batch/
  location identity. Expired Products includes expiry-today and earlier dates.
- Purchased and diluted allergen lots use their ledger lot ID plus actual
  location ID (or the genuine Unallocated opening location). Reserve batches use
  their original reserve ID plus actual location ID. Classification does not
  invent or transfer stock to an "Expired" storage location.
- The ledger/reserve postings remain the only quantity authority. Consumed
  concentrates and assembly components do not appear again as remaining stock.
  Finished non-allergen combo stock and historical postings are not reclassified.
- Legacy missing expiry is **unknown**, never silently safely unexpired. Such
  allergen stock is excluded from usable totals/choices and counted separately;
  opening histories are not given fictional expiry dates.

The protected API worker scans at most 100 lots and 100 reserves per cycle,
retains durable per-source cursors and wraps for future expiry dates. Immutable
separation markers retain detected batch identity. **Markers are not the safety
authority**: availability totals/choices, transfers, reserve dilution, assembly
and reduction adjustments recheck encrypted expiry dates directly. Stock cannot
be used while the worker or SMTP is unavailable. Receipt corrections cannot
revive expired or disposed batch identities; a disposed lot cannot gain new
acceptance. Read-time classification is automatic even before a scan catches up.

## Actual cost evidence and exact loss

All rates are **INR per the batch's established quantity unit**. Purchased lots
use procurement quantity units, not packs; new manufactured reserves and their
reviewed diluted outputs use ml. Existing descriptive reserve units are not
converted. Input permits a plain nonnegative decimal with up to nine integer
and six fractional digits. The encrypted cost record retains source/reason,
actor, time, basis and origin. A known zero is a real cost; missing is null.

No catalogue selling price, PO price, opening valuation, tax, freight or assumed
manufacturing overhead is an actual acquisition/manufacturing cost. None is
used as a fallback or historical backfill. Receipt and manufactured-entry forms
can optionally capture a documented actual cost. Existing batches need an
explicit protected Admin action. Recorded evidence cannot be overwritten; its
batch identity cannot subsequently be relabelled by a receipt edit.

Transfers retain the same batch cost. Diluted output inherits **source reserve
unit cost / reviewed factor**, preserving source input total cost exactly.
Missing source cost remains missing; entering it later also values remaining
output, not past disposals. The cost form on a diluted batch explicitly targets
its original reserve, not an independently invented output rate.

All quantity, rate, extension and summary calculations use decimal strings and
exact server Decimal arithmetic, with a 60-digit operation context for loss
projections. The UI displays the returned INR strings without binary float
rounding. Values may retain more than two fractional places; these are stock
loss-analysis values, not rounded accounting journals.

Summary cards separately show:

- Known expired value **still awaiting disposal**.
- Known **disposed loss**, frozen at each disposal.
- Missing-cost batch counts and quantities grouped by unit, separately for
  awaiting and disposed quantities. Uncosted loss is explicitly incomplete.
- Unknown-expiry batch counts, excluded from usable stock.

Summaries include all search-matching records, not only a page. Paginated lists
scan a finite 2,000-record scope per source table and combined batch/location
projection. Exceeding any bound fails explicitly without partial rows, totals
or an incomplete digest. There is no automatic infinite-page traversal.

## Disposal and retry ownership

Only the existing protected system Super Admin may query expiry/reserve costs,
record missing costs, review disposal, dispose or reconcile expiry requests.
Ordinary staff grants, MR, Doctor and Patient accounts gain no access. Existing
stock readers still see only their existing stock surface, with unusable stock
excluded.

Disposal reviews **the entire remaining quantity of one batch/location** and
requires a reason. The platform confirmation includes product/batch, physical
location, exact quantity, known unit cost and value (or explicit unavailable
cost). Cancel changes nothing. Save recomputes expiry, quantity and cost under
the common inventory-then-reserve locks and rejects stale review tokens.

Successful lot disposal adds a negative `disposal:` ledger posting; reserve
disposal adds a separate append-only reserve posting referencing the disposal,
not a fictitious movement. The original snapshot and physical-location history
are retained. The immutable encrypted disposal freezes actor, time, reason,
quantity, cost evidence and value. A later cost entry never rewrites earlier
uncosted loss. Database triggers prevent updates/deletes of cost, separation and
disposal evidence. Retain the PR encryption keys needed to read this evidence;
directory/account rotation does not rotate these independent PR envelopes.

Actor-bound idempotency records serialize with inventory writers. Competing
requests cannot remove the same balance twice. Reconciliation creates a durable
cancelled record before reporting an absent request not committed, closing a
delayed original request. The UI journals only opaque owner-bound request IDs
under Web Locks and blocks replacement cost/disposal saves until an uncertain
outcome is reconciled, including after reload. No batch details or cost drafts
are persisted in that local retry journal.

## Daily Admin email

The API lifespan starts/stops a separate serial expiry worker. Once per minute
it attempts the bounded scan and today's digest independently. A database
Kolkata-day primary key and serialized daily claim prevent competing workers or
restarts from producing another daily handoff.

Only **today** is eligible: startup can catch up today's not-yet-claimed digest,
not historical missed dates. Any claimed day is terminal after a block, failure,
interrupted preparation or uncertain handoff. Configuration repairs apply to
future days and never automatically replay that day's email.

The worker resolves exactly one active protected system Admin and its encrypted
login-account email, and uses only the saved default Communication email/SMTP
configuration and the existing verified-TLS transport. No MR/staff/Doctor/
Patient recipient, environment-SMTP fallback, SMS or WABA channel is added.

`inventory_expiry_templates.daily_admin` is a database-backed subject and
introduction. The worker adds the complete bounded, escaped product/category/
batch/date/remaining-quantity/location list, divided into today and next 15 days.
Trusted authenticated links use the validated HTTPS portal origin already
configured by `PASSWORD_RECOVERY_URL`, with `/admin/inventory/expiring` and
`/admin/inventory/expired`; no request Host, guessed domain or bearer token is
used. Users must sign in normally.

Visible daily states are:

- `preparing`: durable claim, no SMTP handoff yet.
- `sending`: durable handoff marker committed before calling SMTP.
- `blocked`: missing/invalid SMTP, recipient, template, trusted origin or expired
  current-day dispatch window.
- `failed`: definite preparation/provider rejection.
- `unknown`: uncertain handoff or an expired sending lease after interruption.
- `accepted`: provider acceptance observed, **not proof of inbox delivery**.

Interrupted preparations become failed; interrupted sends become unknown.
Neither is automatically resent. Only the claim's token can settle a late
observed acceptance. No message/recipient/credential/provider exception text is
logged. Inventory expiry protection is independent of every email outcome.

## API and navigation

Authenticated portal routes: `/admin/inventory/expiring` and
`/admin/inventory/expired` (including read-only history tab). Stock Status and
In-house Stock provide actions into them.

Under `/api/v1/admin/inventory/expiry`:

- `GET ""` / `GET /reconcile`: paginated `soon`, `expired` or `history` projection;
  optional today/next15 group and text search. Refresh is not an expiry prerequisite.
- `POST /review`: reviewed disposal snapshot/token, no mutation.
- `POST /disposals`: reasoned, confirmed, idempotent disposal.
- `POST /costs`: explicit missing actual cost with provenance.
- `GET /requests/{key}`: serialized actor-owned outcome/cancellation.

Typed response models, exported OpenAPI and generated React/Zod contracts are
included. The portal uses its existing authenticated inventory request adapter.
