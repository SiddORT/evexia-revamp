# Threat Model

## Project Overview

EVEXIA is a React/Vite browser-local demonstration of role login screens and an Admin workspace. The Admin screens are directly accessible without login. Master records, including patient, staff and vendor fields, live in browser localStorage. The separately running Express scaffold API is not used by the portal. This is **not** a clinical or production data system.

## Assets

- Browser-local patient and contact records: names, addresses, phone numbers, email addresses and patient-related details would be sensitive if real data were entered.
- CSV exports and selected CSV/Excel files: downloaded copies leave the browser and can disclose data or execute spreadsheet formulas if opened in spreadsheet software.
- Record integrity: local edits and imports must not silently overwrite another tab's changes or corrupt records.
- Typed login passwords: held transiently in React state for a mock form, not authenticated, sent or saved; users must not type actual credentials.

## Trust Boundaries

- **Visitor to Admin route:** there is no authenticated boundary. Anyone with access to this origin/browser can open the Admin routes directly, and other scripts on the same origin can read localStorage.
- **File picker to browser parser to localStorage:** imported files are untrusted. Client-side validation limits accidents, not a malicious user with dev tools.
- **Browser to downloaded file/spreadsheet application:** CSV escaping is required to mitigate formula execution; downloads are not protected by access controls.
- **Portal to scaffold API:** the portal does not call the API. The scaffold is a separately reachable service and must not be mistaken for an authenticated data backend.
- **Preview to a future deployment:** HTTPS, response headers, origin isolation, logging, secret handling and server authorization have not been assessed for a production deployment.

## Scan Anchors

- Portal routes: `artifacts/evexia-portal/src/App.jsx`; common Admin shell: `src/components/admin/AdminLayout.jsx`.
- Browser-local data/import/export: `artifacts/evexia-portal/src/services/`, especially `masterImport.js`, `mockExcelImport.js`, `patients.js`, `staff.js`, `vendors.js`.
- Mock login: `artifacts/evexia-portal/src/components/auth/LoginForm.jsx`; separate API: `artifacts/api-server/src/app.ts`.
- No protected Admin route or authenticated API exists; the mockup sandbox and API scaffold are separate from the portal's data flow.

## Threat Categories

### Spoofing and elevation of privilege

The mock login grants no identity. Admin, staff, MR and doctor labels are visual only. A future real system MUST enforce authentication and per-record role authorization on a server for every sensitive operation; a client-side route guard or localStorage flag is insufficient.

### Tampering

LocalStorage and imported files are controlled by the browser user and same-origin scripts. Snapshot checks, schema validation and atomic batch writes reduce accidental damage, but cannot establish integrity or non-repudiation. A real system needs server-side validation, durable transactions and controlled access.

### Repudiation

The displayed `Admin User` audit attribution in local records is a placeholder, not an authenticated actor or trusted audit trail. A real system needs server-generated actor identities, timestamps and tamper-resistant audit events.

### Information disclosure

Any user of the browser profile, same-origin script or downloaded CSV can access data. Clearing browser data can destroy it. No real patient/health, staff or vendor personal data should be entered. A real system needs protected storage, retention/deletion policy, access review, transport encryption and a deployment configuration review.

### Denial of service

CSV files have a 2 MB parser boundary and 1,000-row limit; the Excel preview limits input size, ZIP entry count, per-entry expansion and rows. Browser storage quota and render cost remain limited by the user's device; future server imports need independent byte/row/time limits and rate limiting.

### Injection

React escapes displayed fields and CSV exporters quote cells and prefix formula-like values; untrusted XLSX content is parsed as data, not evaluated by the portal. Test these properties across every export format before a real deployment, and enforce response security headers at the serving layer. No scan or static inspection can prove all browser and spreadsheet behaviors safe.