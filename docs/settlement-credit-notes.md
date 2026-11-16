# Settlement credit notes — prepared source only

## Authority and meaning

Only the authenticated, revalidated protected Super Admin creates/reverts credit
notes and uses the Credit Notes destination immediately below Settlements.
Ordinary staff and Doctors have no access. An owning MR sees read-only evidence
inside their existing Accounts order history, under the existing saved-order
ownership boundary, with Doctor contacts masked. There is no MR credit-note
destination or MR mutation permission.

Credits are **not money received**. The authoritative position is saved total
minus recorded cash allocations minus active credit notes. Original order
totals, taxes, receipts and per-receipt verification remain unchanged. Reverted
notes remain in history but no longer reduce balances. Legacy payment flags are
not receipts or credits.

Accounts shows Total, Paid, Credited and Balance separately. A zero-balance
position containing credit is labelled Settled, not cash Paid. The Kits saved
read projection includes ledger cash and credit figures separately from its
legacy flags. Financial reviews include target credits and bind their token to
the MR's retained note/reversal membership, so an intervening credit/reversal
invalidates an earlier review even if the eventual net credit is unchanged.
MR exposure and Doctor overdue obligations use the same credit-adjusted
position, retaining the original saved order dates for aging. Repricing below
cash plus active credits is rejected even for Admin or disabled MR limits.
Stock, fulfillment, achievement, historical payment flags and sales accounting
are not rewritten.

## Number and invoice reference

The visible number is `CN/{IMT|KIT|SPT|LPN}/{YY-YY}/{integer}`. The financial-year
pair uses the actual credit-issue date in Asia/Kolkata, April through March.
One dedicated PostgreSQL bigint sequence increases across types/years, starting
at one. No reset, padding or example-derived opening value is introduced.
Failed transactions may leave sequence gaps; reversed numbers are never reused.
Order UUIDs and existing order numbers are unchanged.

Source inspection found no authoritative issued invoice-number field.
`saved_invoice` therefore explicitly returns no authority; it never derives an
invoice number from an order number or Settings template. The dialog requires
an explicit saved invoice reference such as `024-25/00051002`, preserved
independently in the encrypted note. It accepts a two-to-four-digit year,
hyphen, two digits, slash and one-to-twenty-digit order suffix, preserving zeroes.
The read-only-authority branch is ready for a future explicitly integrated
authority, but this change does not issue invoices or designate arbitrary
snapshot keys as authoritative.

## Persistence and concurrency

Prepared migration `0112_settlement_credits` follows the declared
`0110_retire_legacy_pricing` path and adds three initially empty tables:

- `settlement_credit_notes`: immutable note/context, actor, issue date and
  dedicated sequence identity.
- `settlement_credit_reversals`: one immutable reversal per original note.
- `settlement_credit_requests`: actor-bound frozen requests and their durable
  successful or rejected outcomes.

`0113_credits_staged_merge` is a DDL-free source graph join. It is not the
development target and does not activate unrelated staged branches.
The coordinated declaration and offline source-integrity metadata are prepared.
No historical migration is edited and no financial backfill is performed.
Production fresh-install catalog evidence is not fabricated or advanced.

The new tables use Directory-key AES-GCM envelopes with distinct settlement AAD
domains `credit_notes`, `credit_reversals`, `credit_requests`. Amounts, visible
number, invoice reference and saved Doctor/MR/order labels are encrypted.
Operational UUID associations, issue date, actor, sequence and timestamps remain
queryable metadata. Database guards prohibit update/delete and require a
protected Super Admin insertion actor; note insertion validates the polymorphic
saved-order/MR association.

Offline key inventory authenticates/counts these immutable archives, including
original key usage; it does not rewrite them in mutable rotation batches.
**Keep original Directory decryption keys** while any retained note/reversal/
request uses them. Historical encryption staging inventories remain unchanged.
Successor readiness and account/Directory maintenance retain predecessor probes
and explicitly recognize only the two new revisions.

Creation, payment posting and reversal serialize under the existing financial
advisory transaction lock, after fresh identity validation and before source
row locks. Creation additionally checks order version, recorded paid and active
credited snapshots. Payments also compare expected credited totals and cannot
allocate above the live credit-adjusted balance. Unknown totals, unreadable
evidence and over-settlement fail closed.

Reversal reads the current position atomically: partial cash payment does not
block it; zero credit-adjusted remaining balance does. Reversal never deletes a
note or changes a payment. Mutations append audit evidence.

The API retains an exact request with the caller's idempotency key. Domain
rejections are saved after rolling back the attempted mutation savepoint.
Replays require the same actor, operation and exact body; note/reversal/request
commit together. Reconciliation absence is not cancellation. The UI freezes the
body and key on submission, blocks dismissal while pending/uncertain, and offers
status reconciliation and exact retry only. Only a durable rejection unlocks a
fresh submission. Browser close/reload can show the native unsaved-work warning,
not a replacement platform modal or an absolute guarantee against tab closure.

## APIs and bounded reads

All paths are below `/api/v1/admin/settlements`:

- `GET/POST /credit-notes`
- `GET /credit-notes/{identity}`
- `POST /credit-notes/{identity}/revert`
- `GET /credit-requests/{key}`

List filters are inclusive credit date From/To, MR and literal case-insensitive
search over displayed note/invoice/order/person labels, with offset/limit pages.
Encrypted search has a 20,000-candidate bound; over-bound reads reject instead
of truncating counts. Payment and credit histories are independently bounded.
The Super Admin page retains Active and Reverted statuses, provides explicit
loading/empty/unavailable/retry states and keeps its table horizontally
scrollable on narrow screens. Owning MR evidence remains in existing Accounts.

## Delivery limits

This is prepared source, not runtime/schema activation evidence. Only source/
diff inspection, offline FastAPI contract export, direct Orval generation,
scoped generated-declaration retention, generated-source formatting and offline
source-integrity generation were performed. The public package codegen wrapper
was not used because it chains typechecking.

**No tests, regression/release suites, builds, typechecks, completion-validation
wrappers, browser/runtime probes, managed service restoration/restarts, live
migrations, live financial writes, production access or deployment were run.**
The supplied screenshot was not available in this task checkout; the requested
information columns were adapted to existing EVEXIA components without importing
example data. Visual layout, database DDL/guards, concurrency, encryption round
trips and authenticated end-to-end behavior remain unverified.

Out of scope: invoice issuance, refunds, cash payouts, wallets/transfers,
payment deletion/reversal or verification changes, PDF/print/export, tax
adjustment documents, notifications and historical note imports.
