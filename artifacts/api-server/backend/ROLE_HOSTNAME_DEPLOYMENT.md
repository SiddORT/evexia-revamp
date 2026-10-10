# Connecting role portal hostnames

Mappings only choose an entry screen. They never provision accounts, change
permissions, redirect off-origin, register domains, configure DNS or certify a
deployment. Doctor still opens `/doctor`, the existing mock preview, not Admin
immunotherapy orders. Each hostname has independent browser-local preferences
and independent host-only sign-in cookies. There is no cross-domain SSO.

## Operator prerequisites (no automatic infrastructure changes)

1. Keep an **unmapped main domain** with its existing `/admin/login` and
   `/admin/settings?tab=role-urls` URLs available as the recovery route.
2. Bind each exact hostname to the same portal deployment through the hosting
   platform's domain controls. Configure the DNS records requested by that
   platform and verify DNS ownership/resolution independently.
3. Enable a valid HTTPS certificate for every connected hostname. HTTP should
   redirect to HTTPS before the application is served.
4. Serve the SPA at the intended base path (`BASE_PATH` at build time). Return
   its `index.html` for deep links such as `/admin/settings`, `/admin/login`,
   `/mr/home` and `/doctor`. API requests must **not** fall back to index.html.
5. Reverse-proxy **same-origin `/api`** to the existing API service, preserving
   the `/api/v1/...` path. This is required on every hostname; don't point
   browser code to a different API origin. The workspace already mounts the
   API separately. The standalone portal nginx template serves static files
   only; its fronting ingress must dispatch `/api` to the API.
6. The operator must configure the trusted ingress/proxy set and original
   HTTPS scheme explicitly. Strip client-supplied forwarding headers before
   writing trusted ones. The application does not derive an identity or domain
   assignment from forwarded host headers. Preserve the external Host and
   scheme so `require_cookie_origin` compares the genuine same origin; if the
   ingress cannot preserve them, operator-review explicit HTTPS origins in
   `CORS_ORIGINS`. Saved mappings never widen that allowlist or proxy trust.
7. Apply the reviewed database migration through the normal release process.
   Save the hostname in Settings and verify every URL from a separate browser.

Production authentication remains unchanged: `APP_ENV=production` uses
`__Host-evexia_refresh`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` and
**no Domain attribute**. Do not rewrite cookie Domain/Path or disable these
flags. Do not allow cross-origin credentials as a workaround.

## Verification for each connected hostname

- Root opens the assigned existing role entry; Admin is `/admin/login`, MR is
  `/mr`, Doctor is `/doctor` (preview only). An incompatible role path gives
  a same-origin link to the assigned entry, never a chooser.
- Admin/MR: sign in with a valid account of that identity, wait for the protected
  page, refresh a deep link, renew the session, and sign out. Verify refresh
  cookie attributes in browser tools and ensure the signed-out protected URL
  returns to the matching login. A hostname must not grant roles to an account.
- Doctor: verify the mock-preview warning and that no credentials are sent;
  there is no invented post-login Doctor route.
- Disable a mapping: a **new visit** should use normal main-domain path routing.
  Already-mounted editors are not polled or redirected.
- Disconnect the API temporarily in a test environment: entry must show
  explicit retry, not treat failure as an unmapped domain.

## Safe rollback

Use the unchanged main-domain Admin URL to disable or remove a mistaken mapping
with its current version. Test with a new visit. Do not remove DNS/domain
bindings or change security settings to recover application routing. If a domain
binding itself fails, use the hosting platform's separately reviewed rollback.

## Local isolated evidence

`scripts/test-api-foundation.sh tests/test_role_urls.py` uses disposable
PostgreSQL. The role-host browser spec uses isolated loopback hostnames and
same-origin Vite `/api` proxying; production-cookie tests additionally inspect
the unchanged Secure/HttpOnly/SameSite/host-only semantics. This is not proof
that any real DNS, certificate, domain binding or ingress is ready.

## Workspace recovery and smoke check

Start the existing managed `artifacts/api-server: API Server` and
`artifacts/evexia-portal: web` workflows. If a port is occupied, identify its
listener and owner before stopping anything; never broadly kill Node/Python
processes or create a replacement workflow. A running health socket does not
prove that the API has the latest resolver route.

Run `pnpm run check:portal-hostname` after startup. It uses the workspace
development origin (or loopback ingress at port 80), not the standalone Vite
port. To inspect another ingress, pass its URL with
`node scripts/check-portal-hostname.mjs https://preview.example.com`.
The check requires HTTP 200, JSON containing only a valid `role`, and
`Cache-Control: no-store`. It probes both the current origin's hostname and a
DNS hostname so localhost's deliberate DB-free resolution cannot hide missing
schema. It sends no credentials and never changes mappings. A mapped result
is allowed; the probe does not assume that arbitrary hostnames are unmapped.

The workspace ingress mounts `/api` separately from the portal. Direct Vite
requests can return SPA HTML unless the **isolated-test-only**
`EVEXIA_TEST_API_PROXY_TARGET` override is set. Keep that override limited to
disposable fixtures; do not change browser origins or cookie/CORS rules to
work around ingress failures. The isolated browser harness also runs this
smoke through its same-origin proxy before exercising role entry.

Check `/api/v1/health/readiness` separately. Resolver success does not authorize
a schema rollout: at `0031_role_hostnames` its table is present, but the current
runtime requires `0032_remove_organizations` for full readiness. Follow
`docs/organization-retirement.md` only after separate operator approval and
the documented recovery/retention/write-exclusion evidence. Never migrate,
stamp or reset the shared database as part of portal recovery.

### Recovery evidence (2026-10-10)

- At the start of this recovery session, neither intended service was listening
  and both managed workflows were `not_started`; the normal ingress returned
  502. The earlier reported stale listener/404 could not be reproduced in this
  session. No unrelated process was terminated.
- Starting the intended workflows produced one Uvicorn listener on 8080 and
  one portal Vite listener on 25965, with no bind conflicts.
- Direct API, loopback workspace ingress and HTTPS workspace preview all
  returned HTTP 200 `application/json`, `{"role":null}`, `no-store` for
  localhost and a valid unmapped DNS hostname. Direct Vite returned HTML,
  confirming why the normal ingress, rather than its standalone port, matters.
- A fresh browser visit through the HTTPS preview resolved the actual preview
  hostname with HTTP 200 `application/json`, `{"role":null}` and displayed the
  chooser. A visitor-only intercepted 503 displayed explicit retry with no
  chooser/login. Removing that interception and clicking Retry obtained actual
  HTTP 200 JSON and restored the chooser.
- Read-only diagnostics found revision `0031_role_hostnames` and the resolver
  schema present. Readiness remained HTTP 503; no managed migration, schema
  stamp, mapping edit, data reset or encryption-key change was performed.
- Normal disposable harness initialization is independently blocked by two
  Alembic heads: `0031_role_hostnames` and `0031_remove_organizations`.
  The retirement migration file is named `0032_remove_organizations.py` but
  declares the latter revision; runtime readiness requires
  `0032_remove_organizations`. This graph/runtime mismatch needs separately
  reviewed reconciliation before any approved shared-database rollout.
- The 16 smoke-check unit tests passed. The 31 backend hostname tests passed
  on a disposable PostgreSQL instance using explicit ordered upgrades to the
  two declared revisions (hostname first, retirement second), without source
  changes or stamping. This diagnostic does **not** establish that normal
  `upgrade head`, full readiness or the release suite succeeds.
- All three `role-urls.preview.spec.mjs` cases passed with the same explicit
  ordered upgrades in the existing disposable browser harness. This covered
  mapped Admin/MR/Doctor entry, incompatible paths, unknown-host chooser,
  retry, protected mapping management, Admin/MR sign-in/renewal/logout and
  host-only cookie/identity boundaries. No shared mapping was modified.
