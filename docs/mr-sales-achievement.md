# MR sales achievement

## Approved read-only scope

MR Dashboard and Targets now consume MR-self reporting, separate from Admin Sales
Target CRUD, demo Payments/activity, settlements and eligibility. No new grants,
schema changes, target-setting UI, exports or order mutations are introduced.
The user confirmed that **approved orders**, not placed or delivered-only orders,
count toward achievement.

The current financial year is determined on the server using Asia/Kolkata today.
Years run April 1–March 31. Q1 is April–June, Q2 July–September, Q3 October–December
and Q4 January–March. Every summary and order contribution uses the same selected
year/quarter, saved order date and persisted MR owner. Approval timestamps do not
determine attribution.

Eligible persisted statuses are `Approved`, `In process`, `Shipped` and
`Delivered`. `Approved` is displayed as `In process` using the existing read
compatibility; this does not manufacture an approval actor or date.
`Confirmed`/`Saved` submissions are not approvals. Drafts, including incomplete
drafts, pending/rejected/returned/cancelled/voided orders and anything outside the
explicit eligible-state list do not contribute.

## Server contract

- `GET /api/v1/mr/sales-achievement`: optional `start_year` (1–9998; omitted means
  current fiscal year), `period=all|Q1|Q2|Q3|Q4`, `offset` 0–20,000 and `limit`
  1–100. The UI uses pages of 25.
- `GET /api/v1/mr/sales-achievement/years`: descending distinct years from only
  the authenticated MR's targets (including inactive/deleted history), owned
  orders and the current fiscal year. `offset` 0–10,000 and `limit` 1–100; the
  UI browses 50 years at a time. Grouping occurs in SQL without downloading
  order documents. The selected year remains available while browsing choices.

Both routes revalidate the authenticated saved MR through the existing order
authorization/assignment policy. Staff and Super Admin are denied; there is no
MR filter/ID input. Queries independently restrict every target/order source to
that MR. Responses are `no-store`. Historical years and totals do not leak other
MRs' records. Rows return only a source-qualified key, order number, type, saved
date, lifecycle status, amount and contribution—no patient/contact/clinical/file,
approval-actor, payment or settlement data.

Sales reads reuse the shared financial/lifecycle transaction lock and existing
directory key scope. Candidate counts and scans are capped at 20,000 eligible
orders per period across all four types. ORM iteration batches 200 encrypted
records, retaining only minimal financial projections. Exceeding the bound is
an explicit report error, never a truncated aggregate. A quarter may reduce the
search; an oversized quarter remains unavailable rather than silently truncated.
No performance claim or benchmark is made.

## Money, target availability and pagination

The existing settlement `saved_total` contract extracts:

- Immunotherapy: the saved integer `totalMinor`, divided exactly by 100. No sum
  over bottles or child/suborder records.
- SPT: saved `total`, already representing all saved patient amounts once.
- Kits: saved `pricing.total`, including its saved tax contract; not Business
  Parking or current catalogue rates.
- Lupin: saved `total`, not recomputed from current count or catalogue prices.

Missing, corrupt, undecryptable or invalid per-order financial evidence becomes
an unavailable amount, not zero. Every such eligible order is still counted and
listed, with unavailable amount/contribution. A known partial sum is labeled
**incomplete**, and definitive overall percentage/remaining are withheld. A
global identity, crypto-configuration or database failure makes the report
unavailable instead. There is no fallback to demo or catalogue data.

One nondeleted target for MR/year takes precedence over deleted history.
Missing, inactive and deleted targets are distinct response states. Only an
active target supplies the selected quarter amount or stored annual sum.
Approved sales remain readable independently. A saved zero target is shown as
zero, but percentages (summary and per-order) require a positive active target.
An annual target is not subjected to the individual-order or quarterly limit.

All money is decimal-string transport. Python Decimal (50-digit local context)
and browser BigInt cents preserve exact sums, remaining and ratios; percentages
round half-up to two places. Overall percentage is never capped at 100%.
Only the progress fill is capped; its accessible text retains the real
percentage. Remaining is floored at zero.

Rows are sorted by saved date descending, then source-qualified order key
descending, with exactly one row per source order. The complete selected-period
sum and total are computed **before** the page slice. This is a live report,
not a historical snapshot across page requests: decisions or target changes
between requests can change later pages and their full-period summaries.
Empty out-of-range pages provide previous-page/refresh recovery.

## Client freshness and presentation

Both screens share the authenticated MR transport, strict response validation
and read hook. Read identity is bound to the session epoch and saved user/MR
scope; request results are keyed by year, period, offset and refresh generation.
Aborts and identity checks prevent stale requests replacing newer selections.
Renewal hides prior results and loads fresh reporting after verified access
returns without altering drafts elsewhere. Reads occur on mount, focus,
visibility return and browser page return; Refresh/Retry are explicit.

Targets retains browser date preferences, native labeled year/quarter controls,
explicit quarter ranges, summary/loading/no-sales/no-target/error states and a
semantic table with responsive stacked rows and previous/next navigation.
Dashboard uses the server's current fiscal year with a direct Targets link.
Demo milestones/badges/achievement and demo collection/outstanding summary cards
have been removed from its live achievement area. The untouched fictional
activity section and demo-payment shortcut are explicitly identified as demo.

## Verification limits for this delivery

This is **source-only and untested** at the user's request. Authorization,
four saved-total extraction paths, approved-state whitelist, fiscal boundaries,
one-row-per-order projection, sum-before-pagination, exact math and response
guards were inspected in source.

Only offline FastAPI OpenAPI export, direct Orval generation, generated Zod
constant ordering and generated-file formatting were run. The ordinary codegen
wrapper was deliberately not used because it chains library type checking.

No tests were added, modified or run. No regression/release suites, completion
validation commands, type checks, builds, runtime/manual/browser requests,
screenshots, performance benchmarks, live data reads/mutations, migrations,
notifications, service starts/restarts, production access or deployments were
performed. Generated output is not runtime verification. Actual authenticated
authorization, database behavior, encrypted historical amounts, browser
responsiveness/accessibility and deployed integration remain unverified and
require separate authorization.
