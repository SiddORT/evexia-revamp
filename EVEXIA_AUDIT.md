# EVEXIA Portal audit and remediation (preview scope)

This is a source review and focused verification, **not** an external penetration test, VAPT certification, compliance claim or production deployment review. Severity describes the consequence **if real data were put into this preview**, not a claim that a protected production system has been breached.

| Severity | Finding and evidence | Action / remaining risk |
| --- | --- | --- |
| **Blocker for real data** | Verified: `App.jsx` exposes `/admin` and all master routes without any session check; `LoginForm.jsx` validates locally and sends no request. | Login page and persistent Admin banner now explicitly say that access is not protected. Real authentication and server-enforced authorization are prerequisites, out of scope here. Do not input real credentials. |
| **Blocker for real data** | Verified: master services store records in localStorage and export plain CSV. Anyone using the same browser profile or same-origin script can read them; data can be cleared. | Admin banner warns against real patient/staff/vendor data. No encryption, controlled retention or trusted audit trail is possible with this storage model. Requires a protected backend and operational policy before real data. |
| **High if exposed as a backend** | Verified: the separate, unused Express scaffold uses unrestricted `cors()` and default JSON/urlencoded body limits; it has no portal data routes or portal login integration. | Do not attach patient/admin endpoints to it unchanged. Specify permitted origins, authentication, authorization, input/body limits and deployment logging before exposing clinical data. |
| **Medium** | Verified: file picker size checks existed for vendor/staff/patient CSV; direct `parseCSV` calls had no byte limit. XLSX expansion was limited per read but archive entry count was not. | Added a 2 MB parser limit and 256-entry XLSX archive limit; existing 1,000-row and 4 MB per-entry expansion limits remain. These are preview safeguards, not server upload limits. |
| **Medium** | Verified: CSV exporters quote values and prefix formula-like fields; imports have exact ordered headers, row validation and snapshot-guarded writes. React renders untrusted text as text. | Kept behavior and regression coverage. Spreadsheet apps differ: external validation of exported files is still required for a real release. A crafted browser-local value or same-origin script remains untrusted. |
| **Low / UX** | Verified: Vendor page-level “CSV template” remained despite an import-dialog template button. | Removed only the toolbar action. Rendered-markup regression test asserts import/export/add remain and the dialog retains its template/file picker/confirm controls. |
| **Low / accessibility** | Shared dialog focus cycle omitted textareas and could let Tab escape when focus moved outside the dialog. | Included textareas and out-of-dialog focus recovery, preserving Escape and focus restoration. `DataTable` now evaluates each row key once. These shared controls remain referenced by master pages. |
| **Low / maintainability** | Route inventory: landing, mock login roles, Admin shell, master lists/forms, imports and history views are registered in the flat Wouter switch. Import searches found every Admin component and every portal CSS file referenced; there was no demonstrably dead component/style to remove. The portal manifest contained many unused scaffold libraries. | Retained active UI, avoided blanket page rewrites, removed unused direct portal dependencies and updated the lockfile. Existing shared `AdminLayout`, `Dialog`, `DataTable`, `TablePagination`, `RecordDetails` and master hooks continue to serve their pages. Bundle still warns about a large single JS chunk; code-splitting is a performance recommendation, not a security fix. |

## Coverage and limits

- Service tests cover CRUD, corrupt/unavailable browser storage, stale snapshots, CSV formula-like values and atomic batch imports for the tested masters. No service suite exists for several other service modules; test coverage is not proof of safety. Page markup is checked for the Vendor action distinction; most page interactions are not covered by automated browser tests.
- Route/form code inspection found stable record-ID keys on Vendor list and keyed CSV row details. Some other imported data views use line/index keys; check identity when making those views editable. The shared dialog's focus handling is improved, but this is not a complete assistive-technology audit.
- Source searches found no `dangerouslySetInnerHTML`, `eval` or portal `fetch` path for imported content. This does not guarantee absence of XSS in all environments. No CSP or deployment security-header assessment is included; Vite development host allowances are not production hardening.
- The preview has no real Admin identity: local audit names and the profile menu are demonstrative. The menu now says “Demo Admin / Not signed in”; “Sign Out” only navigates to the mock login.
- Dependency audit, static scan and privacy/dataflow scan returned zero reported findings at review time; this is not a clean bill of health. The project has a lockfile, but a deployed environment, infrastructure settings and independent dynamic tests were not examined.

## Verification evidence

- `node --test artifacts/evexia-portal/src/services/*.test.js`: **93 passed** (including oversized direct-parser input).
- `pnpm --dir artifacts/evexia-portal exec node --test vendor-ui.test.mjs`: **1 passed**, rendering both the page and import dialog.
- `pnpm --filter @workspace/evexia-portal run build`: **passed**, with a large-chunk performance warning.
- Dependency audit, static scan and privacy/dataflow scan: **0 findings reported**; no external penetration test was conducted.
- See `threat_model.md` for assets, trust boundaries and required guarantees.

## Before any actual VAPT engagement

Define the intended production architecture, data classification and agreed testing standard/scope; implement a real authenticated and authorized backend with protected persistence; set and verify deployment headers (CSP, HSTS and related policies), HTTPS and origin boundaries; review dependencies against the deployed lockfile; then commission independent dynamic testing of role/record access, direct URLs, upload edge cases, CSV downloads, XSS, session expiry and audit trails using only approved test data. Reassess after remediation. Until then this portal is for synthetic preview data only.