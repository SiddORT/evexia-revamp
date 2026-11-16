# Super Admin dashboard mock

The existing `/admin` dashboard now contains a frontend-only demonstration.
The staff redirect and no-workspace-permission branch are unchanged. The
existing Admin shell, appearance controls and session behavior are retained.

## Data and interaction boundary

- The notice reads **Mock dashboard · Sample data**. The sample MRs and
  business figures are invented, not copied from the reference screenshot.
- Financial year, MR, Zone, order type and status are draft selections until
  **Apply filters**. The collapsed panel shows the applied selection.
- **Reset** restores FY 2025–26, all MRs, zones, types and statuses, and clears
  the separate MR outstanding search. Nothing is saved to browser storage.
- Directory counts are fixed sample scope totals, explicitly unaffected by
  order filters. All order summaries use the same filtered fixtures.
- In this demonstration only, gross is the sum of all order amounts; sales
  excludes rejected and returned orders; achieved/actual is a fictional
  received amount; due is sales minus that amount. These relationships are
  not accounting, settlement or order-processing policy.
- Each sample Immunotherapy order has one fictional Primary or Booster label.
  These are not clinical or administration records.
- The donut includes all four order types with counts and shares. The trend
  uses chronological calendar months, including when all financial years are
  selected, and offers an expandable table of exact INR amounts.
- No matches replace the figures with an explicit empty state and Reset.
  No dashboard API calls, backend changes, business writes or new dependencies
  were introduced.

## Delivery verification limits

Source and diff were inspected. An isolated static frontend fixture rendered
the real Dashboard and Admin shell with a synthetic administrator. Its
activity recording and notification/session services were replaced with
inert stubs; all API requests, non-GET requests and off-fixture requests were
denied. Remote web fonts were omitted, so the captures use fallback fonts.

Initial layouts were visually inspected at:

- 1440px: Classic theme, light appearance;
- 768px: Modern theme, light appearance;
- 390px: Modern theme, dark appearance.

Those captures had no page-level horizontal overflow or browser JavaScript
errors. Tables retain local horizontal scrolling where necessary.

No live authenticated portal, real directory/financial data, server
authorization, managed preview startup, or persistence was verified.
Interactive filter/search/disclosure and screen-reader behavior were
source-reviewed, not exercised end-to-end. Classic dark and other viewport /
theme combinations were not visually inspected.

No regression/release/completion-validation suites or wrappers, application
build/typecheck commands, managed service starts/restarts, migrations,
deployments or live writes were run. Only the isolated presentation bundle
and screenshots were generated; their output is ignored under
`generated-artifacts/dashboard-inspection/`.
