# EVEXIA backend foundation

This FastAPI modular monolith supplies authoritative authentication for the
existing EVEXIA Admin login and protected workspace. MR and Doctor login screens
remain mock previews. Staff Management is now an authenticated, encrypted
PostgreSQL directory with unmapped credentials; Zone Master is shared server
persistence with soft deletion and authenticated audit history. Courier Partner Master
is separate shared server persistence with its own table and endpoints. Storage Location Master
uses another separate shared name/address/status table and endpoints, while Allergen/PO/PR
location datasets remain browser-local. Other portal masters remain
fictional and browser-local. Do not enter real personal or health data into the
preview. See [staff security and operations](../../../docs/staff-security.md).
See [Zone Master operations and transfer contract](../../../docs/zone-master.md)
for its endpoints, limits, duplicate policy and unchanged local-demo assignments.
See [Courier Partner operations](../../../docs/courier-partner-master.md) for its
5,000-row export bound, 2 MiB/1,000-row import limit and explicit legacy-backup import.
See [Storage Location operations](../../../docs/storage-location-master.md) for
its exact three/seven-column backup schemas, audit/deletion evidence, limits,
explicit migration and unchanged local-demo purchasing relationships.

## Local development and operations

- Workspace Python dependencies are managed by `pyproject.toml` and `uv.lock`
  (Python 3.13). The managed `artifacts/api-server: API Server` workflow serves
  FastAPI under `/api` on port 8080.
- The development environment supplies the managed PostgreSQL `DATABASE_URL`.
  Configure `JWT_SECRET` in Replit Secrets with at least 32 characters, or use
  the existing `SESSION_SECRET` fallback. Never place credentials in this
  example file, source control, command arguments, or request logs.
- Run the isolated backend foundation suite with `pnpm run test:api-foundation`.
  It starts an ephemeral PostgreSQL instance bound only to a private Unix socket,
  uses a synthetic test database/signing key, and never reads/uses a configured
  database URL. PostgreSQL runtime tools (`initdb`, `pg_ctl`, `createdb`) and
  `python3` must be available. For direct `pytest`, set `TEST_DATABASE_URL` to a
  disposable PostgreSQL test database first; never point tests at development or
  production data.
- Migrations are explicit: `cd artifacts/api-server/backend && alembic upgrade
  head`. Never create tables at startup. After migrations, explicitly run
  `PYTHONPATH=. python -m app.bootstrap` from the backend directory. Bootstrap
  reads `SUPER_ADMIN_INITIAL_PASSWORD` only when no protected account exists,
  creates the reserved singleton once, and is safe to repeat; later runs need no
  initial secret and never reset credentials or security settings. Missing or
  invalid secret on first creation fails without a fallback. Conflicting reserved
  identities and pre-existing Super Admin mappings require operator review;
  migrations never silently elevate an account. The initial password belongs
  only in the managed backend secret store, never source, SQL, command arguments,
  logs, seeds, or generated documentation. Do not run production migration or
  downgrade commands manually; review the managed publish schema operation and
  take a backup first. The current ordered migrations are `0001_identity_foundation`,
  `0002_optional_username`, `0003_system_identity_domain`, `0004_private_files`,
  `0005_protected_super_admin_sessions`, `0006_auth_sessions`,
    `0007_reporting_indexes`, `0008_activity_search`, `0009_staff`,
    `0010_zones`, `0010_custom_roles`, `0011_courier_partners`, and `0012_storage_locations`. Zone, role, courier and location migrations create only empty tables. Staff migration
   adds an empty encrypted profile table and deferred identity-link integrity
   guards; it changes no existing identities, sessions or activity history.
   The activity search
  migration requires PostgreSQL `pg_trgm` and adds only safe reporting indexes,
  a versioned sanitizer function, and expression statistics. Reproducible
  synthetic plans and operational costs are documented in
  [the activity search measurements](../../../docs/activity-search-performance.md).
  A downgrade is not a general rollback plan: it can remove data/schema state and
  cannot reverse issued credentials, uploaded objects, or external side effects.
  Migration `0005` refuses to proceed over existing Super Admin mappings for
  explicit operator review and its downgrade refuses while the protected account
  exists. The PostgreSQL trigger/checks are practical integrity guards against
  accidental normal-service mutations. The bootstrap trigger's transaction-local
  setting is a coordination guard, not an independent authorization boundary: a
  caller with arbitrary SQL authority can set custom PostgreSQL settings. The
  trigger does reject promotion/update of an existing ordinary row, but operators
  must still prevent arbitrary SQL from inserting protected identities. These
  controls are not a defense against a database owner or arbitrary SQL/DDL
  authority: the runtime database role must not own tables or have privileges to
  disable triggers, truncate protected tables, or alter schema.
  Privileged SQL maintenance/trigger changes require a separately reviewed,
  audited procedure and backup; never bypass the application bootstrap/service.
  For a failed release, stop writes, preserve the database and object store,
  assess the migration and data state, then use a reviewed forward fix or a
  verified restore. No migration or deployment is performed by this README.
- Explicit first-time/deployment initialization order (supply the initial secret
  through the managed backend secret store before this command; the secret is not
  an argument):

  ```sh
  cd artifacts/api-server/backend
  alembic upgrade head
  PYTHONPATH=. python -m app.bootstrap
  ```

  Equivalently, from the workspace root run `sh scripts/initialize-api.sh`.
  This explicit operator command runs the same ordered migration/bootstrap steps
  and is exercised by the isolated authenticated-preview harness. The API process
  itself runs neither migrations nor bootstrap. Do not run this command against
  production without separate deployment approval, backups, and reviewed DB roles.

- Migration `0004_private_files` encodes owner/category/state/media/checksum,
  size/version and verified-clean constraints, plus generated-key-to-owner/record
  consistency, in PostgreSQL. Its downgrade drops file metadata but deliberately
  does not delete external objects; without a coordinated backup this can leave
  orphan objects. Back up and restore metadata and objects together.
- Public probes are `GET /api/v1/health`, `GET /api/v1/version`,
  `GET /api/v1/health/readiness`, and the unversioned `GET /api/healthz`.
  `/api/docs` and `/api/openapi.json` are disabled in production.

## Authentication and explicit identity operations

Registration (`POST /api/v1/auth/register`) is always unavailable in the current
implementation and returns 403; `ALLOW_PUBLIC_REGISTRATION` is retained as a
configuration field but does not enable account creation. Bootstrap initializes
only the protected system Super Admin. Trusted operators can create or map MR
identities, but cannot create or alter a Super Admin:

```sh
cd artifacts/api-server/backend
PYTHONPATH=. python -m app.operator --email mr@example.invalid --create --role mr --username field.mr
```

The command prompts for new passwords without echoing them. For an existing
non-protected account, omit `--create`; mapping it to `none` disables its system
role. This is a privileged, audited operator action—not a public API or bootstrap
secret. Role/activation changes increment identity/token versions and revoke
refresh sessions. Legacy organization memberships are retained; they are not
automatically converted into system roles, domain ownership, or access.
Unmapped legacy accounts cannot authenticate to the new system operations.

`POST /api/v1/auth/login` accepts `{ "identifier": "email-or-username",
"password": "...", "remember_me": false }`. It normalizes the identifier and
rate-limits failed attempts, including otherwise-valid credentials while blocked.
Login and refresh/logout require JSON and a same-origin `Origin` header. A
successful login returns a 15-minute bearer access token and sets a rotating
opaque refresh token in an HttpOnly, SameSite=Strict cookie. Production uses
Secure and a `__Host-` cookie. Keep access tokens in memory, never localStorage.
With Remember me off (default), the cookie is browser-session scoped and server
refresh expires after `SESSION_REFRESH_HOURS` (default 12, bounded 1–24). With it
on, the cookie is persistent only until the configured absolute
`REFRESH_TOKEN_DAYS` family expiry (1–30 days). Rotation preserves the original
absolute expiry and persistence mode; it does not extend a family. Logout revokes
the owning session and all its refresh credentials; already issued access JWTs
become unusable immediately. Password or identity changes likewise invalidate
sessions and tokens immediately through session state and database version checks.
`POST /api/v1/auth/logout` is the single self-logout operation for both Super Admin
and MR. It uses only the validated opaque refresh cookie to identify the cookie's
persisted session; request bodies, query IDs, bearer claims, and caller-supplied
identity/session identifiers are not authority. This narrow cookie-authenticated
operation does not require a still-valid access bearer: expired or malformed
bearers are ignored, rather than weakening bearer authentication on other routes.
The same-origin `Origin` check remains mandatory. Logout is safe `204` whether the
cookie is absent, unknown, malformed, expired, or already revoked, and never
reveals whether a submitted credential belongs to a session. It clears the cookie
with the matching name/path and HttpOnly, SameSite=Strict attributes; production
uses Secure, `Path=/`, and `__Host-evexia_refresh`. Session revocation and refresh
chain invalidation are committed together. Every protected request checks live
session state and user/session versions, so existing access JWTs fail immediately
after logout; replaying an old or rotated refresh credential cannot resurrect the
session. A logout audit event is recorded only for a meaningful session
termination, with safe outcome, request ID, actor and session ID; harmless absent,
unknown, malformed, and repeated logout requests do not create audit noise.
`GET /api/v1/auth/me`
requires bearer auth. `POST /api/v1/auth/change-password` requires a current
password of 1–128 characters, accepts a new password of 12–128 characters, and
invalidates the user's sessions/tokens. Safe authenticated identity responses
include explicit permissions, with `admin.access` only for the protected system
identity. Password recovery is not implemented. Never trust a UI role selector
or request-supplied organization ID for authorization: protected calls check
current database identity and permissions.

### Session lifecycle, rollout, and evidence

Migration `0006` adds `auth_sessions` as the current lifecycle authority and
links each historical refresh credential to exactly one session. It preserves
credential hashes and audit history, creates a **revoked** opaque session for
each pre-migration family, and revokes any still-active legacy credentials.
Old access JWTs have no `sid` and are rejected; users must sign in again.
Review the backup, migration preflight, and schema compatibility before rollout.
Deploy the migrated database and session-aware API together, and avoid serving
the old API against the new schema: old nodes cannot create session-bound
refresh rows. A rollback of application code alone is unsafe; migration `0006`
refuses downgrade while session history exists. Restore a verified coordinated
backup or use a reviewed forward correction instead. This project does not
execute production migrations or deployments automatically.

A login creates a cryptographically random, non-sequential session ID. JWTs
carry it as `sid` (an identifier, not a bearer secret). Every protected request
checks JWT signature, algorithm, issuer, audience, expiration, required claim
types, current user/role/profile and version snapshots, and session ownership,
status, expiry and versions. Sensitive services recheck under database locks.
The same session ID survives refresh; another login creates another session.
`ACTIVE` is valid only before its absolute expiry and while its identity remains
valid. An expired session transitions to `EXPIRED` on an authenticated access or
refresh observation, once. Revocation is immediate, including existing access
JWTs. Neither refresh nor activity extends the absolute lifetime. The browser
session cookie (Remember me off) may disappear sooner when the browser closes;
its server-side maximum remains `SESSION_REFRESH_HOURS`. Persistent Remember me
expires at `REFRESH_TOKEN_DAYS`. Access lifetime remains configured by
`ACCESS_TOKEN_MINUTES`.

Refresh resolves credential ownership from its digest, then locks User,
AuthSession, and credential in that order. Password/identity mutation and
sensitive file revalidation lock User first. A credential is consumed once and
linked to its replacement; presenting a consumed or revoked credential records
reuse and revokes its entire session and remaining family before returning 401.
This strict policy intentionally does not grant a retry grace period. Concurrent
requests can yield a success followed by replay revocation; the successor then
cannot authenticate. Expired/unknown credentials reject without issuing a
successor. Clients must serialize refreshes, as the existing portal does.

`GET /auth/session` and `/auth/sessions` use server-validated bearer context,
return only ID, effective status, creation/last-refresh/expiry times and the
persistence flag, and are no-store. The listing is bounded and filtered by
authenticated user ownership. No raw IP, user agent, token, digest, password,
Authorization header or cookie is persisted in session/event metadata.
Existing `audit_events` is append-oriented evidence, not session state:
login and refresh success/failure, session created/refreshed/expired/revoked,
credential rotated/reused/revoked, security change, and token/version rejection
events use bounded safe reason codes and request IDs. Unverified token claims
are not trusted actor IDs. External rejection remains a generic
`authentication_required` 401 with request ID; a blocked login remains 429.
Expiry observations are idempotent. A failed issuance rolls back rather than
returning a token.

Retention ownership remains an **unresolved operator/security policy
decision**: keep consumed credentials at least throughout their session's
replay-detection window, and preserve expired/revoked sessions and event
evidence until an approved retention, legal-hold and backup policy exists.
There is no destructive cleanup job or invented compliance period. Any future
purge must account for linked audit/credential rows and be separately reviewed.

## Current API surface

All versioned operations use the `/api/v1` prefix. The exported OpenAPI document
uses server URL `/api` and relative `/v1/...` paths, so it describes the same
artifact-mounted URLs. The development OpenAPI contract includes:

| Area | Method and path | Access and purpose |
| --- | --- | --- |
| Health | `GET /api/healthz` | Public liveness probe; stable generated `getHealthCheck` API and `HealthStatus` schema. |
| Health | `GET /api/v1/health`, `GET /api/v1/version` | Public service/version probes. |
| Health | `GET /api/v1/health/readiness` | Public database/schema readiness probe. |
| Auth | `POST /api/v1/auth/register` | Disabled; always returns unavailable registration (403). |
| Auth | `POST /api/v1/auth/login`, `/refresh`, `/logout` | Same-origin session operations. |
| Auth | `GET /api/v1/auth/me` | Bearer-authenticated identity. |
| Auth | `GET /api/v1/auth/session`, `GET /api/v1/auth/sessions?limit=20&offset=0` | Validated current session and paginated own-session metadata (limit 1–100, offset 0–10000); no other user's sessions. |
| Auth | `POST /api/v1/auth/change-password` | Bearer-authenticated password change. |
| Domain | `POST /api/v1/domain/mrs` | Super-admin provisions a mapped MR identity. |
| Staff | `GET /api/v1/admin/staff?limit=20&offset=0`, `GET /api/v1/admin/staff/{staff_id}` | Explicit `staff.manage`, protected Super Admin only; no-store decrypted directory responses. |
| Staff | `POST /api/v1/admin/staff` | Atomically generates User ID/Argon2id password hash and encrypted profile; initial password returned once. |
| Staff | `POST /api/v1/admin/staff/{staff_id}/edit`, `/status` | Immutable ID, mandatory `expected_version`, stale changes return 409. No credential reset or mail. |
| Storage locations | `GET/POST /api/v1/admin/storage-locations`, `GET /{location_id}`, `POST /{location_id}/edit`, `/status`, `/delete` | Protected Super Admin `admin.access`; name/address/status, mandatory mutation versions, soft deletion and authenticated audit metadata. |
| Storage locations | `POST /api/v1/admin/storage-locations/import/review`, `/import/commit`; `GET /export` | CSV/XLSX create-only review/confirm and full-filter download. Exact schemas and safety bounds in the Storage Location operations document. |
| Domain | `POST /api/v1/domain/mrs/{user_id}/mapping` | Super-admin maps an existing user to an MR profile. |
| Domain | `POST /api/v1/domain/patients` | Super-admin creates the minimal patient assignment record. |
| Domain | `POST /api/v1/domain/patients/{patient_id}/assignment` | Authorized administrator assigns or unassigns an MR. |
| Files | `POST /api/v1/files` | Authorized raw JPEG/PNG/PDF upload; ownership/category/filename are query fields. |
| Files | `GET /api/v1/files/{file_id}` | Authorized metadata lookup. |
| Files | `GET /api/v1/files/{file_id}/download` | Authorized verified-content stream. |
| Files | `POST /api/v1/files/{file_id}/download-url` | Authorized short-lived download grant/URL. |
| Files | `GET /api/v1/files/grants/{token}` | Redeems a local grant; still requires bearer identity and live authorization. |
| Files | `DELETE /api/v1/files/{file_id}` | Super-admin deletion, optionally guarded by `expected_version`. |
| Files | `POST /api/v1/files/{file_id}/replacement` | Super-admin raw replacement with filename and expected-version query fields. |
| Files | `POST /api/v1/files/{file_id}/reconcile` | Super-admin recovery, cleanup, or quarantined-file re-verification. |

Protected domain/file requests use bearer authentication and live permission
checks; an MR may access only their own MR data and currently assigned active
patients. All IDs are UUIDs. Uploads accept only `profile` and `documents`;
profile uploads are images only. Only JPEG (`jpg`/`jpeg`), PNG, and PDF are
accepted. Uploads are raw streamed request bodies, not multipart: send a
`Content-Type` matching the extension and the required owner UUID, `category`,
and safe display `filename` query fields. Exactly one owner is required.
Authorization and per-user rate quota are checked before reserving a file.
Files are bounded by actual streamed bytes, not just `Content-Length`; empty files,
archives, arbitrary paths/keys, remote imports, and bulk operations are not
supported. Response metadata omits storage keys and provider details. Downloads
are attachment-only with a server-generated safe name, no-store and nosniff.
Upload and replacement responses include `X-File-ID` after reservation, including
later processing errors; use the opaque ID for privileged reconciliation rather
than retrying a possibly interrupted raw upload. Each retry is a new request and
reserves a new immutable ID, not an idempotency replay. Authorization/quota
failures before reservation have no ID. `X-File-ID` is not an access grant.

Application error responses use the machine-readable
`{ "error": { "code", "message", "request_id", "fields" } }` envelope. Validation
errors report bounded field/code identifiers and do not echo submitted bodies
(which may contain passwords or private filenames). Uvicorn's raw access logger
is disabled because default path logging can include grant tokens. The structured
request logger records method, matched route template, status and request ID
only, and redacts the grant route. Signed tokens, filenames, object keys,
credentials, request bodies, SQL parameters and provider exception strings must
not be logged.

## Configuration, defaults, and ownership

The complete environment template is `.env.example`; non-secret defaults and
bounds are defined and validated in `app/core/config.py`. Use Replit Secrets for
credentials and set deployment-specific values in the deployment environment.
These defaults are service behavior, not automatic infrastructure provisioning:

| Setting | Default | Bounds / ownership |
| --- | --- | --- |
| `APP_ENV` | `development` | `development`, `test`, or `production`; deploy configuration owns production selection. |
| `DATABASE_URL` | required | Replit managed PostgreSQL in development; database provisioning/backup belongs to the operator. |
| `JWT_SECRET`, fallback `SESSION_SECRET` | none | Selected signing secret must contain at least 32 characters; operator supplies it through Secrets. |
| `JWT_ISSUER`, `JWT_AUDIENCE` | `evexia`, `evexia-api` | Token validation contract; operator keeps issuance and verification settings aligned. |
| `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS` | 15 minutes, 7 days | 1–60 minutes and 1–30 days respectively; token/session policy is owned by backend security configuration. |
| `SESSION_REFRESH_HOURS` | 12 hours | 1–24 hours; server expiry for non-persistent browser-session refresh cookies. |
| `SUPER_ADMIN_INITIAL_PASSWORD` | unset | Backend-managed SecretStr; required only on first protected account creation, never returned or logged. |
| `STAFF_ENCRYPTION_KEYS` | unset | Managed secret JSON map of key IDs to base64-encoded independent random 32-byte AES keys; all needed historical keys must be retained. |
| `STAFF_ENCRYPTION_KEY_ID` | `primary` | Non-secret key ID used for new staff ciphertext; must exist in the configured keyring. |
| `STAFF_EMAIL_INDEX_KEY` | unset | Independent random 32-byte key encoded as base64; stable across staff records and restores, never the JWT/session/encryption key. |
| `ALLOW_PUBLIC_REGISTRATION` | `false` | Configured field only; registration is currently disabled regardless of value. |
| `CORS_ORIGINS` | empty | Explicit comma-separated HTTP(S) origins only; wildcards are rejected and production requires HTTPS. Configure only the intended browser origin. |
| `MAX_UPLOAD_BYTES` | 20 MiB (`20971520`) | 1 byte–100 MiB; backend parser/storage bound. |
| `STORAGE_BACKEND` | `local` | `local` or `s3`; selected adapter is explicit and never falls back. Production operator chooses a durable backend. |
| `LOCAL_STORAGE_ROOT` | unset | Required for local file use; explicit absolute normalized path other than `/`. Local adapter creates private directories/files with restrictive modes and no-follow path handling. |
| `DOWNLOAD_GRANT_SECONDS` | 300 seconds | 1–900 seconds; backend authorization policy. |
| `FILE_RATE_LIMIT` | 30 operations | 1–1000 per user per rolling 15 minutes; enforced by API/database. |
| `FILE_CONCURRENCY_LIMIT` | 4 | 1–64 active file operations globally across API workers, enforced with PostgreSQL advisory slots. |
| `FILE_REQUEST_TIMEOUT_SECONDS` | 30 seconds | 1–120 seconds total time to read the raw upload/replacement body. |
| `SCANNER_BACKEND` | `unavailable` | `clamd` or `unavailable`; fail-closed behavior is intentional. |
| `CLAMD_HOST`, `CLAMD_PORT` | `127.0.0.1`, 3310 | Trusted host/IP and TCP port 1–65535; operator must provide a reachable, maintained scanner. |
| `SCANNER_TIMEOUT_SECONDS` | 10 seconds | 1–30 seconds; scanner call deadline. |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT_URL` | unset | S3 selected only when explicitly configured; custom endpoint must use HTTPS. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | unset | Optional explicit Secrets; otherwise the SDK provider credential chain applies. Never store values in `.env.example`. |

The request-body middleware uses a 1 MiB bound for non-upload requests and the
configured upload limit for raw upload/replacement paths. Zone review/commit
allow 2 MiB; Courier and Storage Location review/commit allow 2 MiB plus 64 KiB multipart overhead,
with a separate extracted-file 2 MiB bound. Unrelated limits are unchanged.
No clamd service is
provided by this repository or artifact. `SCANNER_BACKEND=unavailable` is the
default and there is no production mock scanner setting: injected scanners exist
only in isolated tests. Without a clean scanner result, an upload is quarantined
and cannot be downloaded. Do not enable `clamd` until an operator has deployed,
network-restricted, monitored, and updated a real clamd service and verified its
connectivity and signature updates.

## Private file storage lifecycle and recovery

`app/services/storage.py` defines the storage interface and two explicit
adapters. Logical immutable keys are
`patients/{owner_uuid}/{category}/{file_uuid}.{extension}` or
`mrs/{owner_uuid}/{category}/{file_uuid}.{extension}`. Names from clients are
display metadata, never paths. Actual bytes, declared media type, file
signature/format, bounded parser checks, SHA-256 checksum and a clean trusted
scanner result must all agree. Local storage has no direct-download-link
implementation. S3 uses the same logical keys, records SHA-256 metadata (not
ETag), server-side encryption, and conditional create rather than overwriting
objects. No direct client upload, local fallback, or filename-derived key exists.

Lifecycle states include `uploading`, `quarantined`, `verified`, `rejected`,
`pending_delete`, and `deleted`. Only `verified` plus scanner status `clean` is
readable. Scanner outage/error stays quarantined; infected or invalid format
content is rejected. Database transactions and object writes are independent:
interrupted writes and cleanup failures are explicit errors and leave a row for
reconciliation rather than claiming success. Metadata responses do not reveal
physical keys or paths.

For operational triage, select only opaque IDs/state/version/timestamps from
the database; do not select display names, object keys, or file bytes into
operator logs or tickets. For example, use a read-only query:

```sql
SELECT id, state, scanner_status, version, updated_at
FROM files
WHERE state IN ('uploading', 'quarantined', 'rejected', 'pending_delete')
ORDER BY updated_at
LIMIT 100;
```

Use a privileged, authenticated `POST /api/v1/files/{file_id}/reconcile` for a
selected ID, and inspect its safe metadata/error response. It cleans interrupted
uploads and pending/rejected objects as applicable; only quarantined objects
are eligible for verification. A quarantined object can be reverified after a
real scanner service is restored, but it must pass the full byte/format/hash
checks again and receive a clean result before becoming readable. Reconcile
does not authorize manually editing SQL state. Rejected/invalid content is not
promoted by operator override. If a stored object differs from persisted size
or checksum, it is not accepted as verified; investigate and recover from a
trusted backup or replace it through the versioned API.

Replacement is a new immutable object. It requires the old file's expected
version; the existing verified file remains available unless the new replacement
verifies. Publication marks the old row `pending_delete` and the new row
`verified` in one database transaction, then attempts old-object cleanup.
Because object storage is outside the database transaction, cleanup failure
returns an explicit error while the new file can already be published and the
old inaccessible object remains pending cleanup. A concurrent/stale version
returns a conflict; do not retry with a new expected version without inspecting
the metadata and confirming operator intent. Delete/reconcile is idempotent
where the adapter can confirm the missing object.

There is no automatic retention policy, quota cleanup, file cleanup job, or
backup/restore operator in this foundation. The operator owns retention rules,
storage/database backups, restore testing, monitoring, quotas/capacity and timely
reconciliation of interrupted writes, scanner outages and pending deletion.
Audit events and download grants are database rows and likewise need an explicit
retention plan. Never purge tombstones or objects solely by age until retention,
legal hold, backup validity, and database/object consistency have been reviewed.

### Local storage and Replit deployment durability

For a local developer process only, set `LOCAL_STORAGE_ROOT` to an absolute
private directory writable by the same OS user as the API, on a durable disk
with adequate capacity and access restricted to that service user. Do not use
the repository tree, a public/static directory, a shared writable directory, or
an ephemeral deployment filesystem for durable uploads. The adapter creates
private directories and restrictive file modes; operators remain responsible
for filesystem ownership, disk monitoring, backups, restore testing and matching
database/object backups.

Replit's published-app documentation states that the published app filesystem
is not persistent and is reset on publish/restart; use a supported persistent
data service rather than local app files for durable data. Replit also states
that operators are responsible for app-level persistence and backups of
essential app data. See [Publishing](https://docs.replit.com/learn/projects-and-artifacts/replit-deployments),
[App Storage](https://docs.replit.com/features/data-and-storage/object-storage), and
[shared responsibility](https://docs.replit.com/features/security/shared-responsibility-model).
The current `local` default is convenient for development only; production file
storage needs an explicitly configured durable S3-compatible service and
verified operational backups.

### S3-compatible backend planning

The S3 adapter uses exactly the same generated logical keys and SHA-256 content
identity as the local adapter. A future migration from local to S3 must be an
explicit, audited copy process, not a backend toggle: pause writes/deletes,
inventory database IDs/keys/checksums without exposing names in logs, copy each
object with conditional create and encryption, verify downloaded bytes against
the stored SHA-256 and size, then compare complete inventories before switching
the configured backend. Preserve database rows and the old copy until the
cutover is verified and a rollback window has ended. Copy/metadata failures
must stop cutover; cleanup of source objects is a separate reviewed operation.
The database and object store do not share an atomic transaction; operator
reconciliation and an explicit, tested rollback/copy-back plan are required.

S3 presigned URLs are bearer capabilities: anyone holding the URL can use it
until expiration, and later reassignment or deletion cannot guarantee immediate
revocation. Keep their expiry at or below the configured bound, never log or
share URLs, use the authenticated download endpoint where immediate live
authorization is required, and treat response URLs as secrets.

## API contract and generated libraries

## Read-only Super Admin reporting

`GET /api/v1/admin/reporting/{summary,users,sessions,events}` requires a
currently validated session and the authoritative `admin.access` permission.
MR, unmapped, disabled and anonymous identities cannot browse any cross-user
data. Existing `/auth/session` and `/auth/sessions` remain owner-only.
All success and error responses are `Cache-Control: no-store`.

- Summary counts all persisted `User` accounts, including disabled and unmapped
  legacy accounts. Active users are distinct owners of unexpired ACTIVE sessions
  with matching token/identity versions and authentication-eligible identities
  (including an active MR profile when applicable). Multiple sessions count once.
   Linked staff credentials count as registered accounts but are unmapped and
   cannot contribute active sessions. This is not online presence, enabled
   accounts, or browser-local master records.
  Counts are global, ignore history filters, and carry a UTC refresh timestamp.
- Session state precedence is REVOKED, EXPIRED (stored or elapsed expiry),
  ACTIVE if eligible and versions match, otherwise INVALIDATED. Reporting
  queries do not materialize expiry, revoke sessions, or reactivate legacy
  history. Creation is login time; last refresh is not last activity.
- Histories accept optional UUID `user_id` and timezone-aware `start`/`end`
  timestamps in the 1970–2100 range. The interval is `[start,end)`; equal/inverted
  ranges are rejected. Sessions filter creation, events filter occurrence.
  The UI uses UTC days and sends the day after the selected inclusive end date.
- Histories and user selection use `limit` 1–100 (default 20), `offset` 0–10000,
  `has_more`, and stable newest timestamp then ID descending order. Pagination
  is offset-based, not a frozen snapshot: newly recorded events can shift pages.
  User options support literal, escaped `q` search of username/email (max 100).
  Index-only forward migration `0007_reporting_indexes` supports global and
  actor/user filtered histories; no managed database migration is run by tests.
- Explicit projections exclude hashes, passwords, credentials, refresh chains,
  headers/cookies and unrestricted metadata. Historical identity joins are
  outer joins. Unattributed or missing identities display Unknown/System, without
  inferring actors from resources, session owners or submitted login identifiers.
  Actor UUIDs are retained as historical references, not invented user labels.
  Legacy unsafe reason/reference strings are suppressed rather than echoed.

The page covers **existing recorded events only**: login/bootstrap/password,
authentication/session/refresh/security outcomes, domain provisioning/mapping/
assignment, and file operations where the backend already records them. It does
not audit every request, click, page view, or browser-local master edit; reporting
reads do not add a second logging system. No IP/device collection, export,
retention policy, deletion or session termination UI is introduced.

Focused backend checks: `sh scripts/test-api-foundation.sh tests/test_reporting.py
tests/test_sessions.py tests/test_api.py`. Client checks are in
`src/auth/adminSession.test.js`; `activity-logs.preview.spec.mjs` is included in
the isolated authenticated-preview/release harness. Tests use synthetic accounts
and a temporary PostgreSQL socket, never the managed database. A managed preview
with missing migration/bootstrap prerequisites is **BLOCKED**, not evidence of
production readiness; operators must apply the documented migration/bootstrap
sequence themselves. No production deployment is part of this feature.

Verification on 2026-10-06: full isolated API foundation suite **152 passed**;
focused memory-only session client suite **15 passed**; release harness
**24 authenticated browser tests passed**, plus preference service checks.
Portal compilation, workspace typecheck and API contract drift check passed.
An additional real-login audit-reference regression was added afterward;
all **20 focused reporting backend tests passed**, including URL-safe session
references containing both hyphens and underscores.
Screenshots covered dark desktop and light mobile; two-tab renewal and delayed
filter/logout responses were exercised with real synthetic authentication.
Managed workflows restarted successfully; the unauthenticated deep link
redirected to login. Live authenticated managed-preview/database verification is
**BLOCKED pending operator-confirmed migration/bootstrap readiness**; no managed
database was migrated, seeded or inspected by this work, and no production
readiness claim is made.


### Custom role metadata

The `/api/v1/admin/roles` endpoints manage **non-tenant business metadata only**.
They require a currently valid protected singleton Super Admin session and
the internal `roles.manage` capability. Transaction-time revalidation locks the
actor and session before role reads or writes. Custom role names never enter
authentication policy, legacy organization memberships, staff role dropdowns,
or system identity mappings. A custom name of “Super Admin” grants nothing.
MR, ordinary staff, unmapped accounts and anonymous callers cannot read or
mutate these records. Staff encryption keys are not needed for custom roles.

Forward-only migration `0010_custom_roles` adds a separate table with no seed
rows or foreign keys to identities/assignments/permissions. An operator must
apply `python3 -m alembic upgrade head` from this backend directory against
the intended database using the existing migration/backup procedure before
using the feature. Do not run fixture scripts against the managed/shared
database. Startup does not create tables. Downgrade refuses data loss; use an
operator backup and an explicitly planned recovery if reversal is required.

Contract:

- `GET /admin/roles?limit=50&cursor=<UUID>` returns `items`, `has_more`,
  `next_cursor` and `limit`. Limit is 1–100; the default is 50. UUID keyset
  ordering is deterministic, with no offset ceiling. Fetch successive pages
  until `has_more` is false. It is a live directory, not a frozen snapshot;
  additions below a previous cursor require a refresh.
- `GET /admin/roles/{role_id}` returns one record or `role_deleted` (404).
- `POST /admin/roles` accepts `name` (trimmed, 1–100 characters) and optional
  `description` (trimmed, at most 1,000 characters, default empty string).
  Names reject control characters; descriptions permit newline and tab.
- `POST /admin/roles/{role_id}/edit` accepts those fields plus positive,
  strict integer `expected_version`; `/delete` accepts only that version.
  Description omitted during edit clears it. Names may keep their own current
  spelling. Database-generated `lower(btrim(name))` uniqueness rejects duplicate
  names even from simultaneous requests (`role_duplicate`, 409).
- Responses contain stable UUID `id`, fields, `version`, `created_at`,
  `updated_at`, and a read-only `permissions: []` collection. All permission,
  authorization, identity and attribution input fields are forbidden, including
  an empty input `permissions` collection. No permission operations exist.
- Row locks and atomic version checks reject `role_stale` (409); missing rows
  return `role_deleted` (404). Failed changes never increment a committed
  version or add a successful audit. Unexpected pre-commit database failures
  return safe `roles_unavailable` (503). A COMMIT connection failure returns
  `role_outcome_unknown` (503): refresh authoritative list/detail before retry,
  since PostgreSQL might already have committed.
- Successful changes atomically create `role_create`, `role_update` or
  `role_delete` audit entries with `custom_role` resource UUID, authenticated
  actor, session and server request ID. No role name/description is copied into
  audit metadata. Reporting search and Activity Logs show “Role created”,
  “Role updated”, “Role deleted” and “Custom role”, not browser-reported actions.

The portal has no role persistence in browser storage. It restores through the
existing memory-token/HttpOnly-cookie lifecycle, checks session ownership before
and after responses, and never automatically resubmits mutations. Page and
focus refreshes update server state without replacing an open draft. Stale edits
require review and explicit adoption of the current version; unknown outcomes
disable mutation until an explicit refresh. Deleted records are never silently
recreated. Previous/Next directory navigation reaches every bounded page.

Verification (2026-10-07): the isolated backend regression pass covered role,
staff, auth/session, reporting and migration behavior (131 passed), followed by
17 focused role checks including ordinary staff denial and COMMIT failures.
Four authenticated browser cases passed against a synthetic disposable
PostgreSQL/API/Vite fixture, covering CRUD/reload, two-tab conflicts, deleted
drafts, committed-but-lost responses, last deletion, 52-role navigation,
desktop/mobile layout and audit UI labels. Portal compilation, generated client
typecheck and API contract drift check passed. The release gate includes role
service, backend/migration and browser checks.

This is synthetic verification, not a live managed authenticated-preview or
production check. **Live managed authenticated verification remains BLOCKED
pending operator-confirmed migration/bootstrap readiness and authorized sign-in.**
This work does not migrate, seed or inspect the managed database, handle live
credentials, or deploy production.

### Contract export workflow

FastAPI is authoritative for the OpenAPI contract. From the workspace root:

```sh
pnpm run check:api-contract
pnpm --filter @workspace/api-spec run export
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck:libs
```

`scripts/export-api-contract.py` imports the app with explicit synthetic,
generation-only environment values, without reading Replit Secrets or connecting
to a database/storage/scanner. It writes deterministic JSON, which is valid YAML,
to `lib/api-spec/openapi.yaml`. Error and health schemas/responses originate from
FastAPI/Pydantic models, not exporter-authored copies. The exporter normalizes
the artifact `/api` mount, pins operation IDs (including `getHealthCheck`), and
documents runtime response headers such as `X-Request-ID` and post-reservation
`X-File-ID`. `check:api-contract` fails on drift. Orval derives only the shared
`lib/api-client-react` and `lib/api-zod` libraries. The existing `healthCheck`
client name remains a compatibility alias; `HealthStatus` remains a shared
schema. Do not wire the portal to these clients or migrate its JavaScript/local
records as part of this backend foundation.

The spec server URL `/api` plus relative `/v1/...` paths produces exactly
`/api/v1/...`; do not prefix `/api` twice. The managed preview has been verified:
`/api/v1/health` and `/api/healthz` return 200, while `/api/api/...` returns 404.

### Contract export workflow

FastAPI is authoritative for the OpenAPI contract. From the workspace root:

```sh
pnpm run check:api-contract
pnpm --filter @workspace/api-spec run export
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck:libs
```

`scripts/export-api-contract.py` imports the app with explicit synthetic,
generation-only environment values, without reading Replit Secrets or connecting
to a database/storage/scanner. It writes deterministic JSON, which is valid YAML,
to `lib/api-spec/openapi.yaml`. Error and health schemas/responses originate from
FastAPI/Pydantic models, not exporter-authored copies. The exporter normalizes
the artifact `/api` mount, pins operation IDs (including `getHealthCheck`), and
documents runtime response headers such as `X-Request-ID` and post-reservation
`X-File-ID`. `check:api-contract` fails on drift. Orval derives only the shared
`lib/api-client-react` and `lib/api-zod` libraries. The existing `healthCheck`
client name remains a compatibility alias; `HealthStatus` remains a shared
schema. Do not wire the portal to these clients or migrate its JavaScript/local
records as part of this backend foundation.

The spec server URL `/api` plus relative `/v1/...` paths produces exactly
`/api/v1/...`; do not prefix `/api` twice. The managed preview has been verified:
`/api/v1/health` and `/api/healthz` return 200, while `/api/api/...` returns 404.
