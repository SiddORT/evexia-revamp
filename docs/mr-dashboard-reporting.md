# MR dashboard organization and Doctor payments

## Delivered source

- Compact shared header with identity, reporting year, order period, Refresh,
  New order and access to Doctors, Targets and Accounts.
- Overview (default), Doctor payments and Performance tabs. Tab state and
  report/search/pagination state remain mounted. Inactive content is hidden,
  and count-card portals close when leaving Overview.
- Overview retains a compact restriction status backed by the same fetched
  state as the detailed restrictions panel.
- The undefined financial cards remain in a secondary disclosure. They have
  no new formulas. The policy/evidence disclosure and long implementation
  explanations have been removed.
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

## Verification actually performed

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
