# MR UUID presentation audit

## Scope and evidence

Source review only. No tests, browser automation, screenshots, builds, type
checks, release workflows, validation suites, API calls or runtime checks were
run for this change. Runtime behavior has **not** been verified.

The inventory follows `src/mr/MRWorkspace.jsx` routes and
`src/mr/LiveOrders.jsx` into the shared order screens. File paths below are
relative to `artifacts/evexia-portal/` unless stated otherwise.

This presentation rule supersedes the earlier contact-masking non-goal of
keeping record IDs visible: application-generated UUIDs must not be shown to
MRs. It does not change contact masking, authorization, stored identities or
business numbering. User-authored text, filenames and uploaded bytes are not
redacted.

## Removed MR exposures

| Surface | Source and original exposure | MR presentation after change |
| --- | --- | --- |
| Lupin saved review | `src/pages/admin/LupinOrderFormPage.jsx`, `Review`: `order.doctorId` and `order.mrId` below historical names | Names remain; internal-ID spans render only outside MR context. |
| Lupin linked Patients | Same `Review`: each historical `p.id` below its name | Names remain; internal-ID spans are non-MR only. |
| Lupin selected Patients | Same file, `Form`: each selected `p.id` below its name | Names and named Remove actions remain; internal-ID spans are non-MR only. |
| Immunotherapy Patient choices | `src/pages/admin/ImmunotherapyOrderFormPage.jsx`: selected/cached and remotely searched labels interpolated `p.id` | Both label paths use the same MR label formatter: name (or neutral unavailable text) and the existing server-provided masked phone. Non-MR labels retain their original format. |
| Immunotherapy saved groups | `src/components/immunotherapy/ImmunotherapyOrderSummary.jsx`: Internal group fact | Internal group facts are non-MR only; readable Saved group ordinals remain. |
| Immunotherapy saved allergens | Same summary: Allergen identity fact | Allergen identity facts are non-MR only; saved names, concentrations, results and assigned suborder numbers remain. |
| Immunotherapy bottle preview/print | `src/components/immunotherapy/ImmPrintDialog.jsx`: Internal group UUID on bottle labels | MR output omits the internal-group prefix; original bottle ordinals and assigned suborder numbers remain. Admin output is unchanged. |
| SPT validation summary | `src/pages/admin/SptOrderFormPage.jsx`: amount error keys interpolated Patient UUIDs into visible button labels | MR labels resolve the already-selected Patient name, falling back to “selected patient”; no directory fetch. Non-MR labels are unchanged. |
| Immunotherapy error-label fallback | `src/pages/admin/ImmunotherapyOrderFormPage.jsx`: unknown error keys could be displayed verbatim | MR fallback is “Order field”. Known labels still use fields, names and group ordinals. Error keys and focus targets are unchanged. |
| Immunotherapy stale-save comparison | Same editor: `JSON.stringify(conflict)` and `JSON.stringify(v)` rendered entire saved/draft records with relationship, group, allergen and file UUIDs | MR uses `components/immunotherapy/ImmunotherapyConflictDetails.jsx`, an explicit named/clinical comparison with group ordinals, assigned suborder numbers and filenames. Non-MR retains raw JSON. Full conflict/draft objects and rebase controls are unchanged. |
| Kits save/upload failure notices | `src/services/serverKits.js`: appended UUID Request reference | MR notices omit that suffix, retaining recovery guidance and internal request metadata. Actor context is captured before the asynchronous operation, so session expiration does not reintroduce the reference. |
| Kits/Immunotherapy private-file failure notices | `src/auth/adminSession.js`, `immunotherapyFileRequest`: appended UUID Request reference | MR notices omit that suffix; private-file IDs, request IDs and machine error codes remain internal. Non-MR suffixes and Lupin's separate retry contract remain unchanged. |

## Routed surfaces reviewed and safe cases retained

| MR section or shared surface | Source review result |
| --- | --- |
| Shell, profile menu, Settings identity | `MRWorkspace.jsx`, `Screens.jsx`, `auth/displayIdentity.js`: saved name and actual username/account number, not user UUID or `mr_id` fallbacks. Accessible profile label uses that same account presentation. Account numbers such as MR-004 remain. |
| Dashboard and Targets | `Screens.jsx`, `services/mrWorkspaceDemo.js`: financial figures, milestones and fictional activity; no generated UUID interpolation. |
| My Doctors list and grid | `mr/Doctors.jsx`: names, Doctor numbers (such as DR-001), registration numbers and masked contact displays. UUIDs appear only in keys and navigation destinations. Zone/HQ filter option values are internal, while labels are names. |
| Doctor detail | Same file: named/business/demographic/address facts, including assigned MR name; no ID fallback. |
| Doctor creation | Same file and `components/admin/DoctorForm.jsx`: fixed authenticated MR input uses name, derived Zone uses name. IDs still drive assignment and save. Existing contact entry and validation are untouched. |
| Doctor import route | `pages/admin/DoctorImportPage.jsx`, `services/serverDoctors.js`: MR-specific guidance, row numbers, names, registration/commercial values and import messages. No directory export action is offered here. The existing CSV/XLSX sample download uses a fixed filename. Source review of `artifacts/api-server/backend/app/services/doctor_transfer.py`, `sample`, found fixed example values and a username placeholder, not a generated UUID. Import reports preserve supplied user text. |
| Payments list/detail/form/review/acknowledgement | `mr/Payments.jsx`: references such as `demo-payment-a` and `demo-order-a` are legitimate fictional demo reference strings, not UUIDs. They remain visible. Doctor choices use names; no live order relationships are introduced. |
| Orders landing, navigation and missing pages | `mr/LiveOrders.jsx`, `mr/OrdersNavigation.jsx`: static order-type labels and neutral missing-page copy. IDs remain in route parsing only. Inactive `mr/Orders.jsx` demo implementation is not routed and is unchanged. |
| SPT listing | `pages/admin/SptOrders.jsx`: business order number, names, date, count, amount, status; action accessible text uses order number. |
| SPT form/review/selected table | `pages/admin/SptOrderFormPage.jsx`: existing Patient `code` (PAT/business or SPT registration number), name, demographics, totals and named actions. Preview uses `code`, not `id`. UUID amount-error label corrected above. |
| Kits listing and saved summary | `pages/admin/KitsOrders.jsx`, `KitsOrderFormPage.jsx`: business order number, product summary, names or neutral absence text, saved shipping and demographic/contact facts; no UUID fallback. Protected editor/pricing remains unavailable to MR. |
| Kits new form | Same form file: reference labels and fixed MR name; existing recipient entry, product quantities and price totals. No internal IDs as input display values. |
| Lupin listing and new form | `pages/admin/LupinOrders.jsx`, `LupinOrderFormPage.jsx`: business number, names, count, totals and statuses; named reference filters. Removed selected UUID spans are listed above. |
| Immunotherapy listing | `pages/admin/ImmunotherapyOrders.jsx`: business number, names, dosage, counts, saved value, shipping name, status, PO and review decision. Selection/action accessible labels use business order numbers. |
| Immunotherapy editor and conflict dialog | `pages/admin/ImmunotherapyOrderFormPage.jsx`: Patient labels and raw conflict/draft comparison corrected above; Doctor/MR/allergen options use names, saved groups use ordinals, allergen rows use saved names or “Saved allergen”. Suborder numbers remain. MR conflict comparison now uses explicit human-readable facts and version, with neutral missing-name text and no directory fetch. |
| Reference controls | `components/admin/SearchableSelect.jsx`, `KitsReferenceSelect.jsx`, `SptReferenceSelect.jsx`: separate non-display option values from text. Kits labels are names; SPT labels combine saved business `code`/Doctor number/Employee Code with name. SearchableSelect never falls back to option value when a selected label is missing. |
| Shared table/pagination/filter controls | `components/admin/DataTable.jsx`, listing callers: columns define display, UUID row keys are only React keys/test attributes. Pagination shows counts; filters use dates/status/name choices. No row-key-derived tooltip or accessible label. |
| Transfer controls and audit columns | `components/admin/OrderTransfers.jsx` returns no transfer actions for MR. `components/orders/orderAuditColumns.jsx` returns no audit columns for MR. No new export or metadata access was added. |
| Immunotherapy output actions | `components/orders/OrderPortalContext.jsx` already returns `documents: true` for MR. Existing listing bulk print supports eligible In process orders and fetches selected saved orders. `ImmPrintDialog` is therefore MR-reachable; its bottle UUID was suppressed. New/old box and shipping layouts use names, saved addresses, dates, business numbers and amounts, not UUID fallbacks. |
| Individual Immunotherapy document dialogs | `components/immunotherapy/ImmDocumentActions.jsx` and listing: existing template-unavailable notices use the business order number, no UUID or newly active output. |
| Attachments and prescriptions | `components/orders/OrderFiles.jsx`, `components/immunotherapy/PrescriptionViewer.jsx` and order callers: names, sizes, state and generic download/preview errors. UUIDs remain authenticated file references and verification/ownership values, not captions. Uploaded bytes and filenames remain untouched. |
| Status, error and recovery paths | Reviewed order service validators, Immunotherapy `saveErrors`/`labelFor`, SPT error summary, shared transport error construction and server order services. Confirmed UUID support-reference and error-key exposures are corrected above. Other guidance uses static text, structural field labels or business names; raw internal keys remain only focus/association data. |

## Source-only preservation review

- Lupin still submits `doctorId`, `mrId`, `patientIds` and attachment IDs, deduplicates
  selected Patients by ID, removes them by ID and navigates using saved order ID.
- Immunotherapy option values are still `p.id`; `choosePatient`, Doctor/MR
  assignment, group membership, allergen IDs, suborder values, mutation keys,
  expected versions, ownership checks and request payloads are unchanged.
- Print label keys still use order/group IDs. No permission, eligibility,
  fetching, print action or document-template behavior was added or changed.
- SPT retains UUID-based error keys and focus targets; only the displayed label
  is resolved from the already-loaded selected Patients.
- MR conflict comparison reads explicit presentation fields, but rebasing still
  uses the original complete `conflict` object and retains the unchanged draft.
- Support-reference suppression changes message text only. File verification,
  request metadata, ambiguity handling and unchanged-save recovery remain intact.
- No changes were made to contact masking or authoritative historical snapshots.
  Existing server-provided contact displays remain in use, including masked
  Immunotherapy Patient phone labels.
- Lupin MR saved attachment viewing, Kits MR/protected saved attachment viewing,
  Immunotherapy saved prescription viewing and all upload/download restrictions
  remain unchanged.
- Non-MR branches preserve the prior spans, facts, labels, print content and
  support references. No database, API contract, numbering, migration or
  deployment change was made.

These conclusions are based on source inspection, not observed runtime results.
