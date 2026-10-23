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
- Do not format dates in ordinary JSON APIs, storage, sorting, business validation,
  filenames/identifiers, `<time dateTime>`, raw import-review source cells, recovery
  archives or other machine metadata. Human-facing CSV/XLSX downloads now **do**
  use General settings, including when the file also serves as an import source.
  Such calendar columns carry explicit format context; never guess day/month order.
- Date-display work normally uses the existing date-preference checks. The export
  settings expansion was explicitly restricted to source inspection: no tests,
  builds, regression/release checks, browser automation, CI or workflow restarts
  were added or run for it. Runtime behavior has not been tested.

## Implemented route and shared-surface inventory

| Area | Classification and reviewed presentation |
| --- | --- |
| Zone, Headquarter, Storage Location, Product Category, Designation, Courier Partner and Vendor masters | Created/updated instants in tables, cards and detail/audit helpers use the shared timestamp formatter; subscribed page owners. Their create/edit forms have no independent displayed date strings. |
| Allergen master, form and import | Shared audit timestamps (seconds retained); prices and reference details are not dates. No native picker replacement. |
| MR, Doctor, Patient and Staff masters/forms | DOB/joining dates are calendar-only, audit values are instants; expanded profiles and mobile paths use the same helpers. ISO form values and age/business validation are unchanged. |
| Opening Balance master/form/import | Audit instants formatted with subscribed form/page; financial year start/end are year identifiers, not calendar dates. |
| Sales Target master/import | Shared audit instants; annual/quarter identifiers are accounting periods and remain unchanged. |
| All master import routes and shared Excel/CSV import review | Raw source cells describe the supplied file and remain untouched. At server import parsing, declared calendar formats are decoded to ISO before existing business validation. Canonical storage and machine metadata remain unchanged; human CSV/XLSX exports follow the contract below. |
| Doctor payment history | Payment dates are calendar-only. Live payment history and Patient Dosage History are currently placeholder surfaces without implemented date records. |
| Purchase Orders list, mobile cards, activity, create/edit review and detail | PO/expected dates are calendar-only; activity/created/updated/deleted values are instants. Form input values, date filtering and server amounts unchanged. |
| Purchase Received list, mobile cards, create/edit review, detail, activity and linked PO receiving panel | Receipt/PO/expiry dates are calendar-only; history metadata are instants. These remain explicitly browser-local, separate from server POs. |
| Move Stocks list, product dialog and form | Movement date is calendar-only; control values remain ISO. No ledger/business-date behavior changes. |
| Stock Status list scope, history detail and inventory report/print | Business-day/year boundaries/history dates are calendar-only; server snapshot `asOf` and generated time are instants. Printed DOM uses exactly the displayed formatted text. CSV localizes its snapshot timestamp and labels the effective time zone. |
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

## Human export inventory and transfer contract

This is the implemented-action inventory, not a list of every legacy serializer
that happens to exist in source. No new export buttons or placeholder workflows
are introduced.

| Implemented action / owner | Date-bearing fields and handling | Import compatibility |
| --- | --- | --- |
| Zone / `zone_transfer.py`; Courier Partner / `courier_transfer.py`; Storage Location / `location_transfer.py` | CSV/XLSX Created At and Updated At are instants, localized with seconds. | Existing minimal and full backup schemas still accepted; audit fields remain ignored on create. |
| Designation, Vendor, Headquarter, Product Category, Allergen, Opening Balance, Sales Target / corresponding `*_transfer.py` | CSV/XLSX Created At and Updated At are instants. Accounting/financial year identifiers are not dates. | Existing legacy/full/sample schemas and business validation retained; imported audit values never become authoritative. |
| MR / `mr_transfer.py` | Date of Joining is a calendar date in CSV/XLSX; existing XLSX audit timestamps are instants. CSV does not gain audit columns. | Joining-date format is explicit in the header; old ISO files and supported historical column sets remain supported. Manager/zone identity and exact payment limits unchanged. |
| Doctor / `doctor_transfer.py` | Date of Joining is calendar-only; Created At / Updated At are instants. | Explicit calendar context, legacy ISO support, unchanged create-only audit, assignments and decimal validation. |
| Patient / `patient_transfer.py` | Date of Birth is calendar-only; Created At / Updated At are instants. | Explicit calendar context, original 17-column and later ISO backups remain accepted. DOB/age constraints unchanged. |
| Opening Stock / `opening_stock_transfer.py` | Recorded date is calendar-only. Source/row/item/location IDs and location guidance are not presentation dates. | Explicit calendar context decoded before the existing opening-date validation. Exact quantity/rate XML extraction and portable file limit retained. |
| Language / `language_transfer.py` | No date columns. | Unchanged. |
| Staff Management / `staff.js` | Browser CSV Date of Joining is calendar-only. | No implemented staff CSV import action; none added. |
| Stock Status / `serverInventory.js` | Browser CSV As of is a server snapshot instant, with seconds and the effective zone in its heading. | Report only; no CSV import action. |
| Purchase Received / `purchaseReceived.js` | Browser CSV Received Date, PO Date and Expiry Date are calendar-only. Historical empty expiry stays empty. | Report only; no PR CSV import action. |
| Lupin / `lupinOrdersDemo.js` | Offline browser CSV order Date is calendar-only. | Session-only/offline boundary retained. |
| Kits/Consumables / `kitsTransfers.js` | Shared CSV/XLSX captures one date-preference snapshot and declares its date context. | Server review validates date-only inputs; existing saved dates remain immutable. Historical personal snapshots and file metadata are preserved, never file bytes. |
| Sessions / Activity / `reportingCSV.js` | Browser CSV login/refreshed/expires/revoked/occurred values are instants, with seconds. Headings use the effective exported zone rather than always UTC. | Report only. Safe reporting allowlists, privacy, limits and authorization unchanged. Server JSON remains ISO/UTC; UTC filter controls still select the same instants. |
| PO invoices / `poInvoiceTemplates.js`, `poInvoiceRender.js`, `poInvoicePdf.js` | PO and expected dates are calendar-only in Classic/Modern/Compact SVG, accessible summary and PDF. | Already shared document pages; retained, with explicit resolved-zone snapshots. No PO CSV action exists. |
| PR receipts / `prDocuments.js`, `prReceiptRender.js`, `prReceiptPdf.js` | Receipt, PO and batch expiry dates are calendar-only in all layouts, accessible summary and searchable/image PDFs. | Same captured document/pages used for preview and download; no financial/quantity recalculation. |
| Settings template gallery / `POTemplateSettings.jsx` | Fictional PO/PR sample PDFs use the same document contract as previews. | Template choices are not record imports. |
| Inventory print / `StockStatusReport.jsx` | Snapshot and generation instants share one validated resolved snapshot per rendered report, seconds and truthful zone captions. | Native print consumes the displayed DOM, not a second independently formatted document. |
| Immunotherapy print / `ImmPrintDialog.jsx` | Historical order calendar dates share one validated snapshot per rendered label sheet. Shipping addresses and authored dosage content are untouched. | Native print consumes the displayed labels. |
| SPT, Move Stocks, Download Logs and other placeholders | No additional implemented date-bearing download action found. | None added. |
| Private file download/issuance | Existing uploaded PDFs/images are attachments, not generated EVEXIA date presentations. | File bytes are intentionally unchanged. |

### One snapshot per file

- Browser CSV owners capture `captureExportPreferences()` **before** asynchronous
  work; pure serializers receive that immutable object. Direct document actions
  capture before fetching data; preview downloads retain their displayed pages.
- The snapshot validates the saved date/clock/zone options and resolves Browser
  default to its actual IANA zone once. In-memory settings retained after a
  failed local-storage write remain usable. Subsequent exports read preferences
  again; none reread them during file generation.
- Shared authenticated master/opening-stock transports send the immutable
  `X-Evexia-Export-Display` JSON header with exactly `dateFormat`, `timeZone`
  (resolved, never the word `browser`) and `clock`. The server validates it into
  a frozen request-scoped object; malformed context fails with 422. This is a
  file-presentation header, not an account/organization preference or mutation.
- `export_presentation.py` decorates only implemented transfer **export**
  boundaries. It formats date columns after canonical serialization and before
  existing route download handoff. Ordinary JSON, samples, imports and stored
  values do not pass through this formatting path. API callers without the header
  retain the historical canonical backup contract.
- CSV non-date cell values retain their existing escaping and exact text.
  XLSX date cells are serialized as text so Excel cannot apply its device locale,
  drop seconds or reinterpret time zones. Only targeted worksheet date cells are
  replaced; non-date monetary XML lexemes, IDs, styles and formula protections
  are not round-tripped through floating-point workbook parsing.
- Missing dates become empty file cells. Invalid calendar values or ambiguous/
  invalid timestamps display `—`, never today's date, a shifted day or raw input.
  Calendar values are never converted through the selected time zone.
- Server audit headings identify the effective zone, for example
  `Created At (Asia/Kolkata)`. Reporting JSON still has its canonical UTC headings;
  the browser validates those before producing localized CSV headings.

### Explicit re-import context

Calendar headers in re-importable server exports carry their actual display
format, for example `Date of Joining [EVEXIA date=dd-mm-yyyy]`. There are no
additional data columns, credential fields or per-row metadata. The supported
format IDs are the existing General options: `dd-mmm-yyyy`, `mm-dd-yyyy`,
`dd-mm-yyyy`, `yyyy-mm-dd`.

Import parsers decode only explicitly marked calendar headers, require exact
matching syntax and real dates, restore ISO **before** the existing schema,
business, bounds and conflict validation, and never infer day/month order from
the importer's current settings. Recognized zone suffixes on informational
audit headings are removed before the original strict schema validation; audit
cells remain ignored and fresh creation metadata is assigned by the server.
Unmarked old ISO files and ISO sample/templates remain valid. Unsupported/
unknown/reordered schemas are still rejected. Raw source bytes, reviewed-byte
digests and create-only semantics are unchanged.

### Source-only delivery boundary

The export expansion was reviewed by reading source and diffs only. **Runtime
behavior has not been tested.** No tests were added or executed, and no build,
validation wrapper, regression/release check, browser automation, CI run,
workflow restart, deployment, database change or live-data mutation was performed.
The historical verification descriptions below do not verify this expansion.

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

Opening Stock has one reviewed numeric exception:
`services/openingStock.js:BigInt(digits).toLocaleString('en-IN')`.
It groups exact integer currency digits using Indian grouping, not dates. Only
that file/expression pair is approved; changed receivers, arguments, locales or
paths need separate review. Date locale calls, raw date JSX and bare date table
renderers in that service remain subject to the guard. UI ISO rejection remains
scoped to JSX/TSX files; canonical service serialization is unchanged. The
exception does not change BigInt arithmetic, half-up two-place unit rates or
unrounded opening values.

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

### Source-only CI guard repair handoff

The reported CI screenshot shows the date-preference command ending with 69
tests, 68 passing and one failing, but omits the individual assertion. Source
inspection identifies the previously unapproved Opening Stock numeric call as
a guard violation; it does not confirm the exact CI failure. No exact-run log
was available locally. The exception and focused boundary cases were reviewed
as source only, without executing tests, builds or validation wrappers.

Separate approval is required before executing either verification option:

- Guard only (from the repository root):
  `node --test artifacts/evexia-portal/tests/date-display-guard.test.mjs`
- Existing date-preference suite:
  `pnpm --filter @workspace/evexia-portal run test:date-preferences`

Neither command was run for this repair. Full exact-commit release validation,
CI reruns, pushes, publishing and deployment remain separately authorized work;
this source change is not evidence of green CI or successful deployment.
