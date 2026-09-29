# EVEXIA backend foundation

FastAPI modular monolith under the existing API artifact. The portal is still a browser-local prototype: its login buttons do **not** send credentials, and its master data is **not** in PostgreSQL. Do not enter real patient or staff data into the preview.

## Running

- Python dependencies are controlled by the workspace `pyproject.toml` and `uv.lock` (Python 3.13).
- The managed `artifacts/api-server: API Server` workflow serves `/api` on port 8080.
- `DATABASE_URL` comes from the project database; provide a 32+ character `JWT_SECRET` in Replit Secrets, or use the already configured `SESSION_SECRET`. The service refuses to start with a missing/short secret.
- For local schema changes: `cd artifacts/api-server/backend && alembic upgrade head`. Migrations are explicit, never run as startup DDL. Do not run this command against production manually; use the managed publish schema review.
- For tests: `cd artifacts/api-server/backend && pytest -q`. Tests roll back an outer database transaction and leave no account records.
- `/api/v1/health`, `/api/v1/version`, `/api/v1/health/readiness`, and `/api/healthz` are public. Swagger is at `/api/docs` in development only.

## Authentication contract

`POST /api/v1/auth/register` is **disabled by default**; set `ALLOW_PUBLIC_REGISTRATION=true` only if self-service organization creation is intended. When enabled, each registration creates its own organization and owner membership, accepting `email`, optional `username`, `password`, and `organization_name`. It does not grant access to another organization. `POST /api/v1/auth/login` accepts `{ "identifier": "email-or-username", "password": "..." }`. Both endpoints require a same-origin `Origin` header, accept JSON, and return a 15-minute bearer token plus a rotating opaque refresh token in an HttpOnly SameSite=Strict cookie. A browser integration should keep the access token **in memory**, not localStorage. Use `POST /api/v1/auth/refresh` with the cookie and Origin header; `POST /api/v1/auth/logout` revokes that refresh session; `GET /api/v1/auth/me` requires bearer auth. `POST /api/v1/auth/change-password` invalidates all sessions and bearer tokens for that user.

Login attempts are limited using database-backed counters, with transaction-scoped advisory locks. JSON error bodies never echo invalid submitted values. Never treat UI role selection or an organization ID from a request as authorization: membership is checked in the database on each protected call. Future routes should use `current_identity`/`require_roles` and scope every query by `identity.membership.organization_id`.

The login UI's "email or username" field maps to the API `identifier` value; the UI remains mock until authentication is explicitly connected. Password recovery is intentionally not exposed without a delivery provider. When it is added, use an enumeration-neutral request response, a separately stored hash of a one-time short-lived token, a single-use reset transaction, rate limits, and session/version revocation; deliver only a link through the configured template-driven notification service. Never log the token or put it in an API response.

## Storage and integrations

`StorageService` defines upload/download/delete/exists/metadata/pre-signed URLs; `S3Storage` is opt-in, uses a configured S3-compatible provider, and has no filesystem fallback. Object keys include environment, tenant UUID, module, entity type/UUID, category, generated UUID, and a sanitized filename. Uploads through the service check size and file signatures. There is **no upload API yet**: before adding one, authorize the tenant/entity/category, scan content, store file metadata in PostgreSQL, and verify direct pre-signed uploads before making them accessible. Never pass client-supplied object keys to storage methods.

`NotificationService` is provider-neutral. The unconfigured implementation fails explicitly. Add a template resolver and a configured provider before sending email/SMS/WhatsApp; Firebase and payments are not initialized without a defined use case.