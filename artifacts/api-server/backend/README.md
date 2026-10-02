# EVEXIA backend foundation

This is a separate FastAPI modular monolith, not a portal integration. The EVEXIA
portal still uses mock login screens and browser-local records; its login buttons
do not send credentials and its master data is not in PostgreSQL. Do not enter
real patient, health, staff, or vendor data into the preview.

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
  head`. Never create tables at startup. Do not run production migration or
  downgrade commands manually; review the managed publish schema operation and
  take a backup first. The current ordered migrations are `0001_identity_foundation`,
  `0002_optional_username`, `0003_system_identity_domain`, and `0004_private_files`.
  A downgrade is not a general rollback plan: it can remove data/schema state and
  cannot reverse issued credentials, uploaded objects, or external side effects.
  For a failed release, stop writes, preserve the database and object store,
  assess the migration and data state, then use a reviewed forward fix or a
  verified restore. No migration or deployment is performed by this README.
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
configuration field but does not enable account creation. There is no default
elevated account. A trusted operator must explicitly create or map an identity
after an intentional database setup:

```sh
cd artifacts/api-server/backend
PYTHONPATH=. python -m app.operator --email operator@example.invalid --create --role super_admin
PYTHONPATH=. python -m app.operator --email mr@example.invalid --create --role mr --username field.mr
```

The command prompts for new passwords without echoing them. Super-admin mapping
requires typing the exact email as a separate confirmation. For an existing
account, omit `--create`; mapping an account to `none` disables its system role.
This is a privileged, audited operator action—not a public API or bootstrap
secret. Provision only authorized people, use a password manager, and review
the audit event. Role/activation changes increment identity/token versions and
revoke refresh sessions. Legacy organization memberships are retained; they are
not automatically converted into system roles, domain ownership, or access.
Unmapped legacy accounts cannot authenticate to the new system operations.

`POST /api/v1/auth/login` accepts `{ "identifier": "email-or-username",
"password": "..." }`. It normalizes the identifier and rate-limits failed login
attempts. Login and refresh/logout require JSON and a same-origin `Origin`
header. A successful login returns a 15-minute bearer access token and sets a
rotating opaque refresh token in an HttpOnly, SameSite=Strict cookie. Production
uses Secure and a `__Host-` cookie. Keep access tokens in memory in any future
  browser integration, never localStorage. `POST /api/v1/auth/refresh` rotates the
cookie; `POST /api/v1/auth/logout` revokes its session; `GET /api/v1/auth/me`
requires bearer auth. `POST /api/v1/auth/change-password` requires a current
password of 1–128 characters, accepts a new password of 12–128 characters, and invalidates the
user's sessions/tokens. Password recovery is not implemented. Never trust a UI
role selector or request-supplied organization ID for authorization: protected
calls check the mapped identity and ownership/permissions in the database.

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
| Auth | `POST /api/v1/auth/change-password` | Bearer-authenticated password change. |
| Domain | `POST /api/v1/domain/mrs` | Super-admin provisions a mapped MR identity. |
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
configured upload limit for raw upload/replacement paths. No clamd service is
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