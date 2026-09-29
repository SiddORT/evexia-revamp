# EVEXIA Portal

EVEXIA Life Sciences portal with mock login screens and an Admin workspace preview, plus an independent FastAPI backend foundation. The portal is **not yet connected** to backend authentication or persistence.

## Run & operate

- The managed `artifacts/evexia-portal: web` workflow serves the preview.
- `pnpm --filter @workspace/evexia-portal run build` builds the web app.
- The managed `artifacts/api-server: API Server` workflow runs FastAPI on `/api`. Its code and operational notes are in `artifacts/api-server/backend/README.md`. Database changes use Alembic migrations; do not create tables at startup.

## Stack and scope

- React with JavaScript/JSX, Vite, Wouter, and CSS. Keep the web artifact free of TypeScript files.
- Routes: `/` (portal selection); `/admin/login`, `/mr`, `/doctor` (mock login); `/admin` (empty Admin dashboard), `/admin/masters` (Masters index), `/admin/masters/zones` (Zone Master).
- The Admin workspace is a preview. Sign Out only returns to the mock login. Do not add API calls or real authentication unless requested.
- The new backend is a separate foundation, not a replacement for existing browser-local master records. Do not silently migrate or overwrite those records.
- Login forms validate locally and simulate loading, then clearly state that authentication is not connected. No credentials are sent or stored.
- Zone Master records are stored only in the browser's localStorage, not shared across browsers or users. Clearing browser data removes them.

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