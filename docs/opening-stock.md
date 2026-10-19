# Opening Stock Master

## Scope

Opening Stock records pre-system **physical inventory**, not Doctor financial
opening balances. Protected Super Admin only; no new Staff or MR grants.
Products & Supply, Masters and the authenticated import tabs all link to the
server-backed master. There is no browser-local stock store or demo import.

Opening records are append-only initialization, not general adjustments.
Review/cancel before commit is supported. There is no edit/delete/reversal
endpoint or control. Distinct intentional openings use new explicitly reviewed
source/row identities. Equal names, locations and rates never deduplicate rows.

Eligible item identity is `(allergen|combo, catalogue UUID)`. Allergens use
procurement quantity units with exact three-place quantities; finished products
use whole combos. Each row is bounded at 1,000,000. Unit rate is separately
entered, nonnegative, at most twelve integer and six source fractional places,
rounded half-up to two places, at most 999999999999.99 after rounding. Selling
price and MRP are never defaults. Backend inputs/outputs are decimal strings;
Python Decimal/PostgreSQL unconstrained NUMERIC and browser BigInt preserve
exactness. Opening value means **original quantity × retained rounded unit
rate**, represented exactly to five places, not revenue, current valuation,
FIFO or weighted average costing.

## One ledger and Unallocated

`0050_opening_stock` follows the actual reconciled
`0049_product_language_merge` head. It adds encrypted opening records and request
outcomes, and a nullable opening source on the existing inventory lots. It does
not edit applied migrations, rewrite existing sources, seed stock or fabricate
receipts, batches, expiries, recipes or past assembly events. Opening finished
products credits one product lot without debiting any component.

Blank location is SQL NULL, visibly **Unallocated**, never a fake Storage Location.
Balances now have a surrogate UUID identity and a NULLS NOT DISTINCT unique
lot/location index. Existing balances retain their quantities/relationships.
This permits safely updating the real NULL bucket without an ORM NULL primary
key. Original source location and posting location are nullable only for this
meaning; receipt and assembly source checks still require a real location.

Stock Status totals include Unallocated, with `unallocatedQuantity` and distinct
lot/location rows. Move Stocks explicitly selects Unallocated, reviews current
available lots and allocates to an active real location with paired postings.
Located opening lots transfer normally; original source/rate snapshots remain.
All stock writers still take the User/session locks then the shared inventory
advisory lock. Opening records, retries and opening lots are immutable; postings
and movement history retain existing database guards.

Location-specific assembly cannot select Unallocated quantities. Opening lots
also have unavailable expiry, so the existing assembly expiry guard refuses them
as components even after allocation. No new expiry-assignment or clinical policy
is introduced here.

## Review, commit, retries and history

All routes are under `/api/v1/admin/opening-stock`:

| Route | Purpose |
| --- | --- |
| `GET /` | Search/page with whole-authorized-match summary |
| `GET /references/items` | Bounded active typed item choices |
| `POST /preview` | Authoritative row/reference snapshots, totals and review token |
| `POST /` | Explicit reviewed atomic commit for manual or imported rows |
| `GET /requests/{key}` | Actor-bound committed outcome or durable absent-key cancellation |
| `GET /{id}` | Original retained opening and original posting balances |
| `GET /{id}/activity` | Transactional saving actor/time/correlation |
| `GET /{id}/analytics` | Opening-only item/unit/original-location breakdown |
| `GET /sample`, `GET /export` | Authenticated CSV/XLSX releases with durable download acceptance |
| `POST /import/review` | Bounded raw or multipart inert file review |

Every commit revalidates the actor, live references, precision, review token and
durable source/row uniqueness inside the shared stock transaction. New lots,
credits, opening snapshots, activity, successful AuditEvents and encrypted retry
outcomes commit together. Failed/denied requests use existing body-free safe
operational logging. Safe report labels and browser page/action metadata are
registered separately; browser reports are not authoritative business history.

An identical request returns its stored result. A changed command or another
actor cannot reuse the key. An absent-key outcome check serializes with writers
and durably closes the identity before returning not committed, blocking late
original requests. The portal persists only opaque owner-bound recovery keys
under Web Locks, keeps drafts/files/reviews mounted on recoverable errors and
renewal, and requires explicit outcome reconciliation before another save.

The opening drawer shows original quantity/rate/location, saving actor, original
before/after, unavailable historical fields, activity and scoped opening totals.
Move Stocks drawers carry opening provenance and allocation balances rather than
forcing receipt metadata. Native dialog behavior supplies modal focus/Escape;
closing returns focus to the initiating Actions control.

## Portable transfers

The sample contains the current eligible catalogue, stable item kind/UUID,
readable names/units, new source/row UUIDs and blank quantity/rate/location.
The import page provides a paged searchable active location UUID/name guide.
Optional location may be an active UUID or exact unambiguous active name; supplied
ID/name pairs must agree. Catalogue metadata does not initialize a location.

Untouched rows skip. Partially filled rows get row-specific errors. Positive
quantities require an explicit rate (zero is a rate); explicit zero quantity
creates no posting. Repeated source/row identities are errors before posting.
One recorded date is supported per new import operation; blank dates mean the
UTC review date. Original backup dates remain retained, never overwritten.

Files are limited to 2 MiB/1,000 data rows/12 columns/10,000 characters per cell.
Raw uploads and one-field multipart uploads share the existing bounded master
reader, including 64 KiB overhead and a 15-second read limit. XLSX uses existing
archive/XML/link/formula guards followed by original numeric XML lexemes for
quantity/rate, never the spreadsheet parser's float. Text cells are recommended.
CSV text uses reversible formula-safe escaping; all XLSX exports use text cells.

Review reports ready/skipped/already-imported/error counts and compatible totals.
Confirmation is all-or-nothing. Durable `(source UUID, row UUID)` identities
survive request retries, re-upload and export/re-import. Already-committed rows
return already imported without stock/audit duplication; changed values on an
existing identity conflict. This is not name-based deduplication. To intentionally
add more stock, use Add with a fresh explicitly reviewed operation.

Exports contain every authorized search match or refuse at 1,000 records/2 MiB;
they never use only the table page. Catalogue/saved-record decrypt scans also
have the shared finite 2,000-record bound and fail explicitly above it.

## Encryption and automatic lifecycle

Opening records and retry results reuse the independent PR keyring with new
forward AAD purposes `inventory:opening` and `inventory:opening_retry`.
Existing lot/movement ciphertext retains `inventory:lot`/`inventory:movement`.
Item labels, rates, original location details, actor label and source snapshots
stay encrypted. Plaintext operational UUID relationships, event/time, lot
accepted quantity, balance and posting quantities remain available for integrity.
Durable source/row UUIDs expose retry/source grouping, not authored stock data.

Forward PR rotation/retirement planning must cover opening records, opening retry
results, lot and movement snapshots **as well as** receipts, batch settings,
product recipes/assemblies and existing retry histories. Old keys remain required
until all retained ciphertext and outstanding review fingerprints are covered by
a separately reviewed rotation respecting immutable history. No key change,
rotation execution or historical encryption inventory rewrite is included.

The canonical development declaration, generated API requirement and refreshed
integrity/release/catalog metadata target **0050_opening_stock**. Automatic
startup/post-merge migration policy remains unchanged. The existing explicit
receipt-initialization tool recognizes this exact reviewed successor, but was
not run; its target, recovery, writer-exclusion and review safeguards remain.

### Verification and runtime handoff

Focused command: `sh scripts/test-opening-stock-operations.sh`.
It runs only `tests/test_opening_stock_operations.py` in a private-socket
disposable PostgreSQL cluster with synthetic independent configuration. First
pass: **6 passed**, one existing Starlette TestClient deprecation warning.
Coverage includes allergen/product openings, Unallocated/located stock,
allocation/transfer and retained evidence, exact rounding/value, no component
debits, current catalogue CSV sample, filled CSV/XLSX imports, backup round-trips,
untouched/zero rows, repeated commits/files/source identities, precision and
reference errors, actor restrictions, append-only guards, atomic rollback after
injected posting failure, details/activity/analytics and readiness.
The six core checks passed again after adding blank XLSX catalogue review.
A separate focused upload-boundary operation also passed: authenticated raw
`application/octet-stream` and multipart reviews accept valid 1.1 MB and exact
2 MiB files, reject a one-byte excess, and leave stock unchanged. An ingress
allowance was added specifically for this route; ordinary JSON limits remain
unchanged. Twenty changed portal JS/JSX files parsed successfully; OpenAPI/client
generation completed without invoking the excluded builds or validation suites.

The same disposable PostgreSQL **17.5** instance independently supplied the real
complete 61-table successor catalog digest
`4c4ca127733ed564425c9c2c7274ccfc180fa0708feac6a4cb9bceae89c0d37c`
at `2026-10-19T10:45:11.121064+00:00`. The collector is
`app/services/fresh_catalog.py`; local ignored observation/projection files are
under `generated-artifacts/opening-stock/`. This is schema observation, **not**
successful installer execution, original-target recovery, CI or live acceptance.

No regression/release/default/broad/development-validation or browser automation
suite was run. No original database migration, receipt initialization, production
deployment/VPS access, replacement keys or historical-guard bypass occurred.
Authenticated screen layout, keyboard behavior, enlargement and real browser file
handoff remain unverified; frontend source parsing is not browser evidence.

**After merge, main owns automatic synchronization and managed API restart.**
Read actual intended-development `alembic_version`, running `/api/v1/version`,
`/api/v1/health/readiness` and served frontend `/release-runtime.json`.
All database/API/frontend declarations must equal **0050_opening_stock** and
readiness must return 200 with the intended running source identity. Record
those actual observations. This fork must not migrate the original database or
present disposable/source agreement as that final live acceptance.

Actual read-only development observation on **2026-10-19 at
10:49:08.997908 UTC**: configured database `alembic_version` was
**0049_product_language_merge**. The API workflow was not started, and routed
`/api/v1/version` and `/api/v1/health/readiness` returned **502**, not readiness.
After the frontend-only restart, routed `/release-runtime.json` returned **200**
and declared **0050_opening_stock**. The static protected-route capture reached
the portal-lookup error caused by the unavailable API; it did not render or
verify the authenticated master. The normal API startup was deliberately not
run because it invokes automatic database synchronization against the original
configured target. **Live three-way alignment and activation remain unverified
and are not claimed as complete.**
