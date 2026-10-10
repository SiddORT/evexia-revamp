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
