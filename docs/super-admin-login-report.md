# Super Admin login implementation report

## Authentication and session flow

The existing JSX Admin form uses same-origin `/api/v1/auth/login`, then verifies
the current database identity through `/me`. The backend grants `admin.access`
only to the active protected system identity; email, tenant membership, local
staff records and ordinary organization Admin roles do not authorize access.
All `/admin` workspace routes wait for verification before rendering. Only safe
Admin return paths are accepted. MR and Doctor login simulations are unchanged.

Access tokens stay in module memory. Refresh tokens remain hashed in PostgreSQL
and are sent only as HttpOnly, SameSite Strict cookies (Secure in production).
Refresh-cookie operations use Web Locks across tabs, with one pending refresh
per tab and generation checks preventing stale responses restoring logout.
Browsers without Web Locks fail closed. Cross-tab events carry no credentials.
Reload restores through refresh and `/me`; failures do not create retry loops.
Network restoration errors require explicit retry.
Already-verified same-route editors remain mounted but hidden and inert during
renewal or transient errors, preserving unsaved drafts without permitting
interaction. Initial authorization and definitive denial never expose content.

Remember me selects a persistent cookie bounded by the original refresh-family
expiry. Otherwise it is a browser-session cookie with the same bounded server
expiry; browser session-restore features can retain session cookies. Rotation
never extends that absolute expiry. Logout revokes the refresh family and clears
memory, but an already-issued stateless access token remains valid until its
short expiry. Failed revocation is explicitly unconfirmed and offers retry.
The existing password-change flow revokes refresh sessions and increments the
token version, invalidating prior access tokens.

## Migration, protection and bootstrap

Forward migration `0005_protected_super_admin_sessions.py` follows the existing
non-tenant identity and private-file migrations. It adds the protected flag,
singleton partial unique index, identity/check constraints and mutation trigger,
plus refresh-family absolute expiry/persistence fields with historical backfill.
Protected activation, ID, email, role and identity version cannot change, and the
account cannot be deleted. Password/token-version changes remain possible.
Operator provisioning no longer offers Super Admin creation/elevation. Service
authorization and MR conversion paths require/retain the protected identity.

Migration refuses pre-existing Super Admin mappings for explicit operator review
rather than silently elevating or deleting historical accounts. Bootstrap rejects
reserved email/username collisions, including case variants. Bootstrap holds a
transaction advisory lock, requires a backend SecretStr initial password only
for first creation, uses existing Argon2id, and audits safe created/existing
outcomes. Repeated and concurrent runs preserve ID, hash and security settings.
Missing or invalid first-creation configuration fails with no fallback account.

Explicit initialization from the workspace root:

```sh
sh scripts/initialize-api.sh
```

This runs Alembic first and bootstrap second. It is not invoked by API startup.
Supply the initial secret through the backend managed secret store, never as a
command argument. No shared/production migration or bootstrap was executed here.
The trigger is an accidental-mutation safeguard, not a boundary against a DB owner
or arbitrary privileged SQL. Runtime DB roles must not own tables, disable
triggers, truncate protected tables or perform DDL. Downgrade refuses to remove
protection once the account exists; reviewed forward maintenance/backups are
required. Backend README includes cookie Origin/HTTPS configuration.

## Verification and limitations

- `pnpm run test:api-foundation`: **98 passed** against ephemeral PostgreSQL,
  including independent-transaction bootstrap concurrency and security lifecycle.
- `pnpm run validate:release`: initial full pass **10 browser tests**; the
  expanded pass verified **14 browser cases**, with the new renewal-draft case
  subsequently corrected to use its explicit field test ID and **passing in a
  targeted rerun**. This verifies all **15 browser cases** across those runs.
  **8 session-service**
  and **2 preference-service tests** passed. Tests use synthetic
  bootstrap/login and a same-origin test proxy, never a guard bypass.
- Additional existing message-template suite was adapted to real authentication;
  its initial run exposed two fixture issues, corrected by awaiting completed
  save and authenticating its separately created narrow-screen context.
  All four message-template cases passed in expanded release validation.
- Combined session/PO/receipt service checks: **63 passed**; historical fictional
  records are preserved. New local actor labels do not claim verified audit data.
- `pnpm run check:api-contract`, `pnpm run typecheck`, portal production build,
  shell syntax and whitespace checks passed. FastAPI contract and Orval outputs
  were regenerated. Existing bundle-size and dependency deprecation warnings remain.
- Shared preview proxy health returned 200; unauthenticated `/me` returned 401.
  Login screenshot showed the retained layout. Preview workflows restarted cleanly.
- Live credentialed shared-preview login remains **unverified/blocked by operator
  initialization**: no real initial password was supplied or inspected and no
  shared database was migrated/seeded. Isolated tests are not a live deployment
  certification.
- Pillow/PyPDF were already declared; missing installed parser dependencies were
  restored before the backend suite. No new parser/storage design was introduced.

Remaining production prerequisites: reviewed migration/backup plan and DB roles,
backend initial secret for first creation, signing secret, explicit trusted HTTPS
Origins, TLS/Secure cookie configuration and operator-approved initialization.
No production deployment, production-readiness or VAPT certification is claimed.
Master data is still fictional and browser-local, not server-authorized persisted
business data. MFA and recovery remain out of scope.

## Exact changed/added files

Backend (paths below are relative to `artifacts/api-server/backend/`):

- `.env.example`
- `README.md`
- `alembic/versions/0005_protected_super_admin_sessions.py`
- `app/bootstrap.py`
- `app/operator.py`
- `app/core/config.py`
- `app/db/models.py`
- `app/api/deps.py`
- `app/api/v1/auth.py`
- `app/api/v1/system.py`
- `app/schemas/auth.py`
- `app/services/auth.py`
- `app/services/domain.py`
- `app/services/file_policy.py`
- `tests/test_api.py`
- `tests/test_domain.py`
- `tests/test_files.py`
- `tests/test_migration_files.py`
- `tests/test_protected_admin.py`

Portal (relative to `artifacts/evexia-portal/`):

- `package.json`
- `vite.config.js`
- `src/App.jsx`
- `src/auth/AdminBoundary.jsx`
- `src/auth/adminSession.js`
- `src/auth/adminSession.test.js`
- `src/components/admin/AdminLayout.jsx`
- `src/components/auth/LoginForm.jsx`
- `src/pages/AuthPage.jsx`
- `src/pages/admin/AdminSettings.jsx`
- `src/pages/admin/PurchaseReceivedFormPage.jsx`
- `src/services/purchaseOrders.js`
- `src/services/purchaseOrders.test.js`
- `src/services/purchaseReceived.js`
- `src/services/purchaseReceived.test.js`
- `tests/admin-auth.preview.spec.mjs`
- `tests/communication.preview.spec.mjs`
- `tests/message-templates.preview.spec.mjs`
- `tests/template-preferences.preview.spec.mjs`
- `tests/helpers/authenticateAdmin.mjs`

Workspace:

- `package.json`
- `replit.md`
- `threat_model.md`
- `scripts/export-api-contract.py`
- `scripts/initialize-api.sh`
- `scripts/run-authenticated-previews.sh`
- `scripts/validate-template-preferences.sh`
- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/currentUser.ts`
- `lib/api-zod/src/generated/types/loginRequest.ts`
- `.agents/memory/local-po-actor-attribution.md` (corrected obsolete attribution guidance)
- `.agents/memory/MEMORY.md`
- `.agents/memory/auth-renewal-drafts.md` (renewal/draft protection principle)
- `docs/super-admin-login-report.md` (this report)