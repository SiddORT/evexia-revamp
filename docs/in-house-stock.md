# Expiry and actual manufacturing cost

The expiry extension preserves separate reserve balances and approved dilution
rules. Expiry-today reserves cannot be transferred or diluted. New entries may
capture documented manufacturing cost; diluted outputs inherit source cost
divided by their approved factor. Disposal consumes only remaining expired
reserve stock and keeps immutable history. See
[allergen-expiry-disposal.md](allergen-expiry-disposal.md). This work was
source-only: no migrations, services, runtime probes or verification ran.

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
places. Current entry forms explicitly label quantity in ml and omit the unit
field; the blank saved unit means this entry contract's ml. Historical explicit
descriptive units (40 characters) remain unchanged. No free-text unit conversion
or equivalence to purchased stock is inferred.

Expiry is an explicit valid calendar date, never derived. Past dates are
accepted, retained and clearly marked Expired using the server's UTC calendar
day; expiry day itself is inclusive. Batch/reference (100 characters) and notes
(2000 characters) are optional.

Reserve creation still writes only its own record/request tables and an audit
event. It never creates inventory. A reserve identifier is not a lot identifier.
Only the separately reviewed movement workflow below can consume a reserve.
Saved reserve entries cannot be edited or deleted.

## Reviewed movement and dilution

Move Stocks includes available reserve batches only for the protected Super
Admin, with existing movement-create authorization also required. No new
assignable Staff permission is added. Every reserve line requires an explicit
Yes or No dilution choice. No preserves quantity, concentration, expiry and
reserve classification at the destination, including legacy descriptive values.
It cannot make concentrate order-ready or selectable for assembly/adjustment.

Yes permits exactly **2-fold, 5-fold or 10-fold**. Source input ml is consumed;
destination output ml = input × factor, and output concentration = input concentration
÷ factor. **100 ml at 5, 5-fold → 500 ml at 1; 10-fold → 1000 ml at 0.5**,
without inventing a concentration unit. Explicit percentages remain compatible:
**10 ml at 10%, 10-fold → 100 ml at 1%**. Resulting expiry is movement
date plus two calendar years, clamping February 29 to February 28 when necessary;
it is neither based on nor capped by original expiry. The original reserve
snapshot is not rewritten.

Dilution accepts only blank-unit current ml entries or explicit `ml`, and plain
positive plain numeric strings with up to three integer digits and six fractional
digits, optionally suffixed with `%`. Only explicit percentages are capped at
100%; output preserves the presence or absence of that suffix.
Legacy ratios, text, other units and arbitrary factors are rejected with an
actionable error. Quantities must be exactly representable at 0.001 and no more
than 1000000; resulting concentration must be exactly representable at six
decimals. No silent rounding, catalogue concentration edit, clinical advice,
diluent recipe, pricing change or automatic backfill occurs.

The server review binds actor, source/destination snapshots, movement date,
batch identity, exact quantities and current source/destination balances.
The modal shows input/output, concentration and expiry before confirmation.
Dismissal returns to the retained draft without writing; changed values or
balances require another review. Only confirmation writes stock.

Selected reserve rows expose a **Configure reserve** icon rather than inline
quantity/dilution inputs. Its separate dialog requires source input and an
explicit Yes/No decision, offers only the approved factors and calculates exact
draft output. Apply updates the draft; Cancel, Escape or dismissal discard only
unapplied dialog edits. Reopening starts from applied values, with focus returned
to the icon. Configuration never writes stock or bypasses authoritative review.

The **Move stock** row icon in In-house Stock opens the existing form with only
an opaque reserve identifier in the query string. The form re-reads that exact
reserve, its current per-location balances, active location choices and source
lots. One current accessible source is preselected; multiple sources require
explicit selection. Current available input is an editable default. Missing,
depleted, inaccessible or stale reserves never fall back to another batch.
Destination, delivered-by and dilution stay unset. Loading disables edits to
avoid overwriting them; changing source cancels outstanding preselection.
A pending movement recovery prevents shortcut application and keeps the
existing owner-bound recovery identity intact.

Focused workflow verification uses disposable data only. Exact arithmetic and
shortcut guards can be checked with:

```sh
node --test artifacts/evexia-portal/src/services/reserveDilution.test.js \
  artifacts/evexia-portal/src/services/reserveShortcut.test.js
sh scripts/test-reserve-movements.sh
```

The shortcut checks include pending recovery before reads and while detail or
location responses are held, cancellation of late responses, explicit split
source options and no fallback for invalid/depleted/inaccessible reserves.
The focused browser journey covers apply/cancel/reopen, keyboard trapping and
focus return, 390px modal layout, server review before any write, final save,
direct versus prefilled entry and split/depleted/missing reserve states.
These checks do not authorize broad release checks or real stock mutations.

`0078_reserve_movements` follows `0077_settlements` under the existing automatic
migration policy. Append-only `in_house_postings` records per-location reserve
debits/credits. Remaining availability is original quantity plus these postings,
never an inventory balance; both original quantity and remaining location
balances are shown. Dilution creates one distinct immutable inventory lot per
movement/reserve with `reserve_movement_id`, encrypted reserve/batch/movement
provenance, resulting concentration and expiry. It is not a second reserve.
Subsequent ordinary transfers retain the lot identity and metadata without
performing another conversion. Stock Status labels concentrations batch-specific
and shows each lot's actual concentration, expiry, unit and origin. Historical
concentrations absent from saved evidence display unavailable, not today's
catalogue concentration.

Mixed operations always acquire the inventory lock before the reserve lock and
before location row locks. Reserve-only entry/reads use the reserve lock alone.
Movement, reserve postings, converted lot/balance/posting, audit and actor-bound
durable retry outcome commit atomically. Existing movement reconciliation shares
the lock and durably cancels absent identities, preventing delayed originals from
committing after a negative outcome. Failed commits have no partial stock effects.
Raw-reserve movements and historical reference choices remain protected from Staff.

New encrypted descriptions use existing `inventory:movement`, `inventory:lot`
and `inventory:retry` purposes under independent PR keys. No new plaintext
descriptive columns or encryption purpose is introduced. Reserve postings expose
only operational IDs and exact quantities. Historical encryption inventories are
unchanged; key rotation must retain these existing purposes and original keys.

Focused verification: `sh scripts/test-reserve-movements.sh` uses a private
synthetic PostgreSQL database and runs only new reserve movement cases. Browser
presentation checks use `scripts/start-in-house-stock-crud-preview.sh` against a
separate synthetic fixture, not the bound development or production database.

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
