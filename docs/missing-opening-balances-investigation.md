# Missing opening balances: read-only investigation

## Status

The reported zero display **does not reproduce in the current signed-in
preview**. All four affected items were observed with physical `100.00` in the
real API response, listing and View. Refresh fetched a new, correct snapshot.
No additional application source change or data repair is justified.
The earlier physical-opening visibility implementation and the separate
optional-expiry entry implementation are retained without changes.

## Actual development evidence (2026-11-12)

Read-only queries against the available development database found seven saved
openings and seven linked opening lots. The schema revision reported
`0096_hsn_master`. This is evidence about this workspace's available database,
not proof that the screenshot's browser contacted this same service/database.

The four affected records resolve as follows. Names are catalogue labels;
immutable IDs, not screenshot spelling, were used for linkage.

| Item | Item ID | Opening ID | Lot ID |
| --- | --- | --- | --- |
| ARTESEMIA | ba201fc6-6c87-4ee0-bde6-62b7a7866469 | 96164d63-ee1d-4727-8993-9a0d20755776 | ad3c29f1-7c91-4b73-aafa-c4d43c288676 |
| Almond | a7eaac05-f3a5-4ea7-b202-11a06946a091 | e14ff97c-c831-4993-997d-740fedb1b180 | 03e23dc5-b907-4c68-8568-3b199701d5d4 |
| Anjeer | a29853e7-4f56-4e19-91c9-4fd848bc374d | 513ec17d-c07c-4099-8071-4f95726e7c3e | 73c93824-71ce-4e60-a366-4cf4791c8e91 |
| Brassica Nigra | a676064d-0a45-4be3-94e6-ee447a637da6 | 3f063e49-80c9-41a8-8e0e-68c28444fb4e | ce522a65-1d20-4223-96cd-d7aa49587a55 |

For each of these four:

- The opening's retained item/lot/location IDs agree with the relational lot
  product/opening/origin links and the lot's retained product/opening IDs.
- The saved opening quantity, lot acceptance and current balance are all
  `100.00`.
- Exactly one posting exists: `opening:<opening ID>`, with delta `100.00`,
  before `0`, after `100.00`. No later depletion or transfer posting was found.
- Original location and current balance location are both
  `ccfe2a79-3e3e-4de1-a1fd-8060af189641`, not Unallocated.
- The retained opening and lot both have unknown expiry; the lot source is
  `opening`.

The descriptive evidence was read using the existing crypto reader in a
database-enforced read-only transaction, with a five-second statement timeout.
Only stock identity/quantity/expiry evidence was printed, not keys, credentials,
ciphertexts or personal actor data. The existing quantity-precision ciphertext
selection was respected. No stock service or mutation endpoint was invoked.

Two separate `100.00` openings for Mite (D Pteronyssinus) also exist as distinct
lots with their own `100.00` balances. This supports the need to preserve
distinct opening identities rather than deduplicate by item name.

## Source review, not executed verification

`opening_stock.create` atomically retains the opening, creates the linked lot,
and posts the quantity under the shared transaction. The inspected records
agree with that provenance.

`inventory.stock_snapshot` already:

- Resolves product identity from the lot's relational item ID.
- Includes unknown-expiry opening lots by `opening_id`, independently of the
  usable-expiry predicate.
- Adds each nonzero current lot/location balance once to `physicalLots`.
- Computes `physicalQuantity` from those live allocations, not original
  opening quantities or accepted quantities.
- Keeps unknown-expiry allergen openings out of usable `lots` and `quantity`.
- Separately computes physical and usable Unallocated subtotals.
- Filters by physical quantity and projects listing/export rows from the same
  transaction-held snapshot.

The response schema explicitly retains the physical fields. The inventory
transport returns successful JSON without a stock-quantity rewrite and uses
`cache: 'no-store'`. Stock Status requests a complete filtered snapshot and
renders `physicalQuantity`; CSV and report use that same snapshot. View makes
a fresh identity-filtered stock request and groups physical allocations by lot
identity. Both listing and View Refresh issue another read.

Consequently, under this inspected code and the observed data, each affected
row should have physical `100.00`, unknown-expiry opening `100.00`, usable
`0.00`, physical Unallocated `0.00`, and state `opening_backed`. These are
**source-derived expectations, not observed HTTP or browser results**.

Source-only scenario review:

| Scenario | Inspected behavior |
| --- | --- |
| Opening only, untouched | Its current balance contributes once to physical stock; unknown expiry contributes nothing usable. |
| Repeated openings | Distinct lots contribute their distinct balances; original records are not re-summed or deduplicated by name. |
| Receipt plus opening | Eligible receipt balances and physical opening balances share the item row; usable totals still exclude unknown-expiry openings. |
| Partial depletion | Only remaining balances contribute, not original opening quantities. No depletion was performed to exercise this. |
| Location changes | Current balance location owns the allocation; original opening location remains provenance. No movement was performed. |
| Unallocated | NULL-location physical balances are included once and separately subtotaled. The affected observed rows are allocated. |

`expiry_policy.usable` / `require_usable` and the existing movement/consumption
guards were not changed. No expiry was entered or backfilled, and no eligibility,
low-stock policy or procurement-unit meaning was broadened.

## Remaining evidence needed

There was no authorized signed-in browser/session available in this
investigation. No credentials were retrieved, session fabricated, or login
performed. The screenshot's protected stock response and rendered rows therefore
remain unobserved.

The next step is to obtain a sanitized successful stock-response JSON from the
affected signed-in browser, including its `asOf`, coverage, affected product IDs,
physical/usable quantities, physical lots and state, plus the request's origin
and path (without headers, cookies, tokens or private actor data). Compare the
same identity-filtered View response and refreshed listing response. This
distinguishes a zero returned by the service from a lost or stale browser result.
Runtime source identity and database alignment must then be established on
that actual target if the response disagrees with the inspected source/data.

A process listing showed an already-running API process starting after the
local visibility and optional-expiry commits. Process time alone is not proof
of its loaded revision or of the screenshot's target. No stale-service cause
has been established. Do not restart speculatively: the configured API startup
script runs schema review and automatic database synchronization before serving.
Any restart requires separate approval, including its startup consequences.

Initially no tests, builds, browser automation, release checks, workflow
wrappers, startup hooks, migrations, deployment, stock writes or repairs were
initiated. Existing API/frontend and release-wrapper processes were already
present when inspected; that observation is not a claim that the environment
had no independently running checks.

### Subsequently approved browser inspection

The user subsequently explicitly approved inspecting Stock Status without
changing stock. The inspection browser had no existing page or authenticated
session. A fresh navigation to the user-supplied preview origin returned HTTP
200 and displayed the public EVEXIA portal chooser, with Admin Portal, Medical
Representative Portal and IMMUNO PORTAL links and the notice that access is
limited to authorised users. A screenshot of that public landing was captured.

This browser does not share the user's signed-in preview session. No login,
credential retrieval, stock mutation, service restart, build, migration or
regression suite was performed. The authenticated stock response and rendered
quantities remain unobserved. A separately approved sign-in or a sanitized
response from the user's own signed-in browser is still needed.

### Subsequently approved sign-in

The user then explicitly approved signing in after being warned that it could
replace their same-account session. The remote inspection browser could not
consume workspace credentials directly. A local browser process using the
already-installed browser package and Chromium could securely read the two
specifically approved environment values without printing or persisting them.
One actual Admin UI login submission was made at the supplied preview origin.
`POST /api/v1/auth/login` returned HTTP **401**. No additional login attempt,
password reset, account change or authentication bypass was performed.

This rejection does not establish whether the configured initial password is
still current or whether another authentication condition caused the rejection.
It also supplies no evidence about the stock response itself. The inspection
stopped before Stock Status and did not change stock. A working authorized
sign-in or sanitized response supplied from an existing signed-in browser is
still required. The issue remains unresolved; no stale-service or source/data
cause has been demonstrated.

### Successful authorized inspection

After the rejected configured-initial-login attempt, the user supplied a
working inspection login through the secure secret form. One actual UI login
using those newly supplied values returned HTTP 200. Values were consumed only
inside the local browser process, not printed or persisted in scripts, browser
storage-state files or screenshots.

At the user-supplied preview origin, between **2026-11-12 11:08:05 and 11:08:12
UTC**, actual HTTP 200 stock responses and the rendered listing and View showed:

| Item | Physical | Unknown-expiry opening, not usable | Usable | Physical Unallocated | State |
| --- | --- | --- | --- | --- | --- |
| ARTESEMIA | 100.00 | 100.00 | 0.00 | 0.00 | opening_backed |
| Almond | 100.00 | 100.00 | 0.00 | 0.00 | opening_backed |
| Anjeer | 100.00 | 100.00 | 0.00 | 0.00 | opening_backed |
| Brassica Nigra | 100.00 | 100.00 | 0.00 | 0.00 | opening_backed |

The returned lot, opening, product and location IDs matched the earlier database
evidence above for every affected item. Coverage was complete, with zero pending
receipts. The unfiltered listing snapshot returned all four correct rows;
searching each immutable product ID produced the same correct listing row.
Each identity-filtered View response and rendered detail also agreed.

The explicit listing Refresh produced a new HTTP request and advanced `asOf`
from `2026-11-12T11:08:07.356626Z` to
`2026-11-12T11:08:07.465890Z`, retaining Brassica Nigra's physical `100.00`.
Ten stock responses were observed in this narrow inspection. Screenshots of
the final filtered listing panel and detail panel are retained in the ignored
`generated-artifacts/opening-stock-inspection/` directory. Both were visually
examined. They exclude account/header details and login fields.

The browser request guard passed real GETs and required authentication requests,
but blocked non-authentication business writes; it did not fulfill or alter
any response. No stock mutation, fixture data, re-entry, adjustment or repair
was performed. The guard also means this is not evidence of normal background
activity reporting.

An additional public `GET /api/v1/version` returned the API's load-time source
identity. Its source digest matched a read-only recomputation over the current
manifest, dependency files and Python source:
`a849e7044bd22f23f7a16afd3397e2e8b24134644751f376dff2dd8d75f348c6`.
The reported schema was `0096_hsn_master`. This establishes current API source
alignment at the inspected origin; it does not reconstruct the screenshot's
earlier runtime or prove a stale-service explanation for it.

CSV/report agreement remains **source-reviewed**, not an exercised download or
print: both consume the same `snap.rows` fields described above. No regression
suite, build, workflow wrapper, startup hook, migration, restart or deployment
was initiated. The original blanket browser restriction was changed only by
the user's later explicit approval for this narrow inspection and sign-in.

## Outcome and remaining uncertainty

There is no demonstrated remaining defect to patch in the current preview.
The authoritative remaining balances, protected stock responses and rendered
quantities agree. The existing merged visibility correction is effective in
this observed runtime, and the separate optional-expiry work is untouched.
No stock repair or service restart is required by the present evidence.

The historical screenshot's zero response/display cause remains **unknown**:
there is no captured old response or load-time identity from that incident.
Do not label it an identity mismatch, missing posting, lost response, stale
server or browser cache problem without that evidence. If it recurs, preserve
the affected product ID, request path, response `asOf` and quantities, and
runtime identity before any restart. This documentation-only outcome verifies
the requested present balances without inventing a new fix or historical cause.
