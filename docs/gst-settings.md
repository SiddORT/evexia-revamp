# Applicable GST and durable history

Source delivery only: runtime behavior, persistence, concurrency, migration
execution and rendered layout are **unverified**. No tests, regression/release
or completion-validation wrappers, builds/typechecks, runtime/browser probes,
managed service starts/restarts, migrations, deployments or live-order writes
were performed. Offline contract/client formatting and schema metadata
generation are source preparation, not runtime evidence.

## Effective-date policy and opening provenance

The approved initial policy is **12% through 21 September 2025, then 5% from
22 September 2025 inclusive**. It is represented by an opening period
(`0001-01-01`, not an asserted historical creation date) and the literal
`2025-09-22` boundary. A rate applies from its date inclusive until the next
boundary exclusive. Today uses Asia/Kolkata; all boundaries are calendar dates.

Reads never insert/update settings. With no legacy configuration the approved
schedule is the read-only initial baseline, revision zero. If legacy
`gst_settings` exists it remains untouched, labeled with its saved version and
cutoff/rates. Original actor/timestamp are unavailable, not fabricated.
Conflicting legacy values remain visible next to the approved comparison;
first pricing fails closed until Super Admin deliberately confirms the approved
opening policy. Confirmation records a new event, not an audit of old changes.
The first explicit revision durably captures this opening provenance.

Settings' **Add GST change** requires an exact percentage string (0–100,
maximum two fractional digits) and real literal **Applicable from** date.
Future dates are allowed, shown separately, and cannot replace today's rate
before their date. Multiple distinct future boundaries are supported. Duplicate
effective dates are rejected, not silently replaced. Existing boundaries cannot
be edited/deleted. The supported schedule is bounded to 1,000 periods.

## Protected writes, history and uncertain outcomes

`GET/POST /api/v1/admin/gst-settings` and `GET .../history` independently
revalidate the protected Super Admin account/session. MR/Staff order permissions
do not grant Settings access. History is newest-first keyset paging, default
10 and maximum 25 revisions per request.

`gst_policy_revisions` is the policy itself, not an audit written separately
from a mutable current row. A transaction-held advisory lock serializes writers
and first-pricing policy selection. Each immutable revision stores full prior/new
schedules, effective business date, action, opening provenance, verified actor
UUID/role label, database recorded timestamp and the canonical request.
UPDATE/DELETE/TRUNCATE guards preserve history. Business effective date and
recorded timestamp have different meanings.

Writes require `expected_version` and an actor-owned `request_id`. Retries of
the exact canonical request acknowledge its original revision and load the
latest schedule without writing/reverting anything. Reusing a key for another
actor/payload is rejected. The client keeps an uncertain save payload frozen
and offers only unchanged retry. It never concludes an absent read means a
delayed write was cancelled. Stale definitive failures retain the draft and
require loading/comparing the saved schedule before an explicit new request.
Navigation guards and platform confirmations remain in use.

## Kits-only financial connection

Only Kits has an existing GST-bearing pricing model. Immunotherapy, Lupin, SPT,
PO agreed line GST, catalogue GST/HSN, invoices and settlement histories are not
given any new tax model or recalculated.

First pricing selects server-side using the immutable saved order date, or
the existing supplied creation/import calendar date / Kolkata-today rule for
a new order. New encrypted pricing snapshots retain `taxPercentage` and
`gstPolicy` (selected rate, applicable boundary, policy revision and order date).
Revision zero means the approved initial baseline, not an invented audit event.
An unavailable schema or unconfirmed opening conflict blocks first pricing;
there is no fallback to 5% or acceptance of a client tax override.

`GET /api/v1/admin/kits-orders/gst-evidence` returns only that small evidence
object to authorized protected pricing callers. Optional `record_id` resolves
the owned/scoped saved row date and ignores any competing supplied date;
without a row the optional creation date defaults to Kolkata today.
The editor calculates exact integer-paise half-up previews with that rate and
submits the evidence. Save resolves again under the policy transaction lock
and rejects stale evidence. Import reviews bind resolved financial snapshots in
the existing review token; changes require a fresh review.

Saved priced orders retain their actual GST evidence. Explicit pricing edits
use the saved rate, never today's rate. Omitted pricing, unchanged pricing/item
bases, reads, policy saves and idempotent retries preserve saved money without
normalizing/backfilling it. Non-financial MR corrections retain protected prices
and the existing eligibility completeness checks. Eligibility recalculation only
compares saved evidence; it never persists/reprices it.

Authorized summaries label actual applied GST separately from today's policy.
Missing historical price/tax evidence is unavailable/not yet priced; absent
policy revision/boundary is not inferred. Existing financial redaction stays
unchanged; MR/Staff do not receive pricing or protected history.

## Prepared schema, not activation

`0100_applicable_gst` follows the opening-only `0098_opening_corrections`
development path. DDL-free `0101_gst_staged_merge` keeps one source head while
leaving unrelated staged branches outside the declared development target.
No applied migration is modified. Readiness inherits all opening/HSN/quantity
and earlier probes; maintenance preserves predecessor encryption inventories.
Automatic migration policy is unchanged. No operational runner or post-merge
hook was executed, and production fresh-install catalog evidence is not advanced.
