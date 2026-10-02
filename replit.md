# EVEXIA Portal

EVEXIA Life Sciences portal with mock login screens and an Admin workspace preview, plus an independent FastAPI backend foundation. The portal is **not yet connected** to backend authentication or persistence.

## Run & operate

- The managed `artifacts/evexia-portal: web` workflow serves the preview.
- `pnpm --filter @workspace/evexia-portal run build` builds the web app.
- The managed `artifacts/api-server: API Server` workflow runs FastAPI directly with Python on `/api` (no Node.js or pnpm in the API artifact). Its code and operational notes are in `artifacts/api-server/backend/README.md`. Database changes use Alembic migrations; do not create tables at startup.

## Stack and scope

- React with JavaScript/JSX, Vite, Wouter, and CSS. Keep the web artifact free of TypeScript files.
- Routes: `/` (portal selection); `/admin/login`, `/mr`, `/doctor` (mock login); `/admin` (empty Admin dashboard), `/admin/masters` (Masters index), `/admin/masters/zones` (Zone Master).
- The Admin workspace is a preview. Sign Out only returns to the mock login. Do not add API calls or real authentication unless requested.
- The new backend is a separate foundation, not a replacement for existing browser-local master records. Do not silently migrate or overwrite those records.
- All future backend work must follow the supplied EVEXIA Engineering and Security Standards. EVEXIA is non-tenant: use explicit system Super Admin/MR identities and database ownership/assignment policies, never tenant abstractions or implicit elevation from legacy memberships or portal role labels. See `artifacts/api-server/backend/STORAGE_CONTRACT.md`.
- Backend API and persistence contract: see `artifacts/api-server/backend/README.md`; FastAPI OpenAPI is authoritative and shared TypeScript clients are generated offline from it. Production uploads cannot rely on the app filesystem: Replit published app files reset on restart/publish, so use explicitly configured durable object storage and operator-managed data backups. See the backend README's official Replit documentation references and recovery procedure.
- Login forms validate locally and simulate loading, then clearly state that authentication is not connected. No credentials are sent or stored.
- Zone Master records are stored only in the browser's localStorage, not shared across browsers or users. Clearing browser data removes them.
- Settings > Communication is a demo-only Email (SMTP/API/unconnected platform), SMS and WABA metadata preview. Use dummy values only. No provider is connected, verified or contacted. Password/key/token preview inputs are transient and never saved; endpoint metadata uses HTTPS without embedded credentials, query strings or fragments. Communication resets affect only its dedicated browser-local metadata, not other settings or master records.


## Settings extensions

- Settings categories are additive entries in `src/components/admin/settingsSections.jsx`, with stable URL IDs, labels, icons, descriptions, keywords and components. Register only implemented sections; do not expose placeholders.
- General and Appearance retain the `basic` and `ui` URL IDs. Category navigation preserves unrelated query parameters and supports browser back/forward.
- Keep Settings styling scoped in `src/adminSettings.css`. Existing local preference keys and document/template behavior must remain unchanged.
- Settings > Email & SMS Templates (`message-templates`) manages content only, separately from document layouts and Communication provider metadata. System examples are immutable and not wired to events. User templates use a dedicated versioned browser-local store; clearing browser data removes them. Mutations require Web Locks and reject stale drafts. HTML preview uses a formatting allowlist and a scriptless, opaque-origin sandbox with restrictive CSP; no authored HTML enters the Admin DOM and no external assets load. Provider/DLT IDs are string references, not proof of registration or approval.
- Focused checks: `node --test artifacts/evexia-portal/settings-navigation.test.mjs artifacts/evexia-portal/admin-preferences.test.mjs artifacts/evexia-portal/src/services/poInvoice*.test.js`.

## Browser regression test

- Run the communication preview regression against the running EVEXIA Portal preview with `EVEXIA_PREVIEW_BASE_URL=https://<development-preview-host> pnpm run test:communication-browser`. `EVEXIA_PREVIEW_BASE_URL` is required; use the assigned development preview host and port rather than assuming the default Vite port is correct.
- Install the Playwright browser binaries in the environment before running the browser test.
- Message-template checks: `node --test artifacts/evexia-portal/src/services/messageTemplates.test.js artifacts/evexia-portal/src/services/messageTemplatePreview.test.js`; browser regression: `EVEXIA_PREVIEW_BASE_URL=https://<development-preview-host> pnpm exec playwright test artifacts/evexia-portal/tests/message-templates.preview.spec.mjs`.

## Release validation

- `pnpm run build` runs `pnpm run validate:release` automatically before typechecking or producing build output. A failed service or browser test blocks the build. The direct artifact `build` command is for compilation only, not release approval.
- The gate runs `templatePreferenceEvents.test.js` and all three two-tab cases in `tests/template-preferences.preview.spec.mjs`. It is also registered as the project's `release` validation command.
- Keep the EVEXIA Portal dev workflow running. Set `EVEXIA_PREVIEW_BASE_URL` to its reachable URL; in Replit the gate defaults to `https://$REPLIT_DEV_DOMAIN`. The spec imports a Vite source module, so a static production preview is not sufficient. An unavailable preview fails the gate.
- Set `EVEXIA_CHROMIUM_PATH` when a specific supported Chromium executable is needed. Otherwise the gate selects `chromium` / `chromium-browser` from PATH, falling back to Playwright's installed Chromium. Missing or invalid browser executables fail the gate.
- Outside Replit, run `EVEXIA_PREVIEW_BASE_URL=https://<running-dev-preview-host> EVEXIA_CHROMIUM_PATH=/path/to/chromium pnpm run build` (omit the executable override when using installed Playwright Chromium).
- The existing Canvas build also requires `PORT` and `BASE_PATH`; for a full workspace build from a plain shell, supply them (for example `PORT=5173 BASE_PATH=/ pnpm run build`).
- Tests create a fresh, non-persistent browser context for each case; only the two test tabs share storage. Do not replace this with a real browser profile or saved user storage.

## Where things live

- `artifacts/evexia-portal/src/App.jsx` — routing
- `artifacts/evexia-portal/src/config/roles.js` — role content
- `artifacts/evexia-portal/src/components/` — shared portal and auth UI
- `artifacts/evexia-portal/src/pages/` — landing, login, and not-found pages
- `artifacts/evexia-portal/src/index.css` — styling and responsive rules
- `artifacts/evexia-portal/src/components/admin/`, `src/pages/admin/`, and `src/admin.css` — Admin shell and Zone Master UI
- `artifacts/evexia-portal/src/services/zones.js`, `src/hooks/useZones.js` — local Zone Master data and state
- `artifacts/evexia-portal/public/images/` — coordinated role photography

## Assets

The supplied transparent EVEXIA logo is displayed by the shared brand component on the landing and login form panels, not over the role photography. Keep the original artwork intact; the local PNG is only cropped to remove transparent margins. The logo is a small raster source, so do not stretch it unnecessarily or redraw it.
