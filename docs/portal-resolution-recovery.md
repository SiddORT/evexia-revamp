# Portal resolution recovery

For the current ownership/admission release, first read
[domain-admission.md](domain-admission.md). Enabled legacy mappings alone no
longer admit custom hosts. Production requires exact operator-approved recovery
hosts; resolver query parameters must match the actual request host. Arbitrary
unmapped hosts are not a production recovery mechanism.

## Hostname-only operator handoff

The separately scoped procedure and its exact conditional operator sequence are
in [hostname-only-operator.md](hostname-only-operator.md). It targets only
`0031_role_hostnames`; it does not authorize deployment, service stops/resumption,
organization retirement, merge, phone migration or any live execution by the agent.

## Separate environments and approval boundaries

Private Replit preview access and UAT database lookup failures are independent.
Do not make the preview public, change DNS, weaken authentication/CORS, infer an
unmapped role on failure, or modify migration policy to make entry work.
Do not push `main`: that triggers the existing live deployment workflow.
Any live settings change, deployment, migration or service restart needs
separate confirmation of the exact evidence-supported action.

## Development preview correction

Vite supplies its exact `REPLIT_DEV_DOMAIN` to the resolver only while serving
development. The resolver uses `credentials: same-origin` only on that exact
HTTPS hostname with no nonstandard port. Production builds and other origins
retain `omit`. This sends preview-access cookies to the existing same-origin
ingress, not a bearer token or a cross-origin API. Redirects are rejected rather
than followed; HTML login pages, outages, malformed JSON and invalid roles keep
the explicit error/Retry screen. The original abort/15-second timeout and
mapped-role path boundary remain in place.

A loopback screenshot or workspace-side HTTPS probe is not evidence of access
through the original private browser gate. Verify the original preview hostname
in an authorized browser. Record only status, content type, valid role JSON,
no-store, and visible entry outcome; do not record cookies, tokens, redirect
query strings or credential-bearing URLs.

## UAT: bounded read-only operator diagnostics

No authorized VPS session is available in the workspace. An operator should
use their existing secure session on the VPS. Do not paste SSH keys, passwords,
environment files, raw logs, `docker inspect` output or `nginx -T` into chat.
Do not invoke the historical VPS `deploy.sh` or upgrade/stamp any database.

1. In `/var/www/admin-uat.allergyevexia.in`, record the active checkout commit:
   `git rev-parse HEAD`. Record whether it has tracked changes with
   `git diff --quiet; echo $?`. Compare the running image to this release,
   not merely the checkout's source.
2. Inspect **only** these safe container fields:

   ```sh
   docker inspect --format \
     'image_id={{.Image}} image_tag={{.Config.Image}} started={{.State.StartedAt}} restarts={{.RestartCount}} pid={{.State.Pid}} running={{.State.Running}}' \
     evexia-backend
   docker image inspect --format '{{.Id}} {{json .RepoTags}}' \
     "$(docker inspect --format '{{.Image}}' evexia-backend)"
   docker exec evexia-backend sh -c \
     'sha256sum /app/app/api/v1/role_urls.py /app/app/db/session.py /app/app/db/role_url_models.py /app/app/core/schema.py'
   ```

   Compare source hashes to the claimed release. `Config.Image` alone does not
   prove source identity. Read-only container exec starts no app listener.
3. Inspect the active proxy locally and report **only** the actual `/api`
   upstream address/port and whether it preserves `/api/v1/...`, not complete
   configuration. Compare to the backend's network endpoint. Inspect listening
   sockets and owning process/container (`ss -ltnp`) locally. Report only API
   listener ownership, bind conflicts, start/restart times, and duplicate/stale
   services. Do not stop any listener.
4. Send the reviewed `scripts/diagnose-portal-runtime.py` to the existing
   runtime via stdin, without rebuilding or mounting a candidate app:

   ```sh
   docker exec -i -w /app evexia-backend \
     uv run --no-sync --project /workspace python - newuat.allergyevexia.in \
     < /path/to/reviewed/diagnose-portal-runtime.py
   ```

   The script imports the **running container's** app session factory and schema,
   uses READ ONLY transactions, five-second statement and one-second lock
   deadlines, and a 45-second total deadline. It checks applied revision,
   mapping columns/constraints, visibility/SELECT privileges and the identical
   DNS-host SQL lookup. It never prints row data, configured role, raw SQL
   parameters, connection strings, keys or exception details. Target database,
   user, server, active schema and search path are fingerprinted. Compare those
   fingerprints to the intended deployment target locally. Confirm privately
   whether search path is correct; do not infer correctness from a fingerprint.
   A fresh diagnostic connection shares the container settings, not the
   long-running process's cached pool; disagreements require further read-only
   investigation of process start/configuration and pool ownership.
5. Probe public resolver with actual hostname, localhost resolver, liveness,
   and readiness independently, without following redirects or sending
   application credentials. For example:

   ```sh
   node scripts/check-portal-hostname.mjs https://newuat.allergyevexia.in
   ```

   Its first probe must succeed before the second DNS probe is attempted.
   Localhost deliberately bypasses the database lookup; HTTP 200 there does
   not establish schema health. Readiness also has wider schema/encryption
   prerequisites and must be reported independently.

## Select a correction only after runtime evidence

- Connection/authentication failures: verify intended DB identity and runtime
  configuration privately. Propose only the precise correction and necessary
  restart using existing tooling, with separate approval.
- Privilege/search-path failures: have the operator review the intended schema
  and minimum SELECT permissions. No broad grants or substitute mapping table.
- Missing/incompatible schema or release: coordinate the reviewed schema/release
  prerequisites using existing deployment and operator procedures. Stop at
  protected boundaries until approvals, backup/rehearsal/retention evidence
  and write exclusion are satisfied. No blind upgrade-to-head or stamping.
- Fresh diagnostic lookup works while public lookup fails: verify actual proxy
  destination, running source hashes and listener/pool ownership before proposing
  a restart. Do not assume the public request reaches the inspected runtime.

After separately approved recovery, repeat the public resolver checks and a
fresh browser visit. Require HTTP 200 application/json, valid role JSON,
no-store and the expected chooser/role entry. Record the exact approved commands
and readiness separately. Until then, live UAT recovery remains unfinished.

## Observations on 2026-10-12 (before live changes)

- Workspace-side HTTPS preview, loopback ingress and direct API probes returned
  HTTP 200 JSON `{"role":null}`, `no-store`; readiness was HTTP 503.
  These are not authorized original-preview browser evidence.
- Public UAT actual hostname returned HTTP 503 JSON, `no-store`;
  localhost resolver returned HTTP 200 `{"role":null}`, `no-store`.
  Liveness returned HTTP 200 and readiness HTTP 503.
- Workspace process inspection showed one intended Uvicorn process on port 8080
  and the portal Vite process; no service was terminated.
- No VPS login, deployment, database change, secret/key replacement or push to
  a deployment-triggering branch has been performed.
