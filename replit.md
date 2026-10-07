# EVEXIA Portal

EVEXIA Life Sciences portal with a protected Admin workspace, mock MR/Doctor login screens, browser-local demonstration masters, and a FastAPI authentication/API service. Admin authentication, Staff Management and Zone Master use the backend; unrelated masters remain browser-local.

## Run & operate

- The managed `artifacts/evexia-portal: web` workflow serves the portal preview.
- Loading presentation is request-driven: the HTML startup fallback and Admin access checks use the unchanged official logo; reporting tables use decorative cell skeletons with one status announcement. Local Master reads remain synchronous. Run `pnpm --filter @workspace/evexia-portal run test:loaders:browser` for loading, authenticated draft/session, and Activity Logs browser regressions.
- `pnpm --filter @workspace/evexia-portal run build` builds the web app.
- The managed `artifacts/api-server: API Server` workflow runs FastAPI directly with Python on `/api` (no Node.js or pnpm in the API artifact). The portal calls same-origin `/api/v1/auth` routes through its API proxy. API code and operational notes are in `artifacts/api-server/backend/README.md`. Database changes use Alembic migrations; do not create tables at startup.

## Stack and scope

- React with JavaScript/JSX, Vite, Wouter, and CSS. Keep the web artifact free of TypeScript files.
- Routes: `/` (portal selection); `/admin/login` (backend-authenticated Super Admin); `/mr` and `/doctor` (mock login); `/admin` and `/admin/*` (protected Admin workspace).
- Admin routes require a verified backend session for the protected system Super Admin with the explicit `admin.access` permission. The browser guard is not a substitute for server-side authorization of future data operations. Sign Out revokes the server refresh session when available and clears the in-memory access token.
- The new backend is a separate foundation, not a replacement for existing browser-local master records. Do not silently migrate or overwrite those records.
- All future backend work must follow the supplied EVEXIA Engineering and Security Standards. EVEXIA is non-tenant: use explicit system Super Admin/MR identities and database ownership/assignment policies, never tenant abstractions or implicit elevation from legacy memberships or portal role labels. See `artifacts/api-server/backend/STORAGE_CONTRACT.md`.
- Backend API and persistence contract: see `artifacts/api-server/backend/README.md`; FastAPI OpenAPI is authoritative and shared TypeScript clients are generated offline from it. Production uploads cannot rely on the app filesystem: Replit published app files reset on restart/publish, so use explicitly configured durable object storage and operator-managed data backups. See the backend README's official Replit documentation references and recovery procedure.
- The Admin form authenticates against the FastAPI API. Access tokens are memory-only; rotating refresh credentials use an HttpOnly cookie. Login credentials are never stored in browser storage. MR/Doctor login screens remain mock-only.
- Super Admin profile > Sessions & Activity Logs (`/admin/activity-logs`) is read-only backend reporting. Counts are global registered backend accounts and distinct eligible session owners, not local records or presence. Histories use server filters and UTC dates; no private history is persisted in browser storage. See the backend README for scope and pagination semantics.
- Both reporting tabs keep independent debounced searches, with search and CSV export in a responsive toolbar outside the tablist. Activity search is literal, case-insensitive and bounded to 100 characters, matches safe displayed metadata and explicit friendly labels, and uses identical server matching for pages and the existing 5,000-row export. Keep backend reporting label aliases aligned with the page's action/resource labels; portable CSVs still exclude references.
- Zone Master is shared FastAPI/PostgreSQL persistence, protected by system Super Admin `admin.access`. No local migration or mirroring occurs. MR/Doctor/Patient/Sales Target demo assignments still use the separate legacy browser-local zones. See `docs/zone-master.md` for soft deletion, import/export limits and initialization.
- Settings > Communication is a demo-only Email (SMTP/API/unconnected platform), SMS and WABA metadata preview. Use dummy values only. No provider is connected, verified or contacted. Password/key/token preview inputs are transient and never saved; endpoint metadata uses HTTPS without embedded credentials, query strings or fragments. Communication resets affect only its dedicated browser-local metadata, not other settings or master records.
- Staff Management is server-backed and requires protected system Super Admin `staff.manage`. Names/emails/phones are encrypted with dedicated operator-managed AES-GCM keys and a separate keyed email index; missing keys fail staff operations closed without breaking login. User credentials are atomically provisioned with no plaintext User.email and no system role: staff cannot sign in, and business “Super Admin” labels grant no privileges. User ID is immutable; a generated initial password is shown once only, never saved in browser storage or exported. Existing local staff storage is untouched and unused. CSV import and invitation controls are unavailable. Designation Master remains browser-local; its selected label is metadata only. See `docs/staff-security.md` for configuration, migration and manual handoff.


## Settings extensions

- Settings categories are additive entries in `src/components/admin/settingsSections.jsx`, with stable URL IDs, labels, icons, descriptions, keywords and components. Register only implemented sections; do not expose placeholders.
- General and Appearance retain the `basic` and `ui` URL IDs. Category navigation preserves unrelated query parameters and supports browser back/forward.
- Keep Settings styling scoped in `src/adminSettings.css`. Existing local preference keys and document/template behavior must remain unchanged.
- Settings > Email & SMS Templates (`message-templates`) manages content only, separately from document layouts and Communication provider metadata. System examples are immutable and not wired to events. User templates use a dedicated versioned browser-local store; clearing browser data removes them. Mutations require Web Locks and reject stale drafts. HTML preview uses a formatting allowlist and a scriptless, opaque-origin sandbox with restrictive CSP; no authored HTML enters the Admin DOM and no external assets load. Provider/DLT IDs are string references, not proof of registration or approval.
- Focused checks: `node --test artifacts/evexia-portal/settings-navigation.test.mjs artifacts/evexia-portal/admin-preferences.test.mjs artifacts/evexia-portal/src/services/poInvoice*.test.js`.

## Browser regression test

- Run `pnpm run test:authenticated-previews` for the Admin-auth, template-preference, and Communication browser regressions in one isolated harness run. `pnpm run test:communication-browser` runs only Communication; `pnpm --filter @workspace/evexia-portal run test:template-preferences` runs its service and browser checks.
- The authenticated-preview harness starts a temporary local-only PostgreSQL database, applies migrations, creates a synthetic protected Super Admin through the backend bootstrap command, starts FastAPI and a Vite dev server, and removes the database/processes on exit. It overwrites database/auth fixture settings with synthetic test-only values and never connects to a configured or managed database.
- Preview requests stay same-origin: the harness's opt-in Vite `/api` proxy targets its isolated FastAPI process. Happy-path and existing preference/communication tests use real login and `/me`; protected pages restore with the real refresh-cookie flow. The Admin-auth negative cases intercept outage, rate-limit, expiry, and missing-permission responses to confirm fail-closed UI handling; they never bypass a guard.
- The harness requires `initdb`, `pg_ctl`, `createdb`, Python backend dependencies, `pnpm`, `curl`, and installed Playwright Chromium. Set `EVEXIA_CHROMIUM_PATH` to a supported executable if needed. Optional `EVEXIA_TEST_PORT` and `EVEXIA_TEST_API_PORT` change its local Vite/API ports.
- The isolated harness passing is evidence for those synthetic code regressions only; it is not a live managed-preview or deployment check. For a live authenticated preview, the API database must already be migrated and contain the protected singleton. On a fresh database, bootstrap requires the operator-managed `SUPER_ADMIN_INITIAL_PASSWORD`; missing/invalid initial configuration or a conflicting reserved identifier blocks bootstrap. Record that live check as **BLOCKED**, not passed, when its bootstrap prerequisite is unavailable. Do not seed a managed/shared database with the synthetic fixture. Existing protected accounts can be bootstrapped idempotently without the initial secret and are never reset by it. See the backend README for the explicit migration/bootstrap sequence.
- Message-template service checks: `node --test artifacts/evexia-portal/src/services/messageTemplates.test.js artifacts/evexia-portal/src/services/messageTemplatePreview.test.js`. Its existing browser suite also uses the real synthetic-account fixture and runs in the authenticated harness.

## Release validation

- `pnpm run build` runs `pnpm run validate:release` automatically before typechecking or producing build output. A failed service or browser test blocks the build. The direct artifact `build` command is for compilation only, not release approval.
- The gate runs authentication (including Zone transport), staff CSV/validation and preference service checks, then the authenticated browser suites including Staff Management and Zone Master in one isolated harness/Playwright invocation. It is registered as the project's `release` validation command. Backend parser/API/migration/race checks run with `pnpm run test:api-foundation`.
- The harness starts Vite in dev mode because the template-preferences spec imports a Vite source module. It does not depend on or alter a managed workflow or its database.
- Set `EVEXIA_CHROMIUM_PATH` when a specific supported Chromium executable is needed. Otherwise the gate selects `chromium` / `chromium-browser` from PATH, falling back to Playwright's installed Chromium. Missing or invalid browser executables fail the gate.
- Outside Replit, run `EVEXIA_CHROMIUM_PATH=/path/to/chromium pnpm run build` (omit the executable override when using installed Playwright Chromium).
- The existing Canvas build also requires `PORT` and `BASE_PATH`; for a full workspace build from a plain shell, supply them (for example `PORT=5173 BASE_PATH=/ pnpm run build`).
- Tests create a fresh, non-persistent browser context for each case; only the two test tabs share storage. Do not replace this with a real browser profile or saved user storage.

## Where things live

- `artifacts/evexia-portal/src/App.jsx` — routing
- `artifacts/evexia-portal/src/config/roles.js` — role content
- `artifacts/evexia-portal/src/components/` — shared portal and auth UI
- `artifacts/evexia-portal/src/pages/` — landing, login, and not-found pages
- `artifacts/evexia-portal/src/index.css` — styling and responsive rules
- `artifacts/evexia-portal/src/components/admin/`, `src/pages/admin/`, and `src/admin.css` — Admin shell and Zone Master UI
- `artifacts/evexia-portal/src/services/serverZones.js`, `src/hooks/useZones.js` — shared Zone Master transport and state; `src/services/zones.js` remains the untouched legacy demo dataset for unrelated masters.
- `artifacts/evexia-portal/public/images/` — coordinated role photography

## Assets

The supplied transparent EVEXIA logo is displayed by the shared brand component on the landing and login form panels, not over the role photography. Keep the original artwork intact; the local PNG is only cropped to remove transparent margins. The logo is a small raster source, so do not stretch it unnecessarily or redraw it.
