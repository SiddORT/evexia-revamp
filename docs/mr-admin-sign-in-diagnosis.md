# MR and Admin preview sign-in diagnosis

## Repair and user-assisted confirmation — 2026-10-23

### Established blocker and correction

The available managed preview received three `POST /api/v1/auth/login`
requests returning 403 before the repair. One correlation ID was
`00261241-7b7b-41bb-a006-c7fe4fd761f3`, observed in the log snapshot collected
at 06:17 UTC. The request records do not include per-request timestamps.
The user identified `login` on `/admin/login` as the failing operation.

The login route's origin dependency rejects an unapproved origin with 403
before credential checking; its credential/portal failures return 401 instead.
The development configuration retained older explicit preview origins.
A read-only health request carrying the current platform preview origin
returned 200 but did not receive matching origin admission
(`006a995e-8d03-40fc-b959-e083b9d3f15d`).
Thus a concrete origin-admission blocker was established in this runtime,
independently of the earlier generic readiness 503.

`Settings.allowed_origins` now retains the configured origins and adds the
exact HTTPS hostname supplied by `REPLIT_DEV_DOMAIN` only when both development
mode and the managed-preview flag are active. It rejects malformed hostnames.
It never derives trust from request headers, allows no wildcard, and leaves
production and unmanaged runtime behavior unchanged. No frontend/authentication
transport, credentials, roles, keys or stored records were changed.

### Actual runtime evidence and limitations

Only the API workflow was restarted to activate the demonstrated repair, using
its normal automatic development synchronization lifecycle. Startup reported
schema `0057_staff_employee_code`, `applied: []`, and successful application
startup. This was repair activation, not a migration-launcher reproduction.

At 06:18 UTC, routed health and readiness returned 200 and explicitly admitted
the current HTTPS preview origin. The API's loaded source identity was
`e6ed7ba3e77ddc69cedb0a4bd61559b8e3c602e939bfda6ce539ae281986c766`.
The unchanged running frontend source identity previously observed was
`9f87807b608285186248fcd5d8af3f160d40d21fdca2b59a0aa8ec99e6097e86`.
The public Admin page also rendered normally in a screenshot.
The frontend was not restarted; its startup backend-identity snapshot predates
the repair, so no frontend/API compatibility-alignment claim is made.

After the user was asked to sign in personally in the affected preview and
reload each protected page once, they explicitly confirmed **both Admin and MR
dashboards open and survive reload**. The available API log snapshot collected
at 06:19 UTC independently contains two login 200 responses, each followed by
two `/me` 200 responses. Login correlation IDs:
`e32ad363-742f-451e-b0a3-916aee61674a` and
`acc41e4a-97fb-4fd6-bd63-36d694d00323`.
Logs intentionally do not identify which account/portal produced each sequence.
They also show logout 204 responses and a refresh 401 between the sequences;
they do **not** establish a successful refresh rotation. Reload persistence and
portal-specific destinations are user-confirmed, not independently browser-driven.

The accessible runtime is the task workspace. The user supplied a page path,
not an independently addressable original-preview origin. Original-preview
success therefore rests on their affected-preview confirmation; the historical
original 503 and a separate original runtime's serving revision remain
unestablished. No claim is made that merge itself activates any runtime.
The exact-host correction can follow the existing original-development
post-merge/startup lifecycle without copying this fork's hostname into settings.

No regression/release checks, builds, compatibility wrappers, synthetic
identities or agent-submitted logins were launched for this repair. On the
initial inspection, release/check workflows were unexpectedly already running;
they were stopped immediately. Existing output confirms some fixture setup
and a coverage audit had already executed, so this session cannot be described
as having had no check execution at all. None restarted during API repair.
No production/VPS access, pushes, deployments, account changes, recovery emails
or secret changes were performed.

## Historical diagnosis — before the repair

### Finding

The original preview's underlying sign-in blocker **cannot be established from
the runtime available to this investigation**. The planning observation was
HTTP 503 JSON, code `service_unavailable`, from
`GET /api/v1/health/readiness` on local port 8080. That proves a readiness
failure at that time, not its dependency cause or which authentication
operation failed in the reported browser.

The isolated task workspace has no running API or portal. This explains its
current local failures but must not be substituted for a diagnosis of the
original preview's earlier 503.

## Current sanitized evidence

Observed on 2026-10-23, approximately 06:06 UTC:

| Observation | Result |
| --- | --- |
| API workflow status | `not_started`, configured port 8080, no open ports or captured output |
| Portal workflow status | `not_started`, no open ports or captured output |
| All configured release/check workflows | `not_started`; none started by this investigation |
| Active TCP listeners/process inspection | No port 8080 listener; no running Uvicorn or Vite application process found |
| Anonymous `GET http://127.0.0.1:8080/api/v1/health/readiness` | Connection refused; no HTTP response |
| Anonymous `GET /api/v1/health/readiness` through local port 80 router | HTTP 502; no API JSON error code or `X-Request-ID` |
| Anonymous `GET /admin/login` through local port 80 router | HTTP 502; no `X-Request-ID` |

The two router observations were made at approximately 06:06:50 UTC. They did
not carry cookies, credentials or authorization headers, did not follow
redirects, and did not invoke authentication operations.

Current managed workflow status supplied no API startup/runtime log to inspect.
Historical release failures described during planning were not rerun and are
not evidence of the cause of this outage. The healthy runtime recorded in
`artifacts/evexia-portal/tests/admin-login-diagnostics.md` on 2026-10-14 is
historical too, not evidence that the affected preview is healthy now.

## Shared failure boundary

- **Routing:** both portals use the same-origin `/api/v1/auth` request helper
  in `artifacts/evexia-portal/src/auth/adminSession.js`. The managed API owns
  `/api`; Vite has an explicit API proxy only when its isolated-test target is
  configured. Direct Vite-port behavior is not proof of managed ingress routing.
- **Message:** HTTP failures other than 401, 403 and 429 produce the reported
  generic service-unavailable message. This includes 404/405 routing failures
  and 5xx responses. Network rejection and malformed successful JSON have
  different messages. The screenshot's wording alone cannot identify an
  endpoint, status, dependency or affected account.
- **Login:** both portals call `POST /api/v1/auth/login`, with distinct portal
  selectors. Database rate-limit checks and encrypted identifier lookup are
  shared. A successful login creates/replaces sessions and writes audit data,
  so no login was attempted.
- **Refresh:** session restoration calls `POST /api/v1/auth/refresh`, which
  rotates credentials and records security outcomes. Even a missing-cookie
  attempt writes an event. No refresh was attempted.
- **Identity verification:** a successful login or refresh is followed by
  authenticated `GET /api/v1/auth/me`; existing unexpired sessions also use
  `/me`. Failure here can display the same message after login succeeded.
  An unauthenticated `/me` request is not a harmless substitute: its dependency
  records and commits a missing-bearer rejection. No `/me` request was made.
- **Readiness:** `app/api/v1/system.py` checks the declared schema, directory
  and account encryption readiness, communication encryption, and additional
  feature tables/configuration. It deliberately catches underlying exceptions
  and returns generic 503. Authentication routes do not first call this
  endpoint. Thus failed readiness may share a database/account prerequisite
  with authentication, or may reflect a separate feature prerequisite.
  A generic readiness 503 cannot distinguish connectivity, schema or keys.
- **Development compatibility:** explicit compatibility diagnostics are
  separate from ordinary authentication and readiness; none were invoked.

There is no evidence here justifying a password reset, key replacement, origin
allowlist change, schema migration, or authentication/security-code change.

## Correlation and smallest next action

The original screenshot's development origin, failing operation, timestamp and
request ID are not present in the supplied evidence. With no running local API,
there is no loaded backend identity or current API request log to correlate.
The fork's local 502 responses have no API request ID. They cannot be matched
to the original preview's earlier application-generated 503.

The next step is to collect existing evidence in the **affected original
preview**, not start this fork to imitate it. Request only these four fields
from an already-failed browser request:

1. Operation: `login`, `refresh` or `me`.
2. HTTP status.
3. Timestamp, including timezone.
4. Server-generated `X-Request-ID`, if present.

Do not send a HAR, full request/response payloads, credentials, identifiers,
cookies, tokens, authorization headers or full URLs with query/fragment data.
Correlate those fields with sanitized existing API logs in that same runtime.
If those logs retain only generic failures, a separately authorized, narrowly
read-only dependency observation is needed before naming a dependency remedy.

For this fork alone, restoring unavailable services would address its absence
of listeners, but that is **not an established remedy for the original 503**.
It requires separate authorization: the API launcher runs schema-review refresh
and automatic database synchronization before Uvicorn, so starting it is not a
read-only diagnostic and may affect shared data. Do not start the aggregate
Project/release workflow. Any session-mutating reproduction also requires
separate authorization.

## Scope preserved

Only source inspection, workflow-status observations, listener/process metadata
and the three anonymous GET observations above were performed. No regression or
release checks, builds, compatibility wrappers, service starts/restarts,
migrations, deployments, credential submissions, synthetic logins, account
changes, password resets, secret reads/changes or application-data writes were
performed. Only this diagnosis document was added.
