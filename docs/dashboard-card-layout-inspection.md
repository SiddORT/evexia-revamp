# Dashboard card layout: focused presentation inspection

## Scope and safety

Inspected only the actual sample dashboard components, bundled into an ignored
static harness served at `127.0.0.1:43871`. The harness imported the existing
Admin theme CSS, reproduced the desktop 224px sidebar reservation and responsive
content padding, and rendered `DashboardContent` directly. It did not mount the
portal application, authentication, API, databases or startup scripts. This is
component-level presentation evidence, not signed-in portal integration evidence.
Remote fonts were not loaded; the configured font fallbacks were used.

**Regression checks and release checks were not run.** Managed workflow status
was inspected before and after: all release and artifact workflows remained
`not_started`. No managed startup, API migrations, app-preview screenshot tools,
production deployment or backend changes were used.

## Viewports and appearances

Local headless Chromium inspection covered **360×900, 390×900, 768×900,
1024×900 and 1440×900 CSS pixels**, each with Classic/light, Classic/dark,
Modern/light and Modern/dark. Touch interactions also used **390×844**.

- At every width and appearance, the document scroll width equalled the viewport
  width. Sales tables retained their own horizontal scrolling where necessary.
- At 360 and 390, metrics and doses stacked naturally without clipped labels.
  Larger panels stacked; no empty placeholder cards were introduced.
- At 768 and 1024, metrics used two columns and matching row heights. Sales and
  MR panels had aligned top/bottom edges (365px height in the initial scope).
  Dose cards shared a compact full-width section; charts stacked rather than
  forcing a narrow donut layout to create a tall neighboring empty panel.
- At 1440, financial and directory metrics used four columns. Total Orders
  spanned two columns, allowing all seven order cards to fill two complete rows.
  Order cards were 66px high, financial cards about 86px, and directory cards
  66px; there was no blanket shared height across unlike content.
  Sales/MR panels aligned at 365px, the dose section was about 167px, and the
  chart panels aligned at about 304px.
- Inspected screenshots in light and dark appearances retained the existing
  semantic colors, sample-data notice, financial explanations, charts and labels.
  The long Kits & Consumables label remained readable in breakdowns.

## Breakdown observations

- All seven cards opened on hover. Moving into each panel and waiting beyond
  its close delay left its content readable. Before/after card rectangles were
  identical; the panels did not shift the layout.
- The initial Total Orders breakdown was **91 + 52 + 56 + 17 = 216**.
  Status breakdown sums matched their cards: Confirmed 33, In Process 29,
  Shipped 24, Delivered 97, Rejected 16 and Returned 17.
- Actual Tab entry opened the Total Orders information control. Escape dismissed
  the panel without losing button focus. Enter reopened/pinned it. Tab proceeded
  to Confirmed without a focus trap.
- Touch opened the panel; tapping inside preserved it; tapping outside dismissed
  it. The lower-edge mobile panel positioned above its anchor within the viewport.
- Initial panels stayed within the viewport in all 20 width/appearance combinations.
  Separate In Process and Returned inspections at all five widths confirmed
  right-edge clamping, including x=1122, width=310 on a 1440px viewport.
- Selecting SPT without applying kept the total/breakdown at 216. Applying it
  changed Total Orders to 56, with SPT 56 (100.0%) and all other types 0 (0.0%).
- Applying SPT + Returned left Confirmed at zero, with all four types displayed
  as 0 (0.0%), without invalid percentages.
- Applying Arvind Menon + North Zone produced the existing empty state at all
  five widths without overflow. Its reset restored the initial view.
- The monthly chart text alternative still opened and displayed its 12 rows.
- No browser runtime errors were observed.

## Evidence and limits

Local captures and observation logs are in the ignored
`generated-artifacts/dashboard-layout/` directory; they are not deployment inputs.
Inspection scripts were direct, dashboard-only browser operations, not a
regression or release suite. Screen-reader announcements, enlarged-text behavior
and other browser engines were not verified in this work.

All values remain explicitly fictional. No live order integration, financial
calculation policy, new metrics, document actions or order mutations were added.
