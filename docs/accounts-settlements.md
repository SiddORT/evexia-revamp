# Accounts > Settlements

## Access and starting point

- Admin: `/admin/accounts/settlements`, protected **Super Admin read-only**.
  Ordinary staff and Doctor identities receive no settlement access.
- MR: `/mr/accounts/settlements`, protected authenticated MR, with transactions
  against only that MR's own saved orders. The unrelated MR Payments demo remains
  unchanged and is not a source of money, identities or opening history.
- The ledger starts empty. Paid/Partial/Unpaid flags are **not receipts** and
  never seed a previous paid amount. Existing payment flags are not changed.
- All default results are saved In process orders (including the legacy
  persisted `Approved` spelling of that stage). Shipment status scopes elsewhere
  are unchanged.

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
legacy payment flag is verification evidence. This change exposes no approval,
edit, delete, refund, export, receipt or gateway operation. The migration rejects
verification-at-insert and makes all receipts and terminal outcomes immutable.
A future verification workflow requires separate approval/schema design.

## Filters and bounded reads

Order and payment From/To dates include both ends and combine with Doctor, MR,
Patient, verification and order type. A payment-date range requires an actual
transaction in that range: unpaid orders do not match it. All committed payments
still contribute to Paid/Balance and full row history even when the filter
matches just one transaction. Verification filters are order-level: No
transactions, all entries verified, or at least one unverified entry.

The MR identity is fixed, derived from the revalidated session/profile. A
different MR filter is denied server-side. Person selectors scan only saved In
process order associations within the caller's authorized scope, not unrestricted
master directories. Selected saved labels are retained while searching or paging.
The browser requests one section at a time.

Listings use bounded offset pagination (1–100 records), at most 20,000 candidate
orders and 50,000 candidate ledger entries. Exceeding a bound is an explicit
narrow-the-filters error, never a partial total. Payments and patients do not
multiply order rows. The UI refreshes on mount, explicit refresh, focus and a
finite one-minute refresh interval, paused while a transaction draft is open.

## Posting, concurrency and retry safety

The authenticated MR selects payable rows on the **current page** only. Selection
clears on Apply/Reset, page and page-size changes. A common calendar date and
payment mode accompany a separate positive INR amount for each selected order.
The confirmation shows the exact aggregate. Inputs remain raw until validation;
negative signs or other invalid characters are never silently stripped into a
different amount.

The API revalidates identity, active saved MR and its existing assignment policy;
derives creator/MR itself; and denies Admin writes independently of the UI.
Policy/identity/assignment locks precede a separate settlement advisory lock.
Order rows are locked in a consistent type/ID order. Every selected order must
still belong to the MR, be In process, have the expected version and recorded
paid sum, have an authoritative saved total, and have enough balance. Duplicate
type-qualified orders, excess decimal precision, zero/negative amounts,
overpayment and stale facts reject the entire batch. Nothing changes the source
order's payment flags or approval/shipment state.

Batches, allocations and rejected request outcomes are committed atomically.
Financial documents use directory encryption keys with a dedicated settlements
AAD namespace. Operational references, payment dates, creation time and actor/MR
IDs remain queryable; amount, mode and submitted request data are encrypted.
The idempotency UUID is the immutable batch/outcome identity. Replays require
the same actor, saved MR assignment and exact normalized body. Committed replies
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

## API

All paths below are under `/api/v1/admin/settlements`; both authorized portals
use the same independently protected service:

- `GET ""`: combined filters and one bounded page with exact financial history.
- `GET /references/{doctors|mrs|patients}`: bounded saved-order selector choices.
- `POST /transactions`: common date/mode and explicit per-order allocations,
  expected source versions/paid amounts and one immutable idempotency key.
- `GET /requests/{key}`: owner/MR-bound committed, durably rejected or absent
  outcome. No unrestricted batch lookup.
- `GET /history/{kind}/{identity}`: protected order history independent of its
  later lifecycle. History remains stored even after it leaves the default
  In process listing. MR access always checks current order ownership.

The FastAPI schemas and exported OpenAPI/generated clients include these
contracts. Monetary values are strings and browser aggregates use BigInt paise.

## Schema and operational handoff

Additive `0077_settlements` follows the actual `0076_in_house_stock` head. It
creates empty `settlement_batches`, `settlement_entries` and
`settlement_rejections`, indexes, immutable triggers and a type-qualified source
reference guard. The development declaration, automatic migration classification,
generated source-integrity manifest, ORM registration, account compatibility and
readiness probes have been updated. Readiness inherits every predecessor probe.

**No migration was executed during this work.** Development still needs the
normal explicitly authorized schema synchronization/API restart before these
endpoints are usable. Running the pre-existing merge/startup automation later
can apply automatic development migrations; it was not invoked here.

No production schema was activated or deployed. Production fresh-install/catalog
evidence remains pinned to the previously observed head; no passing catalog
fingerprint, release evidence or production approval has been invented.
Production preparation requires separate authorization and genuine evidence.

Retain the directory decryption keys used by settlement documents. Existing
directory rotation tooling intentionally fails closed on the new schema rather
than claiming to rotate or retire keys for immutable settlement documents.
Ledger-aware key rotation/retirement needs separately reviewed maintenance
support; do not bypass append-only triggers or drop old keys.

## Verification performed and explicitly not performed

Performed only offline contract/metadata generation, generated-library TypeScript
compilation, Python source parsing, JavaScript/JSX syntax transformation and
static contract/caller inspection. Existing API paths and schema components were
compared structurally during generation; only settlement contracts were added.

**Not run:** regression suites, release checks, release workflows, API/database
integration tests, browser transaction tests, schema activation, service/workflow
restarts or production activation. Static evidence does not establish runtime
authorization, concurrent-post, migration or browser correctness. These checks
must not be run without later user approval.

An unauthenticated screenshot attempt could not load the existing preview
ingress. No workflow was started/restarted to repair it, because that could
implicitly activate schema changes or release workflows. The protected
settlement screens therefore have not been visually verified in this workspace.

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
