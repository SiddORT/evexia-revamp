# EVEXIA Portal responsive audit

Audit date: 2026-10-09. This is a browser/CSS-viewport audit of the built portal, not a physical-device certification. The source snapshot includes the merged master-form cleanup, modal Opening Balance creation, Allergen combined controls and Sessions Remember me correction. Later domain or identity changes need their own checks.

## Result and scope change

- Final full Chromium audit: **PASS**, 949 measured states, zero layout failures, Chromium 152.0.7977.64, 444 seconds.
- Final shared/high-risk Firefox audit: **PASS**, 243 measured states, zero layout failures, Firefox 155.0, 144 seconds.
- Final WebKit recheck: **OMITTED at the user's request**. The queued run was explicitly stopped after Chromium and Firefox finished. Its 83 partial measurements do not constitute a completed pass.
- Earlier WebKit 26.6 audit: 243 measured states, four failures of the same enlarged-text Allergen import layout across the appearance combinations. The fix is included, but no completed after-fix WebKit pass is claimed.
- Supplemental document/template panels: **PASS**, 39 measured states per engine in Chromium and Firefox, zero layout failures. Terminal summary: 2 passed in 1.0 minute.
- Total completed layout measurements: **1,270 PASS** (949 + 243 + 39 + 39), excluding incomplete and baseline runs.
- Dedicated Sales Target enlarged-text suite: **PASS**, all 16 Chromium/Firefox cases in 2.6 minutes. No new WebKit cases ran.
- Opening Balance regressions: seven unaffected cases passed; the corrected retry/uncertain-save modal case passed its focused re-run in 5.8 seconds (7.7 seconds total). Both cold-route selector/theme cases passed.

## Coverage matrix

Representative coverage for every inventoried Chromium route and its discovered form tabs:

| Class | CSS viewport |
| --- | --- |
| Phone | 390 × 844 |
| Tablet | 820 × 1180 |
| Laptop | 1366 × 768 |
| Desktop | 1920 × 1080 |

Expanded coverage for public entry surfaces and representative protected shell, dense list, form, import, settings and history surfaces:

320 × 568; 360 × 800; 390 × 844; 430 × 932; 768 × 1024; 820 × 1180; 1024 × 768; 1280 × 720; 1366 × 768; 1440 × 900; 1920 × 1080; 2560 × 1440; phone landscape 844 × 390; tablet landscape 1180 × 820.

Breakpoint checks use widths immediately either side of 460, 600, 760, 800, 900, 1000, 1050 and 1150 at height 720: 459/461, 599/601, 759/761, 799/801, 899/901, 999/1001, 1049/1051, 1149/1151. There are 30 expanded viewport pairs. The additional 760 and 1000 transitions are present in the built import/settings layouts.

Firefox covers public entries, protected high-risk routes at phone/tablet/laptop, expanded 320 × 568, 844 × 390 and 1024 × 768, plus representative dialogs, staff/MR actors, settings appearances and import review panels. It is not represented as a full Firefox route census. Supplemental document and authoring panels use all four representative sizes; document previews also use 320 × 568 and 844 × 390.

## Built routes and distinct surfaces

- Public `/`, `/admin/login`, `/mr`, `/doctor`, and unknown-route fallback. Includes real synthetic Admin/staff/MR login destinations; Doctor remains the existing public placeholder, not a new authenticated Doctor workflow.
- Admin home and Masters home; Staff management and Roles & Permissions; Activity Logs and Download Logs with discovered tabs.
- All master lists: Zones, Courier Partners, MRs, Doctors, Patients, Product Categories, Storage Locations, Headquarters, Designations, Allergens, Vendors, Sales Targets and Opening Balances.
- Page-based Add forms: MR, Doctor, Patient, Product Category, Storage Location, Headquarters, Designation, Allergen and Opening Balance. Their form tabs are discovered and exercised separately.
- Saved page-based Edit/detail routes for these masters, patient dosage history, Doctor payments, and saved PO/receipt details. Long synthetic names, addresses and exact saved amounts populate the relevant forms and tables.
- Inline Add editors: Zone, Courier Partner, Vendor, Sales Target, Staff, Role, Communication configuration and Message Template. Discovered dialog tabs are individually measured. Zone's populated Edit, Delete confirmation (cancel only) and export menu are also checked.
- All master import routes: Zone, Courier Partner, MR, Doctor, Product Category, Storage Location, Headquarters, Designation, Allergen, Vendor, Sales Target, Opening Balance and Patient. Allergen adds a long invalid CSV review, expanded diagnostics and disabled commit evidence; the dedicated Sales Target suite adds populated valid/invalid review and pagination.
- Inventory: Purchase Orders list/new/saved detail, Purchase Received list/new/saved detail and form tabs, Move Stocks list/new, and Stock Status. Synthetic browser-local procurement samples only.
- Orders: Immunotherapy, Kits & Consumables, SPT and Lupin navigation/placeholders. No unfinished Order workflow was invented.
- Settings: General, Appearance, PO Templates, Communication, Email & SMS Templates, discovered channel tabs, Add configuration/template editors and representative authoring/preview panels.
- Shared drawer and its search/focus return, profile menu and focus return, contained table scrolling/final-column reachability, Doctor/Sales Target filters, Opening Balance modal validation/year selector and reachable Cancel/Save on narrow/short screens.
- Authenticated staff: permitted Zone landing, profile menu, Add Zone dialog. Authenticated MR: home and password-validation state, without changing its password. All actors are generated inside disposable fixtures.

The downloadable HTML includes the exact surface/viewport rows, scroll bounds, issue details, terminal results and screenshots. A route row is not a claim that every possible database value or rare operational error was exercised. Empty forms and validation errors, populated masters, invalid import review and long-content cases are explicitly identified rather than treated as interchangeable.

## Confirmed defects and fixes

1. **MR and Doctor lists at 1366 × 768:** document widths were 1414 and 1593. Screen-reader-only contact labels in the final action cell were absolutely positioned relative to the page instead of their button. `contact-requirement.css` now establishes the button's positioning context. Table scrolling and accessible labels remain intact; no data is hidden.
2. **Opening Balance:** Previous/Next/Save labels clipped in the 320px modal and controls widened the form at 200% text. Scoped `openingBalance.css` rules allow button labels and action rows to wrap, keep a 40px minimum height and constrain the action row. The recently added modal and standalone Add route remain functional.
3. **Firefox Settings at 390 × 844 / 200% text:** implicit grid tracks enlarged the navigation to 403px. `adminSettings.css` now uses shrinkable navigation/list tracks and explicitly shrinkable search/link containers. Long descriptions stay visible.
4. **WebKit Allergen import at 390 × 844 / 200% text:** heading, tabs and sample controls widened the document to 424px. Shared `excel-import.css` now constrains import children/buttons and wraps headings and filenames. Existing specialized Courier/Category/Storage diagnostics remain scoped. Chromium/Firefox after-fix coverage is reported; final WebKit verification was omitted as requested.
5. **PO invoice keyboard focus:** Escape closed the preview but did not return focus to its opener in either engine. The preview now closes the native dialog explicitly and restores the connected opener, matching the existing receipt preview behavior.
6. **Firefox Sales Target at 1440px / 200% text:** Tab focused a reference selector's Load more button without scrolling it fully into the viewport. `RemoteSelect.jsx` now scrolls that focused pagination control into view. The existing dedicated keyboard/pagination assertions subsequently passed in all 16 cases.
7. **Receipt preview controls at 320px and 390px:** the PDF-format/download/close action row extended to x=444. Scoped `prDocument.css` rules allow the row to wrap and let the document body shrink/scroll inside its bounded dialog. Screen-only flex containment leaves print styles unchanged. Both engines passed all document/template panel cases after the fix.

These are measured browser failures, not speculative breakpoint changes. There is no global overflow-hiding workaround, table-to-card redesign, backend change, permission expansion or PDF calculation/template rewrite. Classic/Modern and light/dark receive normal and 200% computed-text checks at phone/tablet/laptop sizes. Sessions Remember me presentation was not changed.

## Verification and repeatability

Each authenticated command creates private PostgreSQL/API/portal listeners, synthetic credentials and an independent evidence directory. Projects sharing the fixture run serially. Application source stays fixed during each pass. Failed baseline runs are kept as before evidence, not counted as successful coverage.

Commands:

    EVEXIA_NIX_DOWNLOAD_ENGINES=1 sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/portal-responsive.preview.spec.mjs
    EVEXIA_NIX_DOWNLOAD_ENGINES=1 EVEXIA_RESPONSIVE_SCOPE=panels sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/portal-responsive.preview.spec.mjs
    sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/opening-balances-backend.preview.spec.mjs
    EVEXIA_NIX_DOWNLOAD_ENGINES=1 EVEXIA_SALES_TARGET_LAYOUT_ONLY=1 EVEXIA_SALES_TARGET_LAYOUT_ENGINES=chromium,firefox sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/sales-targets-backend.preview.spec.mjs
    PORT=5173 BASE_PATH=/ pnpm --filter @workspace/evexia-portal run build

The responsive command now defaults to Chromium/Firefox. To resume omitted WebKit coverage deliberately, set `EVEXIA_RESPONSIVE_INCLUDE_WEBKIT=1`; to isolate one engine also set `EVEXIA_RESPONSIVE_ENGINE=webkit`.

Final production build: **PASS**, Vite completed in 6.03 seconds after the final receipt fix. Related server Opening Balance/MR/Doctor service checks: **PASS**, 6 tests. Managed portal restarted cleanly; the public 390 × 844 entry screenshot and browser logs show no runtime error.

The existing Opening Balance test needed its interception to include the transport's optional query string, the resource-specific retryable error code, and the new modal's scrolling container rather than an obsolete panel ancestor. The dedicated Sales Target enlarged-text suite is reused, not reimplemented; its late already-handled interception is tolerated while the UI/pagination assertions remain required.

## Evidence and limitations

- `final/audit.html` is self-contained with embedded screenshots; `final/measurements.json` provides machine-readable measurements. Baseline folders retain before screenshots and interrupted-run diagnostics.
- Initial runs exposed test assumptions (hidden loader/cancel targeting/import fixture shape), and one concurrent Chromium run ended with an unexplained browser closure. The final serial Chromium and Firefox runs completed. These interruptions are not presented as product defects or passes.
- The full legacy `pnpm run validate:release` gate was not repeated: it includes mandatory WebKit projects, contrary to the final requested scope. Its earlier baseline had 166 passed / four failed (two browser interruptions and two Headquarters checks still targeting a removed Regenerate control). This audit does **not** claim that full gate passed; its old Headquarters assertions need separate alignment with the merged form cleanup.
- Actual keyboard Tab/Escape paths check drawer/menu focus and return. Touch-size viewport emulation is not a physical touch test or an operating-system keyboard test.
- 200% computed text and a 683 × 384 effective viewport representing 1366 × 768 at 200% reflow are covered. This is **not native browser UI zoom**. Browser chrome zoom and mobile virtual-keyboard behavior were unavailable in the headless environment.
- WebKit is an engine build, **not native Safari**. Its final recheck was omitted at the user's request. No physical devices or native Safari are certified.
- No live account, managed database, real patient/staff record, outbound message or production deployment was used. Browser-local documents were previewed on-device; the audit did not claim new PDF download fidelity testing.
