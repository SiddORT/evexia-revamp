# MR Accounts and Super Admin Settlements

## Access and starting point

- Admin: `/admin/accounts/settlements`, protected **Super Admin review and
  one-way verification only**. No posting, allocation editing, deletion or
  verification reversal. Ordinary staff and Doctors have no settlement access.
- MR: `/mr/accounts`, one direct Accounts navigation entry, with transactions
  against only the authenticated MR's own saved orders. Legacy `/mr/payments`
  list/new/detail paths and `/mr/accounts/settlements` redirect to Accounts,
  discarding demo IDs rather than resolving them as live transactions.
  Demo Payments components/data are not imported or migrated into Accounts.
- The ledger starts empty. Paid/Partial/Unpaid flags are **not receipts** and
  never seed a previous paid amount. Existing payment flags are not changed.
- MR results include all owned saved non-draft orders across the four supported
  order types. The Admin screen retains an In process default filter; choosing
  All includes other saved stages. `Approved` displays as In process.
  Private incomplete entry drafts and historical SPT Draft rows are excluded.
  Shipment status scopes elsewhere are unchanged.

## Financial facts

Saved Immunotherapy `totalMinor`, SPT/Lupin `total` and Kits `pricing.total` are
the only authoritative totals. No current catalogue lookup, patient count
allocation, Business Parking, demo history, inferred credit or payment deadline
is used. A multi-patient order is one financial row containing all saved patient
associations. People are saved snapshots; optional missing people are shown as
not recorded. Admin sees saved phone/email details; MR Doctor/Patient contacts
are masked on the server, while the MR's own saved phone/email remain readable.
Addresses are not included in this finance projection.

An absent price gives unavailable Total and Balance, not zero; that order cannot
receive payments. A genuine saved zero is different and has no payable balance.
Paid is the exact sum of committed ledger entries; Balance is saved Total minus
Paid. Corrupt/unreadable financial history fails explicitly rather than giving
estimated, rounded or truncated balances.

Each new entry is **Not verified**. No transactions is distinct. Verified
requires non-null persisted verifier identity and time for every entry; no
legacy payment flag is verification evidence. The UI calls Not verified
**Unverified**. Derived payment status is Unpaid, Part paid, Paid (including a
known zero total), or Unavailable. Only approved/In process orders and subsequent
Shipped, Delivered or Returned stages with a positive known balance are payable.
Confirmed/Saved, rejected and cancelled records are read-only. Fulfillment
transitions neither forgive debt nor create credits.

Protected Super Admin may explicitly verify an individual recorded allocation.
Verifier identity and time persist on that entry with an audit event. Repeating
verification returns current history without replacing the original attribution.
Mixed verified/unverified entries leave the order Unverified; only every entry
verified yields Verified. Verification never posts money again and never changes
Paid/Balance: committed payments reduce balances before verification.
The forward guard permits only the first paired verifier/time update, blocks
all other entry changes/deletion, and still rejects verification at insertion.
No invoice, document, refund, export or gateway operation is included.

## Filters and bounded reads

Order and payment From/To dates include both ends and combine with Doctor, MR,
Patient, verification, order type, saved order status, derived payment status and
text search. Search uses authorized business numbers, dates and saved person
names/business codes, never hidden contact details or UUIDs. Counts and filtering
cover the authorized server dataset before paging. A payment-date range requires an actual
transaction in that range: unpaid orders do not match it. All committed payments
still contribute to Paid/Balance and full row history even when the filter
matches just one transaction. Verification filters are order-level: No
transactions, all entries verified, or at least one unverified entry.

The MR identity is fixed, derived from the revalidated session/profile. A
different MR filter is denied server-side. Person selectors scan only saved
non-draft order associations within the caller's authorized scope, not unrestricted
master directories. Selected saved labels are retained while searching or paging.
The browser requests one section at a time.

Listings use bounded offset pagination (1–100 records), at most 20,000 candidate
orders and 50,000 candidate ledger entries. Exceeding a bound is an explicit
narrow-the-filters error, never a partial total. Payments and patients do not
multiply order rows. The UI refreshes on mount, explicit refresh, focus and a
finite one-minute refresh interval, paused while a transaction draft is open.

## Posting, concurrency and retry safety

### Payment eligibility clarification — source-only handoff

Admin approval remains required before an MR can record a payment. Add payment
explains that selection requires an Admin-approved order with a known positive
outstanding balance, including In process, Shipped, Delivered and Returned
orders. Its unfiltered empty state says **No orders eligible for payment** and
explains that unpaid orders awaiting approval will appear after approval once
a known outstanding balance exists; it does not claim all balances are settled.
Search-empty and selected-only-empty messages remain separate from that state,
and loading and load failures retain their existing distinct paths.

In MR Accounts, nonpayable positive-balance rows in the saved Confirmed or Saved
stages explicitly say **Admin approval required before payment**. Other excluded
statuses retain the generic restriction instead of being described as awaiting
approval. Missing totals/balances remain Unavailable, never zero. The same row
explanation is used in the desktop table and mobile cards; Admin copy is unchanged.

This is presentation only: the independent `payable_only=true` server picker,
projection and posting checks remain unchanged. No dataset scans, requests,
financial rules, lifecycle changes, API contracts or receipt/retry behavior were
added or changed. Static source review traced the picker to the existing payable
projection and posting guards: unapproved, rejected/cancelled, fully paid and
unpriced orders remain excluded under that policy.

**Verification for this clarification was static source review only. No tests,
regression/release checks, builds, typechecks, validation wrappers, runtime or
browser probes, service/workflow starts or restarts, migrations, production
access or deployments were performed. Runtime behavior remains unverified.**

### Existing payment flow

Add Payment opens immediately without selecting main-list rows. Its independently
paginated server search uses `payable_only=true`, unaffected by Accounts filters.
Selections and explicit allocation amounts survive modal search and paging;
select-all names **the current page only**. The 100-order batch cap is displayed
and enforced in both client and server. Removing a row removes it from the total.
A common calendar date, searchable payment mode and optional Transaction ID/UTR
accompany a separate positive INR amount for each selected order.
Reference is trimmed plain text, at most 100 characters, without Unicode control
characters. It lives in the existing encrypted batch payload, not a new ledger
or plaintext column. Old batches without reference read as null.
The review freezes the exact payload, versions, amounts, reference and key;
late picker responses cannot alter the reviewed allocation snapshots.
The confirmation shows the exact aggregate. Inputs remain raw until validation;
negative signs or other invalid characters are never silently stripped into a
different amount.

The API revalidates identity, active saved MR and its existing assignment policy;
derives creator/MR itself; and denies Admin writes independently of the UI.
Policy/identity/assignment locks precede a separate settlement advisory lock.
Order rows are locked in a consistent type/ID order. Every selected order must
still belong to the MR, be in a payable approved/fulfillment stage, have the expected version and recorded
paid sum, have an authoritative saved total, and have enough balance. Duplicate
type-qualified orders, excess decimal precision, zero/negative amounts,
overpayment and stale facts reject the entire batch. Nothing changes the source
order's payment flags or approval/shipment state.

Batches, allocations and rejected request outcomes are committed atomically.
Financial documents use directory encryption keys with a dedicated settlements
AAD namespace. Operational references, payment dates, creation time and actor/MR
IDs remain queryable; amount, mode and submitted request data are encrypted.
The idempotency UUID is the immutable batch/outcome identity. Replays require
the same actor, saved MR assignment and exact normalized body. Missing legacy
reference and explicit null are equivalent for old committed/rejected replays.
Original posting results remain unchanged when entries are verified. Committed replies
also recheck current ownership of every referenced order.

After a lost/unreadable response, the client freezes both body and key, blocks
repeat clicks/navigation, and offers Check status or Retry same submission.
An absent lookup **is not cancellation** and never permits a fresh key. Durable
rejection outcomes prevent a delayed original request from posting later.
Only a durable rejection can unlock editing after an uncertain submission;
loss of access to a previously committed reply is never declared a rejection.
Same-account session renewal keeps the mounted dialog; account/scope changes
clear it and discard late responses. Drafts are tab-local, not saved to browser
storage; browser close/reload warnings do not guarantee recovery after closing.

### Payment response confirmation fix — source-only handoff

Settlement mutations use the shared authenticated transport, but not its
Purchase Order response contract. Previously, successful payment batches were
rejected for lacking `number` and `lines`; verification records were rejected
for lacking `lines`. This could show an uncertain outcome after a successful
HTTP response, before settlement-specific confirmation ran. An HTTP 200 alone
does not prove that a particular payment or balance was saved.

The transport now handles settlement mutation responses separately, requiring
a non-null, non-array object after the unchanged session/scope, route,
permission and HTTP-error guards. Purchase Order response requirements and
all other resource validators are unchanged.

Source tracing confirms these existing callers remain the success authority:

- Posting passes the reply to `confirmBatch`, which matches the frozen
  idempotency key, date, mode, optional reference, every type-qualified order
  allocation and exact aggregate using BigInt paise. Only then, with the
  identity guard still satisfied, does the dialog close, show the recorded
  notice and refresh the list.
- Verification passes the reply through `validateRecord` for record/history
  consistency, then checks the original order key and the requested entry's
  Verified state. The history dialog checks identity before updating its
  record and notice; closing refreshes the list even after a lost reply.
- Malformed or mismatched posting replies still enter the uncertain state
  without clearing the frozen body/key. Check status reads that same key;
  committed results still need `confirmBatch`, absence never unlocks editing,
  and only a durable rejection resolves an uncertain submission as rejected.
  Retry same submission sends the unchanged frozen body/key. The server
  rechecks actor/MR ownership and the exact normalized request before returning
  an existing result rather than inserting another receipt. No automatic
  retry or new request identity is introduced.
- Transport failures and changed sessions/scopes retain their existing
  error paths. Neither HTTP success nor the transport's object check is
  settlement confirmation.

This fix changes no ledger entries, balances, verification evidence, backend
contracts or permissions. It does not establish whether the screenshot's
specific payment committed. Existing mounted uncertain submissions retain
their Check status and Retry same submission controls; no payment was posted,
looked up or retried on the user's behalf.

**Review was static source inspection only. No tests, regression/release
checks, builds, typechecks, validation/completion-check wrappers, runtime or
browser verification, service starts/restarts, preview restoration, migrations,
production access or deployment were performed for this fix.** Runtime
confirmation and persistence remain unverified.

## API

All paths below are under `/api/v1/admin/settlements`; both authorized portals
use the same independently protected service:

- `GET ""`: combined filters and one bounded page with exact financial history.
- `GET /references/{doctors|mrs|patients}`: bounded saved-order selector choices.
- `POST /transactions`: common date/mode/optional reference and explicit per-order allocations,
  expected source versions/paid amounts and one immutable idempotency key.
- `GET /requests/{key}`: owner/MR-bound committed, durably rejected or absent
  outcome. No unrestricted batch lookup.
- `GET /history/{kind}/{identity}`: protected order history independent of its
  later lifecycle. History remains stored even after it leaves the default
  In process listing. MR access always checks current order ownership.
- `POST /transactions/{entry_id}/verify`: protected Super Admin-only one-way
  verification. Revalidates the server identity under policy/financial locks,
  takes the source-order lock before entry locking, and returns the current
  order projection. MR and ordinary staff cannot use this operation. The browser
  request guard permits exactly this Admin mutation, not generic settlement POSTs.

Every row's accessible View transactions action opens a separate history dialog
with real persisted amounts, dates, modes, supplied references and verification.
No transactions has its own empty state. History load and verification failures
have explicit retry/reload paths; a lost verification response is resolved by
reloading or repeating the same entry verification. Closing after a verification
attempt refreshes the listing even if its response was lost.

The FastAPI schemas and exported OpenAPI/generated clients include these
contracts. Monetary values are strings and browser aggregates use BigInt paise.

## Schema and operational handoff

The original empty ledger is `0077_settlements`. Forward
`0090_settlement_verification` follows the merged `0089_invoice_settings` head and
replaces only the settlement-entry update/delete guard. No receipt reconstruction,
new ledger, financial column rewrite or data backfill is needed.
The coordinated development declaration, automatic migration classification and
source-integrity metadata name this successor. Account/directory compatibility
inherits the predecessor contracts and readiness inherits every preceding probe,
also requiring the enabled verification guard.

**No migration was executed during this work.** Development still needs the
normal development schema synchronization/API restart before these
endpoints are usable. Running the pre-existing merge/startup automation later
can apply automatic development migrations; it was not invoked here.

No production schema was activated or deployed. Production fresh-install/catalog
evidence remains pinned to the previously observed head; no passing catalog
fingerprint, release evidence or production approval has been invented.
Production preparation requires separate authorization and genuine evidence.

Retain the directory decryption keys used by settlement documents. Successor
compatibility does not authorize bypassing append-only triggers or dropping
old keys. Verification changes neither encryption inventories nor key custody.

## Verification performed and explicitly not performed

This Accounts completion was **source-review only**: source/contract/caller
inspection plus offline contract/client generation and formatting. No compilation
or typecheck was run. Unrelated refined Pricing Rules validators and repeated
query serialization were retained rather than replaced by generator drift.

**Not run:** regression suites, release checks, release workflows, API/database
integration tests, browser transaction tests, schema activation, service/workflow
restarts or production activation. Static evidence does not establish runtime
authorization, concurrent-post, migration or browser correctness. These checks
must not be run without later user approval.

No browser/screenshot or runtime probe was attempted for this completion.
Authenticated navigation, modal keyboard/responsive behavior, persistence,
idempotency under lost responses, role denials, notification compatibility and
actual PostgreSQL trigger/migration behavior remain unverified at runtime.

## MR order eligibility

MR placement, submitted-order corrections and explicit rejected-order
resubmissions share a server financial policy across Immunotherapy, SPT, Lupin,
and Kits & Consumables. Admin placement is unchanged.

- A positive **MR Payment Limit** must accommodate the existing unpaid balance
  plus the proposed order's unpaid amount. Equality is allowed. Replacements
  remove the old order before adding its replacement and retain its committed
  payments, so one order never consumes credit twice.
- A positive **MR Doctor Days Limit** blocks the selected Doctor if an owned
  unpaid order is **older than**, not equal to, that many calendar days. Days
  run from the immutable saved order date using the Asia/Kolkata business date,
  while a positive balance remains. This includes a replacement's retained
  original date; edits/resubmission never restart the clock.
- Each zero setting independently disables that restriction. Doctor Master
  payment/day settings are neither additional limits nor fallbacks.
- Obligations include pending `Confirmed`/SPT `Saved`, legacy `Approved`,
  `In process`, `Shipped`, legacy `Delivered`, and `Returned`. Shipment returns
  do not create financial credit. `Draft`, `Rejected`, void and cancelled
  placements are excluded. Rejected corrections are savable, with eligibility
  checked again on explicit resubmission. Incomplete SPT Drafts consume no
  credit and remain savable.
- One source order is counted once regardless of patient membership. Amounts
  use the exact saved total less committed settlement entries only.
  Paid/Partial/Unpaid labels, browser/demo payments, current catalogue prices,
  and independent Kits Business Parking are not receipts or offsets.
- An enabled rule fails clearly if required totals/settings/history are
  unknown, inconsistent, unreadable or exceed bounded complete-history
  evaluation. A corrected pricing basis awaiting Admin review is not treated
  as a trustworthy proposed price. This means unpriced new Immunotherapy or
  Kits orders **cannot be MR-placed with an enabled financial rule** until
  authoritative pricing is available; no guessed catalogue price or zero
  fallback is introduced. Admin can still place/review orders.

The `/eligibility` preview under each existing order resource takes the typed
final order input (or version-bound resubmission body), optional saved order ID,
and resubmit flag. It returns structured reasons and MR-scoped balances/settings.
It never exposes another MR's finances. Final writes do not trust preview
results: they independently enforce the policy in the committing transaction.
Existing committed idempotency replies replay before any new policy evaluation.

Lock ordering is policy → shared settlement/eligibility financial lock →
authenticated identity/assignment graph → request key → source/reference/file
rows. Orders, review/resubmission, settlements and shipment lifecycle writes
participate. MR setting/master mutations already share the outer policy lock.
Inventory advice takes the inventory lock later, within the same policy scope.
No new schema or financial-opening transaction is introduced.

Only Immunotherapy currently persists actual allergen component references.
Advice sums the authoritative lifetime lot/location balances, including
Unallocated quantities, exactly as Stock Status does. Zero is unavailable stock;
positive stock at or below an existing threshold is low stock. Missing receipt
coverage, unavailable inventory schema or missing product evidence is explicitly
**unavailable to check**, never zero or healthy. Advice exposes only selected
allergen labels, aggregate quantity, threshold and state, not ledger/location
details. No recipe is inferred for Kits, SPT or Lupin. No demand conversion,
reservation, deduction or fulfillment block is added.

The MR forms check finances before showing the existing themed accessible
continue/cancel stock popup. The advice is bound to the frozen submission and
account; editing after cancellation needs a fresh check. Cancelling or a
financial rejection retains values and permitted verified uploads. Once an
order request has been sent, unchanged retries bypass a new browser preview and
retain the existing uncertain-outcome recovery/key behavior; the server still
replays or enforces atomically.

### Eligibility handoff and validation boundary

Only offline OpenAPI/client generation, generated-library TypeScript
compilation, static source parsing/transformation, contract comparison and
lock/caller inspection were performed. No regression suite, release check,
release workflow, API/database integration test, browser transaction test,
workflow restart, migration or production activation was performed. The changed
protected screens were not signed into for visual verification. Runtime
concurrency, multi-session financial boundaries and popup keyboard behavior
remain unverified; these require separate permission to test.

The current saved order and committed settlement schemas/data must already be
available, along with their decryption keys. Inventory initialization is not a
placement prerequisite: incomplete coverage produces advisory unavailable-check
messages. No service restart was attempted because existing startup workflows
can implicitly run forbidden checks or migrations.
