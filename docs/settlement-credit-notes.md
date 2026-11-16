# Settlement credit notes

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

New credits now require a persisted, server-generated order invoice reference.
The Add credit note dialog displays it as non-editable **Invoice number** text and
repeats the same saved value in confirmation. Opening the dialog first loads a
fresh authenticated settlement row; an unsuccessful read cannot fall back to
the listing's stale row. A mounted editor's reviewed/frozen submission remains
unchanged. There is no manual-entry fallback. Missing or
unreadable authority is shown as **Unavailable** and blocks Review. Amount drafts,
current financial eligibility and uncertain-submission freezing are unchanged.

The first successful explicit approval into In process saves the reference in
the same encrypted order snapshot/transaction as the approval, for Immunotherapy,
Kits, SPT and Lupin. Format: `YYYY-YY/numeric-order-portion`, using the saved
order date's April–March financial year. For example, a saved `IT-00051002` dated
2024-04-01 produces `2024-25/00051002`; the same number dated 2024-03-31 produces
`2023-24/00051002`. These are illustrations, not a sequence seed or new numbering.
No product prefix is appended and all existing numeric leading zeroes survive.
The same reference text may occur in different families: kind plus immutable
order UUID, not the text alone, identifies its authority.

`order_invoice_references` validates the authenticated `invoiceAuthority` object
against its source kind, UUID, saved number and saved date before Accounts exposes
`invoiceReference`. The object has a versioned schema, original date/number basis,
reference, provenance, recording timestamp and (prospectively only) approval
version. Rejection and failed/rolled-back approval save no new authority. Existing
decision locks, expected versions and idempotency records serialize concurrent
decisions and retries. General order/import inputs cannot submit this object.
All four ordinary writers copy it from the locked raw snapshot without repair;
normal order projections/transfers omit it. Fulfillment mutates the existing
snapshot and retains it. No general update can substitute a reference.

The existing API wire shapes are retained: SettlementRecord.invoiceReference is
a nullable string; CreditInput.invoice_reference remains the required frozen
confirmation echo, **not** a manual override. Creation requires readable server
authority and exact equality with that echo, then stores the server value.
The client distinguishes the new four-digit-year saved authority from the wider
historical note grammar. Existing immutable credit notes keep their original
references verbatim, including manually entered two/three-digit years. Their
reads, exact request replays, reconciliation and reversals do not require current
invoice authority or revalidate historical text against a new order reference.
No new API field, generated type or validator shape was needed.

See `docs/order-invoice-references.md` for the historical adoption procedure,
actual authorized development adoption counts and remaining verification limits.
This reference authority is not an
invoice PDF, legal/tax certification, financial recalculation or Settings change.

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

The original credit-notes implementation was prepared source, not runtime/schema
activation evidence. Only source/
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

The subsequent authorized invoice-number-only development adoption is documented
in `docs/order-invoice-references.md`. That operation did not create or reverse
any credit/cash transactions and did not run the checks or activation steps
excluded above. The new dialog wording and fresh-read behavior were inspected
in source only, not observed in a browser.

Out of scope: invoice issuance, refunds, cash payouts, wallets/transfers,
payment deletion/reversal or verification changes, PDF/print/export, tax
adjustment documents, notifications and historical note imports.
