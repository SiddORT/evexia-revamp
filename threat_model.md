# Threat Model

## Project Overview

EVEXIA is a React/Vite portal with a backend-authenticated Admin workspace and browser-local demonstration masters. Staff Management alone is an authenticated encrypted PostgreSQL directory; patient and vendor masters remain browser-local. Admin access checks the protected Super Admin and `admin.access`; staff operations independently require `staff.manage`. This is **not** a clinical or production data system.

## Assets

- Browser-local patient and contact records: names, addresses, phone numbers, email addresses and patient-related details would be sensitive if real data were entered.
- CSV exports and selected CSV/Excel files: downloaded copies leave the browser and can disclose data or execute spreadsheet formulas if opened in spreadsheet software.
- Record integrity: local edits and imports must not silently overwrite another tab's changes or corrupt records.
- Admin login password: held transiently in React state and sent to the same-origin FastAPI login route; it is not written to browser storage. MR/Doctor login forms remain mock-only. The Admin access token remains in memory; the rotating refresh token is carried in an HttpOnly cookie.
- Communication preview credentials: masked dummy-only app-password/API-key/access-token inputs are held only in the open form and cleared on save attempts, cancellation, type/channel changes, navigation/unmount and when the window loses focus or becomes hidden. No credentials are retained, logged, exported or sent. Saved provider/sender metadata is still browser-local and must be fictional.

## Trust Boundaries

- **Visitor to Admin route:** Admin UI routes verify the current backend identity and explicit Super Admin permission before rendering protected workspace content. This browser guard does not make browser-local records confidential or tamper-resistant: users with access to the browser or same-origin scripts can inspect or change its localStorage.
- **File picker to browser parser to localStorage:** imported files are untrusted. Client-side validation limits accidents, not a malicious user with dev tools.
- **Browser to downloaded file/spreadsheet application:** CSV escaping is required to mitigate formula execution; downloads are not protected by access controls.
- **Portal to backend API:** the portal calls same-origin `/api/v1/auth` through the API proxy for Admin login, current-identity verification, refresh, and logout. The API authenticates against PostgreSQL. This does not move browser-local master records to the API or provide server-side authorization for those local-only records.
- **Preview to a future deployment:** HTTPS, response headers, origin isolation, logging, secret handling and server authorization have not been assessed for a production deployment.
- **Communication form to localStorage:** an allowlisted, versioned metadata schema excludes all credential fields and rejects unknown saved keys. Endpoint URLs reject embedded credentials and all query/fragment data because secret parameter names vary by provider. No arbitrary headers or credential JSON fields are accepted, and no provider calls or messaging exist. This preview is not secure credential storage or WhatsApp onboarding.

## Scan Anchors

- Portal routes: `artifacts/evexia-portal/src/App.jsx`; common Admin shell: `src/components/admin/AdminLayout.jsx`.
- Browser-local data/import/export: `artifacts/evexia-portal/src/services/`, especially `masterImport.js`, `mockExcelImport.js`, `patients.js`, `staff.js`, `vendors.js`.
- Admin login/session: `artifacts/evexia-portal/src/components/auth/LoginForm.jsx`, `src/auth/AdminBoundary.jsx`, and `src/auth/adminSession.js`; API: `artifacts/api-server/backend/app/main.py`.
- MR/Doctor mock login remains separate from the protected Admin route and backend identity.

## Threat Categories

### Spoofing and elevation of privilege

MR/Doctor mock logins and browser-local staff labels grant no backend identity. The Admin route guard is based on backend-verified current identity and explicit `admin.access`; it is not sufficient authorization for future sensitive data operations. Every server-side operation must independently enforce identity, permission, and ownership. Local records remain controlled by the browser user.

### Tampering

LocalStorage and imported files are controlled by the browser user and same-origin scripts. Snapshot checks, schema validation and atomic batch writes reduce accidental damage, but cannot establish integrity or non-repudiation. A real system needs server-side validation, durable transactions and controlled access.

### Repudiation

The displayed `Admin User` audit attribution in local records is a placeholder, not an authenticated actor or trusted audit trail. A real system needs server-generated actor identities, timestamps and tamper-resistant audit events.

### Information disclosure

Any user of the browser profile, same-origin script or downloaded CSV can access data. Clearing browser data can destroy it. No real patient/health, staff or vendor personal data should be entered. A real system needs protected storage, retention/deletion policy, access review, transport encryption and a deployment configuration review.

### Encrypted staff directory

Staff names/emails/phones use maintained-library AES-256-GCM, random nonces and
versioned record/field-bound associated data. A separately keyed normalized-email
HMAC index enables uniqueness without a plaintext login email column. User hashes
remain Argon2id; the initial password is returned only on create and kept only in
a transient one-time display. All staff API responses are no-store; audits use
opaque IDs/actions/verified actors, not PII. No automatic create replay is allowed
after an uncertain network outcome, and stale writes preserve client drafts.

Application/operator compromise can decrypt staff data; field encryption is not
protection from authorized API readers, same-origin XSS, clipboard/download
disclosure or a compromised key manager. Keys must be independent of signing
credentials, securely retained with coordinated database recovery, and never
logged. Missing/mismatched keys or authentication failures reject staff operations
without local fallback; existing login does not require staff key configuration.
Staff is linked to an unmapped User, never to a privileged role; business role
and local designation labels are not authorization. Staff credentials cannot sign
in in this phase. Local legacy staff remains untouched and is not rendered or
silently imported. Import/mail/reset/deletion are unavailable. This implementation
does not claim production deployment approval, compliance or VAPT certification.

### Denial of service

CSV files have a 2 MB parser boundary and 1,000-row limit; the Excel preview limits input size, ZIP entry count, per-entry expansion and rows. Browser storage quota and render cost remain limited by the user's device; future server imports need independent byte/row/time limits and rate limiting.

### Injection

React escapes displayed fields and CSV exporters quote cells and prefix formula-like values; untrusted XLSX content is parsed as data, not evaluated by the portal. Test these properties across every export format before a real deployment, and enforce response security headers at the serving layer. No scan or static inspection can prove all browser and spreadsheet behaviors safe.

## Backend authentication and separate data foundation

### Assets and trust boundaries

- The API backend stores authentication/session state, protected system and MR identities, minimal patient assignment records, file metadata, audit events, download grants, and private uploaded bytes. Files and their metadata can contain sensitive personal/health information. The portal currently uses the API for Admin authentication only; local prototype data and mock logins are not API identities.
- An authenticated request crosses the network/API boundary, then a database authorization boundary, then (for files) a separate private object-storage and scanner boundary. Database/object writes do not share a transaction. A stale database row, untrusted object, compromised operator, missing scanner, or lost object can all affect integrity/availability.
- Only the protected singleton `super_admin` and active `mr` identities may authenticate. The protected singleton is created by an explicit idempotent bootstrap after migrations using the operator-managed `SUPER_ADMIN_INITIAL_PASSWORD` only when creation is needed. Missing/invalid initial configuration or a reserved-identifier conflict blocks first creation for operator review; rerunning after successful creation does not rotate credentials or settings. Existing organization memberships are not automatically migrated; legacy/unmapped users remain denied. Privileged provisioning is audited and cannot create another protected Super Admin through normal user-management paths.
- `POST /api/v1/auth/register` is disabled in the current implementation even if its legacy configuration field is enabled. Same-origin Origin checks protect cookie flows; HTTPS, explicit CORS allowlists, signing-secret custody, deployment access policy, and account provisioning remain operator responsibilities.

### Authentication, authorization, and audit risks

Access tokens are short-lived signed bearer credentials; refresh credentials are opaque, rotating HttpOnly/SameSite cookies and session hashes are stored in PostgreSQL. Compromise of a bearer token permits actions allowed to its mapped identity until expiry/revocation checks apply. Store any future browser token only in memory; never localStorage. Password changes and identity changes revoke/version sessions. Password reset/delivery is not implemented.

Preview regressions authenticate with a synthetic protected Super Admin in a private ephemeral PostgreSQL/API fixture and verify `/me` through the actual same-origin API proxy. This fixture is not a live-deployment credential or a test against a managed database. If the live API has no protected account and its initial bootstrap secret is unavailable, live authenticated preview validation is blocked; do not claim it passed or seed the managed database with synthetic test credentials.

Every protected domain/file operation must validate the current identity, role/permission and ownership in the database; do not trust UI role, organization/owner IDs, guessed UUIDs, old mappings, request metadata, or stale grants. MR authorization is limited to their own MR profile and currently assigned active patients. A patient can have at most one active MR assignment. Permission is repeated after slow I/O and for local grant redemption. Audit rows provide operational history but are not a tamper-proof external audit service; protect, retain and monitor them according to a defined policy.

Request logs intentionally exclude request bodies, filenames, storage keys, grant tokens, signed URLs, credentials, exception strings, and SQL parameters. Uvicorn's raw access logger is disabled; structured logs use matched route templates and redact grant-token paths. `X-File-ID` is included after an accepted file reservation on success and later processing errors, allowing an authorized operator to reconcile an interrupted upload without replaying it. Re-upload is not an idempotency replay: every retry reserves a new immutable ID. Operators should use request IDs and opaque file IDs for triage and must not add personal data or filenames to logs/tickets. Error responses use a fixed machine-readable envelope; validation fields are bounded identifiers and never echo submitted values.

### File integrity, scanner, storage, and recovery

Only JPEG/PNG/PDF uploads, explicit ownership/category, raw bounded bodies and generated immutable logical keys are supported. The backend checks actual byte count, signatures/format, declared content type, parser limits and SHA-256. Upload is not readable until a trusted malware scanner returns clean and final identity/ownership/version checks pass. The default scanner is `unavailable`; no mock scanner is enabled in service settings. Scanner absence/timeouts/errors remain quarantined; do not bypass verification or turn on clamd without a real managed, updated, network-restricted scanner.

The state machine distinguishes uploading, quarantined, verified, rejected, pending deletion and tombstone states. Only verified/clean content is downloadable. Replacement is version-checked and writes a new object; old content is retained until verification. Since object storage and PostgreSQL cannot commit atomically, a replacement can be published while old-object cleanup fails, and interrupted writes/deletes may remain pending. Explicit errors are not success; reconcile using authenticated ID-based APIs, and only reverify quarantined bytes after scanner recovery. SQL recovery queries should select opaque IDs/state/version/timestamps only, never filenames, paths or content. Do not manually edit file states or delete objects based on database age alone.

Local storage requires an explicit private path and correct restrictive OS ownership but is not durable in a published Replit app: Replit's published filesystem resets on restart/publish. Durable storage, backup/restore, retention/deletion, quota monitoring, reconciliation and restoring database/object consistency are operator-owned. The current local default is development convenience, not a production persistence guarantee. The opt-in S3 adapter uses the same logical keys and SHA-256 metadata, but switching adapters requires paused writes, checked copies and inventory/hash comparison; an operator must plan rollback/copy-back because there is no shared transaction. Presigned S3 URLs remain bearer capabilities until expiration and cannot be immediately revoked by later reassignment/deletion.

### Denial of service and data-loss boundaries

Configured defaults include a 20 MiB actual upload limit (configurable to at most 100 MiB), a 1 MiB non-upload request-body boundary, a 30-second file request deadline, a 10-second scanner deadline, 30 file operations per identity per rolling 15 minutes and four concurrent file operations globally across workers via PostgreSQL advisory slots. Settings enforce bounded values, but deployment-level request limits, database capacity, storage quotas, scanner capacity, monitoring and alerting still need review. No automatic retention, cleanup, reconciliation, or backup process is provided.

Migrations are explicit Alembic steps; never use startup DDL. Legacy records are not automatically assigned to new domain identities. Downgrade is not guaranteed to restore an application release or external objects and may remove schema/data. For migration failure, stop writes, preserve and verify database/object backups, inspect the schema/data state, and prefer reviewed forward correction or an explicitly verified restore. Do not deploy migrations or rely on manual production rollback without owner review.

### Backend scan anchors and official platform reference

- `artifacts/api-server/backend/app/main.py`, `app/core/config.py` — middleware, fixed error/log policy, request bounds and runtime settings.
- `app/api/v1/auth.py`, `app/api/v1/domain.py`, `app/api/v1/files.py`; `app/api/deps.py` — endpoints and per-request authorization.
- `app/services/auth.py`, `app/services/domain.py`, `app/services/files.py`, `app/services/file_policy.py`, `app/services/storage.py`, `app/services/verification.py` — identity lifecycle, ownership, persistence boundaries, storage and scanning.
- `app/operator.py` — explicit trusted identity mapping; not exposed as an API.
- `scripts/export-api-contract.py`, `lib/api-spec/openapi.yaml` — offline generated API contract; `app/services/staff*.py`, `app/schemas/staff.py`, `app/db/staff_models.py` and migration `0009_staff` cover encrypted staff persistence.
- Replit publishing and app-storage durability claims are based on the official [Publishing](https://docs.replit.com/learn/projects-and-artifacts/replit-deployments), [App Storage](https://docs.replit.com/features/data-and-storage/object-storage), and [shared responsibility](https://docs.replit.com/features/security/shared-responsibility-model) documentation. Verify current platform behavior during deployment review.