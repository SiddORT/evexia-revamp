# Low Stock Alerts — source-only delivery

**Scheduling update:** Settings → Cron Jobs replaces Settings → Low Stock
Alerts. The recurring implementation and activation handoff are described in
[`low-stock-cron-jobs.md`](low-stock-cron-jobs.md). The inventory and purchasing
rules below are unchanged. The former fixed-weekly scheduling and single
optional-recipient descriptions below document the retained legacy contract,
not the new scheduler.

## Verification and activation boundary

The original weekly change was inspected as source only. **Runtime behavior and email delivery
were not verified.** No regression/release tests, browser probes, builds,
typechecks, validation scripts, release workflows, service restarts, migrations,
deployment, live email sends or business-data writes were executed.

The additive migration `0091_low_stock_alerts` follows
`0089_it_material_pricing`. It creates only:

- `low_stock_settings`: singleton version and encrypted optional recipient.
- `low_stock_settings_requests`: owned committed/cancelled request evidence.
- `low_stock_weeks`: one durable consumed claim per Kolkata calendar week.
- `low_stock_deliveries`: separate mandatory/additional recipient claims and
  encrypted transient destination snapshots.

Model registration, migration classification, inherited readiness probes,
account/directory successor compatibility and lifecycle worker integration are
prepared in source. The coordinated `development-contract.json` target and
generated application schema pin are deliberately **not advanced** here.
Existing migration approval/integrity manifests are not regenerated or claimed
to have passed. The new schema is staged, not applied.

An independently authorized activation must advance the coordinated schema
target to this successor (or a reviewed descendant), regenerate the matching
schema/integrity metadata and API contract through the existing project
procedures, apply the additive migration, and start the matching service
revision. None of those procedures are part of this delivery. The worker
requires the database revision to match the declared application revision and
all four new table shapes to be present before it can claim a week. Before
activation, shared Settings may report storage unavailable; no success or zero
inventory is inferred from that state.

The existing automatic post-merge setup was not run or changed. Its current
declared target remains unchanged; merging this source does not itself advance
that target. Do not treat this document as authorization to activate, deploy,
perform regression checks or send a live email.

## Inventory and purchasing

`app/services/low_stock.py` is the single complete alert projection for the API
listing and digest. It uses the existing transaction-held usable inventory
snapshot, expiry exclusion, quantity strings and active/non-deleted material
eligibility used by the PO products references. The bound Dilution material is
included by its ordinary active material identity, not inferred by name.
Assembled combos and reserve-only quantities never enter the result.

Amounts and thresholds are compared with `Decimal`: usable quantity at or
below zero is independently eligible, otherwise a non-null saved threshold
must be at least the usable quantity. Blank is not zero, and thresholds are
neither supplied nor rounded. Existing Stock Status `stock_alert` semantics,
Mix/Dilution setup rules and inventory accounting are unchanged.

Incomplete receipt coverage, bounded-scope overflow, unreadable inventory,
non-finite amounts or incompatible mixed lot units abort the whole projection.
No partial digest, inferred zero or false “no alerts” result is substituted.
The existing inventory bound applies before listing search and pagination;
raising that bound or adding unit conversions is outside this change.

`Inventory → Low Stock Alerts` uses stock-read access and independently gates
Create PO on PO-add permission. The link carries only an opaque material ID.
The new PO editor resolves that ID through its existing authorized product
references. **Use selected material** explicitly inserts the resolved material;
it replaces only a pristine blank starter line, otherwise appends without
overwriting existing lines. Quantity, agreed unit price and GST are blank for
this insertion. Supplier, destination, dates, quantity and commercial details
must be entered/reviewed through the ordinary preview and confirmed save.
Existing PO server authorization, review validation and duplicate-safe save
transactions remain authoritative. A reference that becomes inactive after
lookup is still rejected by normal preview/save reference validation.

A mounted editor captures the handoff only once. Pending/unreadable save state
takes priority over alert navigation and is never replaced. Stale or failed
lookups offer Retry, ordinary product selection and return to alerts, with the
existing draft confirmation.

## Shared recipient setting

Settings → Low Stock Alerts is protected Super Admin only. It stores one
optional additional email using the existing PR keyring under distinct
authenticated encryption domains. No address is saved in browser storage.
Blank clears only this optional recipient; the mandatory active protected
Super Admin is always resolved independently from the saved account mailbox.

Version checks and a serialized, owner-bound request identity prevent stale
writes. Unknown saves retain edits and offer Check save outcome, never an
automatic resend. Checking an absent request durably cancels it under the same
writer lock before reporting absence, preventing a delayed original request
from subsequently committing. Newer saved values are displayed for comparison,
not silently substituted for edits.

## Weekly handoff

The service-owned worker wakes every minute. A current Kolkata calendar week
becomes due Monday at 10:00 AM. Tuesday–Sunday recovery can claim only that
current week; Monday before 10:00 cannot claim the previous week. No historical
backlog, manual resend or configuration-change replay exists.

The week and both recipient slots are durably consumed before preparing the
digest. Missing/invalid recipients are recorded independently. Valid equal
mailboxes are deduplicated with a scoped keyed address index. Recipient
addresses are encrypted while preparing and removed from terminal delivery
rows; they are never exposed to the other mailbox or logged.

One complete authoritative snapshot supplies escaped text and HTML, snapshot
time, quantities, existing units, saved thresholds/Not set and alert reasons.
The inventory URL is an ordinary authenticated URL derived from the existing
server-owned admitted-origin policy, never an incoming Host header, arbitrary
setting or bearer grant. An empty snapshot consumes the week without sending.

Each recipient resolves only the saved selected SMTP configuration through
the existing transport contract: verified TLS, no environment/provider/server
fallback. Preparation or sending failure for one recipient does not replay or
prevent the other. Durable `sending` precedes entering SMTP; acceptance becomes
`accepted`, ambiguous outcomes become `unknown`, and interrupted sending
leases become `unknown`. None is automatically resent. Failed or blocked
preparations are terminal for that week too. SMTP acceptance is not proof of
inbox delivery.

Existing expiry digests, order notifications and recipients are not changed.
