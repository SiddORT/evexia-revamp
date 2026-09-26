# EVEXIA Portal

A frontend-only mock portal-selection and login experience for EVEXIA Life Sciences.

## Run & operate

- The managed `artifacts/evexia-portal: web` workflow serves the preview.
- `pnpm --filter @workspace/evexia-portal run build` builds the web app.
- The workspace includes a scaffold API server, but this product does not use it.

## Stack and scope

- React with JavaScript/JSX, Vite, Wouter, and CSS. Keep the web artifact free of TypeScript files.
- Routes: `/` (portal selection), `/admin`, `/mr`, and `/doctor` (shared login UI configured by role).
- Phase one is a mock UI only. Do not add API calls, a backend, real authentication, dashboards, or internal modules unless the user requests them later.
- Forms validate locally and simulate loading, then clearly state that authentication is not connected. No credentials are sent or stored.

## Where things live

- `artifacts/evexia-portal/src/App.jsx` — routing
- `artifacts/evexia-portal/src/config/roles.js` — role content
- `artifacts/evexia-portal/src/components/` — shared portal and auth UI
- `artifacts/evexia-portal/src/pages/` — landing, login, and not-found pages
- `artifacts/evexia-portal/src/index.css` — styling and responsive rules
- `artifacts/evexia-portal/public/images/` — coordinated role photography

## Assets

The supplied EVEXIA logo is displayed by the shared brand component on the landing and login screens. Keep the original artwork intact; the local PNG is only cropped to remove excess white space. The logo is a small raster source, so do not stretch it unnecessarily or redraw it.