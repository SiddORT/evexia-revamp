# Portal date presentation inventory and contributor contract

## Contract

- UI dates use `useAdminDateFormatters()` (subscribed) or the existing
  `formatAdminDate` / `formatAdminTimestamp` helpers **with a subscribed owner**.
  A helper call alone does not subscribe a mounted React view.
- Calendar-only strings (DOB, joining, payment, PO, expected delivery, receiving,
  batch expiry, movement, order and stock snapshot dates) use the calendar helper.
  They never become instants and never move a day with the chosen time zone.
- Instants (audit, activity, session, domain and report generation metadata) use
  the timestamp helper. Preserve seconds where the old screen showed seconds.
  Invalid, missing or ambiguous input displays `—`, never `Invalid Date` or raw input.
- Non-React renderers import only `services/datePresentation.js`. The browser
  boundary passes a validated immutable preference snapshot. Document models stay
  canonical; render copies, accessible summaries and downloads use that same
  snapshot. Do not re-read preferences midway through an asynchronous export.
- Use ISO values for native date input `value`, `min` and `max`. Their visible
  presentation is browser/device-controlled; General settings do not replace the
  native picker. Settings explains this limitation.
- Do not format dates in APIs, storage, sorting, validation, CSV/XLSX round trips,
  filenames/identifiers, `<time dateTime>`, or other machine metadata.
- Run `pnpm --filter @workspace/evexia-portal test:date-preferences` and the focused
  `test:date-preferences:browser` suite when changing date displays. The release
  validation includes the source guard and presentation tests.

## Implemented route and shared-surface inventory

| Area | Classification and reviewed presentation |
| --- | --- |
| Zone, Headquarter, Storage Location, Product Category, Designation, Courier Partner and Vendor masters | Created/updated instants in tables, cards and detail/audit helpers use the shared timestamp formatter; subscribed page owners. Their create/edit forms have no independent displayed date strings. |
| Allergen master, form and import | Shared audit timestamps (seconds retained); prices and reference details are not dates. No native picker replacement. |
| MR, Doctor, Patient and Staff masters/forms | DOB/joining dates are calendar-only, audit values are instants; expanded profiles and mobile paths use the same helpers. ISO form values and age/business validation are unchanged. |
| Opening Balance master/form/import | Audit instants formatted with subscribed form/page; financial year start/end are year identifiers, not calendar dates. |
| Sales Target master/import | Shared audit instants; annual/quarter identifiers are accounting periods and remain unchanged. |
| All master import routes and shared Excel/CSV import review | Canonical source cells and validation diagnostics describe the file being imported, not a date display or saved record. Source file values, workbook/CSV output and machine transfer data are deliberately unchanged. |
| Doctor payment history | Payment dates are calendar-only. Live payment history and Patient Dosage History are currently placeholder surfaces without implemented date records. |
| Purchase Orders list, mobile cards, activity, create/edit review and detail | PO/expected dates are calendar-only; activity/created/updated/deleted values are instants. Form input values, date filtering and server amounts unchanged. |
| Purchase Received list, mobile cards, create/edit review, detail, activity and linked PO receiving panel | Receipt/PO/expiry dates are calendar-only; history metadata are instants. These remain explicitly browser-local, separate from server POs. |
| Move Stocks list, product dialog and form | Movement date is calendar-only; control values remain ISO. No ledger/business-date behavior changes. |
| Stock Status list scope, history detail and inventory report/print | Snapshot/year boundaries/history dates are calendar-only; generated time is an instant. Printed DOM uses exactly the displayed formatted text. CSV remains canonical. |
| SPT, Lupin, Kits/Consumables and Immunotherapy lists/reviews | Saved order dates are calendar-only; session-only stores, business-day generation, sorting and transfers unchanged. |
| Immunotherapy print/labels | Historical order labels use formatted calendar dates, including print output. Authored product/dosage and shipping content is not a date display. |
| Activity Logs and Download Logs | Display instants use selected date/zone/clock; seconds preserved for audit evidence. **Start/end filter controls explicitly remain UTC**, including inclusive-end API conversion. |
| Roles & Permissions | Selected role and conflict-review metadata are instants with seconds; both page and review form subscribe. |
| Settings > General | Live date/timestamp preview, persisted browser-local preference choices; honest native-input and UTC filter explanation. |
| Settings > Templates, PO invoice preview/accessible summary/PDF | All Classic/Modern/Compact layouts format PO/expected dates from an explicit snapshot. Saved financial amounts/layout algorithms unchanged. Gallery and open preview subscribe; export uses current displayed pages. |
| PR preview/accessible summary, template gallery and searchable/image PDF | All layouts format receipt/PO/expiry dates. Saved quantities/history/models unchanged. Reflow uses existing text measurement/wrapping; PDF consumes the identical SVG pages, including searchable glyph positioning. |
| Settings > Role URLs and Primary Domain | Verification/challenge timestamps use selected presentation (seconds retained); expiry comparisons and verification semantics unchanged. |
| Settings communication/message templates, theme, export and appearance panels | No independent calendar metadata found outside General/Templates/Role URLs. User-authored message bodies and literal sample substitution are content, not a portal formatter; offline/inert preview boundaries stay intact. |
| Dashboard, Masters landing, Orders placeholders, public portal/login/recovery/not-found, MR home | No currently implemented calendar date/timestamp display. Auth expiry/security calculations remain machine operations, not formatted display. |
| Shared tables, dialogs, filters, tooltips, profile shell | Dates are supplied by the owners above; no independent browser-default date formatter remains. `<time dateTime>` stays canonical. |

## Reviewed source-check exceptions

`tests/date-display-guard.test.mjs` scans all portal source, not just the routes
that changed. It rejects date locale primitives outside the pure formatter,
unapproved UI ISO formatting, direct date-property JSX and bare date table
renderers. Mutation tests prove representative new bypasses are rejected.

The expression-specific allowlist covers existing Kolkata business-date
generation/validation, numeric currency grouping and four UTC reporting filter
validation/API expressions. It does not exempt a whole page or service.
Canonical serialization in service/auth layers is allowed; this check is a
focused presentation guard, not a general data-flow proof. Review dynamic
field maps and newly introduced helpers during code review rather than adding
broad exemptions.

## Verification boundaries

Pure tests cover every supported date format, both clocks, supported explicit
zones and browser default, midnight, both New York DST transitions, offsets,
invalid/missing input and calendar-only stability. Renderer tests exercise every
PO/PR layout and date style, preserving source models and saved amounts/quantities.
The authenticated Chromium journey covers General, a master, server procurement,
native ISO controls, stock history/report, UTC-filtered activity, browser-local
receiving, accessible documents, searchable PDF dates, mounted preference updates,
gallery changes and reload persistence. Firefox/native Safari behavior and OS
print dialogs are not claimed by that focused Chromium check.
