# MR dashboard organization and Doctor payments

## Delivered source

- Compact shared header with identity, reporting year, order period, Refresh,
  New order and access to Doctors, Targets and Accounts.
- Overview (default), Doctor payments and Performance tabs. Tab state and
  report/search/pagination state remain mounted. Inactive content is hidden,
  and count-card portals close when leaving Overview.
- Overview retains a compact restriction status backed by the same fetched
  state as the detailed restrictions panel.
- Overview now has four shared financial cards with configured KIT subtotals
  and an explicit disclosure that other type formulas are pending. There is
  no duplicate pending-only card group in Doctor payments.
- Dashboard-local layouts wrap controls, keep mobile KPIs compact and render
  payment records as labeled mobile records without fixed-height panels.
  Existing chart/table alternatives and global MR navigation remain intact.

## Reporting boundary

`GET /api/v1/mr/sales-achievement/doctor-payments` accepts bounded `search`
(Doctor name only), `offset` and `limit`. It has no MR selector: authorization
requires the authenticated MR and revalidates the saved identity.

The report reads a repeatable snapshot. The current nondeleted assigned Doctor
directory matches the ordinary MR listing, including inactive Doctors. Only
the signed-in MR's Doctor-linked, non-draft saved orders enter the report.
Doctor-less MR-supply orders and other MRs' orders are excluded before
decryption. No contact fields, receipt details or other MRs' balances are
returned.

Committed settlement allocations count as received independently of
verification. Active credit notes reduce dues but never count as received.
Saved-total validation, receipt/credit history, consistency checks, lifecycle
sets and pending-pricing recognition reuse the existing financial authorities.
Decimal aggregation never uses floating-point money. Fulfillment and returns
retain existing obligations; excluded lifecycle stages create no new dues.

Search and pagination happen after complete scoped aggregation. The report
fails explicitly above 20,000 Doctors/orders or existing financial-history
limits, rather than presenting a partial scan as complete.

Oldest unpaid age uses known positive saved-order obligations and the server's
Asia/Kolkata date. The current MR's inherited Doctor Days Limit determines
remaining and elapsed overdue days, including overdue on the limit day. A zero
limit disables the days restriction. Fully settled Doctors have no unpaid age
or deadline. Pending-pricing obligations produce nullable total due and a
known-partial indicator; they never become zero balances or invented dates.

The transport validates identity, pagination, exact monetary strings and aging
relationships. Aborted/older requests and previous-session responses cannot
replace the current result. One dashboard freshness timer feeds the report,
restriction summary/detail and Doctor balances, with existing order events,
cross-tab notifications, visibility, page-show, focus and explicit Refresh.
Settlements have no separate change broadcast today; their existing
polling/focus pattern and explicit Refresh provide the freshness path.

## Shared Overview financial contributions

The four shared cards use the selected FY/quarter saved-order-date period and
saved MR ownership, including Doctor-less KIT supply orders. They do not use
the current assigned-Doctor directory above. Total Sales sums saved Business
Parking. Gross and Actual Sales intentionally both sum saved invoice payable
totals. These three sales measures require the existing approved-state whitelist.

Due Amount retains existing obligation lifecycle rules (including payable
Returned orders). It adds committed unverified allocation amounts to ordinary
unpaid balances: payable minus all receipts minus active credits plus
unverified receipts. ₹1,000 payable and ₹300 unverified means ₹700 unpaid plus
₹300 unverified = ₹1,000 Due; after verification it becomes ₹700. Fully
received but unverified is not zero on this card. The all-date Doctor balances,
ledger balances and enforcement rules above are unchanged.

KIT target achievement separately uses saved Business Parking directly with no
discount, credit-note, receipt or verification deductions: ₹900 Parking means
₹900 achievement. Overview, Performance and Targets share this policy.
Non-KIT achievement is unchanged. Existing encrypted contribution/history
snapshots are neither rewritten nor used as a fallback.

See `mr-dashboard.md` for the configured-subtotal contract, independent evidence
availability, exact arithmetic, bounded snapshot read and privacy boundaries.

### Financial contribution delivery verification

Only source/diff inspection and narrowly scoped offline OpenAPI/direct dashboard
client and validator generation were performed for this change. No tests,
regression/release checks, completion-validation wrappers, builds, typechecks,
browser/runtime probes, migrations, managed service starts/restarts,
deployments or live business writes were performed. Runtime behavior remains
**unverified**, including totals, verification transitions, historical evidence,
authorization, concurrent changes and responsive/keyboard rendering.

## Earlier organization work: historical verification record

- Offline scoped OpenAPI export and additive dashboard client/validator
  generation. The package codegen wrapper was not used because it chains checks.
- Python AST parsing and frontend JavaScript/JSX/CSS syntax transformation only.
  These do not execute the application, query data, or constitute regression
  or release verification.
- Source/diff inspection of ownership, exact arithmetic, pending-pricing,
  pagination, refresh/session guards, tab relationships and local layout rules.
- The existing preview route `/mr/home` returned HTTP 502. No Vite or Uvicorn
  preview processes were found. A 390px screenshot attempt also failed on
  navigation before rendering the page.

**Unavailable evidence:** authenticated rendered layouts at 360/390, 768,
1024 and 1440px; before/after heights; 200% zoom/text enlargement; theme and
appearance variants; populated/empty/error/loading visuals; long names/large
amounts; keyboard/touch tab transitions; filter/popover bounds and bottom
navigation overlap. None is claimed to have passed based on CSS alone.

No regression suites, release checks, completion-validation wrappers, browser
test harnesses, service starts/restarts, migrations, staged activation, business
data changes or deployment were performed. The new endpoint was not exercised
against a running application. Inspect the requested viewport/state matrix
when an already-running authenticated preview is available, without starting
services or writing data unless separately authorized.
