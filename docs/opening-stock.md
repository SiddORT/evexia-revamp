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
It runs `tests/test_opening_stock_operations.py` and
`tests/test_opening_stock_concurrency.py` in a private-socket disposable
PostgreSQL cluster with synthetic independent configuration. It is explicit-only:
no default release manifest, validation registration or workflow was extended.
Future release integration requires separate explicit authorization.

#### Concurrent retry regression checks

The concurrency module uses a freshly migrated, separately named disposable
database and newly bootstrapped synthetic protected actor for **each case**.
The singleton Super Admin policy remains intact: contenders intentionally share
that case's actor/session, not identities from another test or preview.
HTTP setup/review/reconciliation/replay uses in-process TestClient transport
(no TCP listener). Workers use independent committed SQLAlchemy connections,
not the functional fixture's rollback-only Session or shared savepoints.
The fixture refuses configured/network databases and requires the explicit
test harness's private `/tmp/evexia-api-test.*` socket and test environment.
Databases are dropped on teardown; no original development migration or
application workflow restart is part of this command.

The first contender pauses **after acquiring the real inventory advisory lock**,
while the second starts its normal authorized transaction. An independent
observer requires `pg_blocking_pids` to identify the first transaction as the
second's actual blocker before releasing it. The existing User/session →
inventory → reference lock order is not replaced. Polling and worker waits have
bounded deadlines; no sleep is taken as evidence that a race occurred.

Coverage:

- Concurrent identical-key manual and import commits, each with both Unallocated
  and located rows: identical durable results, one request result, one opening
  credit and one successful saving AuditEvent per durable source/row.
- Separate CSV/XLSX reviews of the same durable rows with different request keys:
  one commits, the stale review conflicts, its absent key is durably closed,
  and an explicit fresh review returns already imported without new credits,
  records or success AuditEvents. No silent stale-review acceptance is expected.
- Absent-key reconciliation winning against a delayed writer: durable
  `not_committed`, closed-key rejection and no stock or saving AuditEvents.
  The reverse ordering returns the writer's committed outcome, never a false
  negative or a cancellation overwriting success.
- Competing Unallocated allocations to different destinations whose combined
  demand exceeds available stock: one succeeds, the other conflicts; replay of
  the winner creates no second movement or successful allocation AuditEvent.

Assertions reconcile each lot's exact balance against its postings (including
the SQL NULL location), conserve the original accepted quantity, require
nonnegative historical/current balances and exactly paired movement postings,
and compare original source/rate/location/value snapshots. Allocation additionally
requires original opening and lot ciphertext to remain byte-for-byte unchanged.
Raw service retry results are compared exactly; HTTP comparisons use the existing
response models' canonical datetime/provenance representation.

The focused command passed **13 checks** (seven existing operations checks and
six concurrency cases). Existing Starlette TestClient and Alembic configuration
deprecation warnings remain. No browser automation, live acceptance,
permission/expiry/opening-adjustment change or production activation is claimed.

The subsequent automatic completion gate ran the existing configured non-browser
release checks and did **not** pass. Its failures were outside the new tests:
`python3 -B scripts/local-release-checks.py run services` rejected the existing
Opening Stock currency formatter in the date-display guard;
`python3 -B scripts/local-release-checks.py run api-sales-targets` expected an
older downgrade-refusal message rather than the Opening Stock recovery guard;
`python3 -B scripts/local-release-checks.py run policy-03` expected a table
inventory without `opening_stock` and `opening_stock_requests`.
Those checks were not weakened or changed in this concurrency-only work.
The focused pass is not evidence that this broader completion gate passed.

#### Original implementation verification

The following observations predate the concurrency coverage above. First
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

### Focused cross-browser regression command

Run `pnpm --filter @workspace/evexia-portal run test:opening-stock:browser`.
This is an explicitly selected suite, not an addition to the default broad
release run. The runner starts a private socket-only disposable PostgreSQL
database, migrates only that empty fixture to the repository revision, bootstraps
a synthetic account, and starts separate API and Vite listeners. Its cleanup
removes the database and services. It must not start the managed development API
against the original configured target merely to obtain browser evidence.

The matrix requires Chromium, Firefox and the matching Playwright WebKit engine;
an unavailable engine fails rather than silently substituting Chromium.
WebKit evidence does not establish native Safari/macOS file-picker behavior.
The existing Nix adapter supplies runtime dependencies without substituting an
older engine executable.

The focused spec is `artifacts/evexia-portal/tests/opening-stock.preview.spec.mjs`;
its configuration is `playwright.opening-stock.config.mjs`. Real authentication,
catalogue references, reviews, commits, reconciliation, reads, CSV/XLSX transfer
and movement details use the disposable server. Delayed/failed refresh calls
and lost replies are explicit fault injection around those real requests, not
mocked successful stock writes. Layout measurements and screenshots are
presentation evidence only, never proof of production authorization or
main-workspace activation.

The suite checks typed allergen/product choices, optional Unallocated location,
whole-product quantity validation, manual/import review and cancelled/accepted
leave prompts, mounted drafts through renewal and retry, committed versus
not-committed recovery, canonical two-decimal rates and exact opening values,
trusted-click CSV/XLSX downloads, exported-backup re-import without duplication,
Opening/Movement drawer Tab containment, Escape and focus return. It measures
390/768/1440-pixel layouts with actual doubled computed text sizes and checks
deliberate table scrolling separately from page overflow. Per-run screenshots
and diagnostics remain in ignored `test-results/evexia-auth-preview.*/`.

### Browser evidence and remaining activation boundary (2026-10-19)

All nine scenario/engine combinations completed across the interrupted focused
matrix and its targeted continuations:

| Engine | Completed scenarios | Evidence directory suffix |
| --- | --- | --- |
| Chromium | Manual entry/recovery/drawers; typed product/location | `Uj6X4n` |
| Chromium | Import/download/export re-import | `LDMBpv` |
| Firefox | All three scenarios | `LDMBpv` |
| WebKit | All three scenarios after explicit Tab containment fix | `7ilFBN` |

Each suffix belongs to `test-results/evexia-auth-preview.<suffix>/opening-stock-matrix/`.
The WebKit-only continuation reported **3 passed in 25.7 seconds**. Earlier
passes were not rerun merely for a single green combined summary. The final
cross-engine Tab-cycle implementation also passed
`node --test artifacts/evexia-portal/src/components/admin/dialogKeyboard.test.js`;
its browser follow-up covered the failing WebKit flow. Six changed JSX modules,
the new browser spec/config, and the shell harness passed focused syntax checks.
No broad release/default/API regression suite was run.

Actual browser findings fixed here:
- Drawer focus return now captures the invoking control before autofocus and
  resolves its stable identity if asynchronous list refresh replaces the row.
- Both drawers explicitly cycle Tab/Shift+Tab and expose a labelled,
  keyboard-scrollable content region; Escape and close-button return remain.
- Import tabs own their styles on cold routes. The Opening Stock import grid
  keeps review tables within their deliberate scrollers at doubled text sizes.
- Screenshot inspection also found stock metadata styles depended on first
  visiting Stock Status. Those existing styles now live in an explicitly shared
  stylesheet, with minimum-width protection for drawer metadata. This last
  stylesheet extraction was checked through Vite serving, not another browser
  matrix; the captured browser screenshots predate that style-only extraction.

The managed **frontend only** was restarted successfully. Routed frontend
`/release-runtime.json` returned **200**, declaring **0050_opening_stock**.
Routed API readiness and version remained **502** with the managed API stopped.
The public capture still stopped at portal lookup, so it does not verify these
protected screens. The browser evidence above comes from real authenticated
disposable API/database fixtures, not from this public capture or synthetic
success-response stubs. Normal main-workspace synchronization/readiness remains
an activation prerequisite; no original database migration or production access
was performed or implied by these results.
