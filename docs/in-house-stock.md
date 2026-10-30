# In-house allergen concentrate reserves

Inventory > **In-house Stock** is a separate server-backed append-only reserve
for the protected singleton Super Admin. Existing Staff Stock Status, Allergen
Master or Opening Stock grants do not grant reserve access. No new assignable
capability or default grant is introduced.

## Boundary

Entries reference an existing active allergen and active Storage Location.
Concentration is required independent descriptive text (200 characters), not a
copy of catalogue concentration or a conversion formula. Quantity is a required
plain decimal string, positive through 1000000, at most three fractional digits;
validation occurs before persistence. The canonical representation has three
places. An explicit descriptive unit (40 characters) is required. No implicit
equivalence to purchased or order-ready units is asserted.

Expiry is an explicit valid calendar date, never derived. Past dates are
accepted, retained and clearly marked Expired using the server's UTC calendar
day; expiry day itself is inclusive. Batch/reference (100 characters) and notes
(2000 characters) are optional.

No ordinary inventory source type is added. Reserve creation writes only its
own record/request tables and one audit event in one transaction. It does not
write purchased stock, lots, balances, postings, alerts, movements, assembly or
order availability. A reserve identifier is not an inventory lot identifier.
Dilution, consumption, release into usable inventory, edits, deletion, imports,
exports and corrections are deliberately absent.

## Persistence, privacy and concurrency

Forward `0076_in_house_stock` follows `0075_shipments` under the automatic
migration policy. It creates `in_house_stock` and `in_house_stock_requests`;
there are no existing-stock rewrites. Committed reserve snapshots and durable
request outcomes reject SQL UPDATE/DELETE via database triggers.

Encrypted reserve payloads retain allergen/category/location identifiers and
names, reference versions, independently entered concentration, exact quantity
and unit, expiry, batch, notes and recorded actor/time. Catalogue edits never
rewrite these snapshots. Reference versions and names are rechecked while
locked during commit; changed reviews must be explicitly repeated.

Encryption uses the existing independently configured PR keyring through
InventoryCrypto with distinct purpose AAD:

| Table / column | InventoryCrypto purpose | Contents |
| --- | --- | --- |
| in_house_stock.payload_ciphertext | in_house_reserve | Full immutable canonical snapshot |
| in_house_stock_requests.payload_ciphertext | in_house_retry | Saved snapshot or encrypted null cancellation |

AAD uses `inventory:` plus those purpose names under the existing PR AES-GCM
envelope. Review/request HMACs have separate `in-house-review:v1` /
`in-house-request:v1` namespaces. Review tokens are actor-bound. UUIDs, actor/audit
links, creation timestamps, request keys and digests remain operational plaintext.
Do not remove old PR decryption keys while retained reserve/request ciphertext
still uses them. No historical encryption staging/retirement inventory is
changed. The immutable payload policy means key retirement needs a separately
reviewed maintenance design, not an ordinary application update.

Creation and reconciliation share a dedicated transaction advisory lock.
Concurrent same-key creates return the same saved record; conflicting reuse is
rejected. Reconciliation of an absent key durably records cancellation under
that same lock, so a delayed original request cannot subsequently commit.
Successful retries do not re-read mutable catalogue values.

The browser journals only an owner-bound opaque request key, never the draft.
Web Locks serialize journal changes across tabs; failures are fail-closed.
Any unconfirmed save blocks new saves until explicit outcome reconciliation.
Form values and the frozen reviewed request survive recoverable errors and
same-identity session renewal. Leaving/reloading can discard an unsaved draft,
but the journal remains available on the dedicated list for outcome recovery.

## API and finite reads

All endpoints are under `/api/v1/admin/in-house-stock`, reauthenticate the
protected Super Admin in the service transaction, and use the existing
authenticated portal transport:

- `GET /` — search saved identity/category, concentration, unit, batch, location,
  expiry or actor; bounded offset/limit pagination.
- `GET /{id}` — saved immutable details and current expiry status.
- `GET /references/allergens` and `/references/locations` — consumer-scoped
  active choices, server paging and literal name search.
- `POST /preview` — canonical snapshot and review token, no stock write.
- `POST /` — reviewed atomic create with owner-bound idempotency key.
- `GET /requests/{key}` — terminal committed/cancelled reconciliation.

Encrypted listing deliberately scans at most 2000 reserve entries, failing
explicitly rather than returning partial counts. Above that finite bound,
growing the reserve requires a separately reviewed bounded encrypted search
design; narrowing the query does not bypass the global bound.

## Verification scope

Only disposable synthetic data is used. No original-development or production
stock/data mutations, deployments or live migrations were performed.

Before the user's narrower verification instruction, the new-feature API checks
and contract code generation were run; initial feature checks exposed assertion
issues and a missing current-schema encryption allowlist, then were fixed.
After the instruction, only the new feature's targeted CRUD cases and browser
CRUD/responsiveness are allowed. Do not run regression/release suites or
completion validation commands for this delivery.

The targeted API CRUD command is:

    sh scripts/start-in-house-stock-crud-preview.sh --api-crud

Observed result: 15 new-feature API CRUD/validation/authorization cases passed.
The focused Chromium browser pass verified add/review, independent concentration,
precision errors with retained drafts, search/details/reload, keyboard reference
selection and one committed record after a deliberately dropped save response.
Desktop 1440px and mobile 390px light/dark screens had no document-level
horizontal overflow; the list keeps its own horizontal table scrolling.
The mobile dialog fit the viewport with focus inside; form actions remained
reachable by vertical scrolling. The pass found a stale unknown-outcome warning
after committed reconciliation; it was cleared in the terminal-success branch
and confirmed by source inspection, not by repeating the save journey.
Firefox, WebKit/native Safari, concurrency and rollback execution were not
repeated after the user's narrower instruction. No regression/release run is
claimed.

The optional separate browser fixture is:

    sh scripts/start-in-house-stock-crud-preview.sh

It creates a private socket-only PostgreSQL database and isolated listeners,
uses synthetic keys/account details, runs no test suites automatically and
removes its database/files on exit. Its explicit `--api-crud` mode names only
new-feature create/read/validation/authorization cases. Other reserve tests
cover atomicity and concurrent retries but are not part of that narrow mode.
