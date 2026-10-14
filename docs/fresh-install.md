# Fresh production installation (dedicated empty PostgreSQL)

This is an **operator procedure**, never a CI fallback. Do not run
`deploy-scripts/deploy.sh` or a bare historical `initialize-api.sh`.
The current entry point requires an explicit `prepare` or `finalize` phase.
No stamp, test environment, skipped migration, hand-built schema or automatically
claimed retirement/recovery approval is used.

## Reviewed history and scope

All **40** migration files and their upgrade/downgrade guards were reviewed.
`scripts/fresh-install-review.json` pins their bytes by **revision ID**, the
direct guard-module bytes, unchanged policy, preparation target and final head.
Any changed/unclassified revision or changed reviewed guard requires a new
review, not a runtime override.

| Revisions | Fresh-database behavior / relevant guards |
| --- | --- |
| 0001–0004 | Create identity, username, domain and private-file metadata; no account/file seeds. |
| 0005–0008 | Protected-admin/session/history guards; refuse conflicting existing admins/credentials; install trusted `pg_trgm` and reporting indexes. |
| 0009; both 0010 revisions; 0011–0017 | Empty encrypted staff/masters/custom roles; deferred identity/lifecycle triggers; no permission grants or seed accounts. Custom-role downgrade is forward-only. |
| Both 0018 revisions; 0019–0024 (including both 0022 revisions) | Empty directories/catalogs/targets/balances; namespace collision, reference and validation guards remain active. |
| 0025–0027; both 0028 revisions; both 0029 revisions | Phone widening, destructive payroll retirement, designation/actor reconciliation and additive encryption. Reconciliation succeeds only because catalogs are genuinely empty; no invented mappings/actors. |
| 0030_directory_crypto_retirement | Existing migration explicitly permits empty directories, **but still validates production encryption configuration**. Populated directories retain all freeze/recovery/approval guards. |
| 0031_role_hostnames | Empty hostname table; preparation stops here. No account is bootstrapped yet. |
| 0031_remove_organizations | **Still protected even when empty.** Requires real external recovery, independent successful restoration rehearsal, stopped writers, retention/external-consumer review and explicit scoped approval. |
| 0033_merge_directory_branches; 0034_shared_phone_countries | Existing operator continuation, including separate phone approval and crypto validation. |
| 0035_account_identifiers | Operator-only account/reservation encryption. Fresh finalization may apply it only after proving every business table empty under locks; populated installs require separate approval and genuine backup/rehearsal evidence. |
| 0036_reference_privacy | Operator-only assignment snapshots/Vendor encryption. Fresh finalization may apply it only under the same all-business-tables-empty proof; populated installs use [the separately scoped privacy procedure](reference-privacy.md). |

Preparation proves a dedicated `public` database has **no application objects**,
including an empty `alembic_version`, tables/views/sequences/functions/types or
other user schemas. Only preinstalled trusted `plpgsql`/`pg_trgm` extension
objects are tolerated; no relations, even extension-owned ones, are tolerated.
It takes the existing PostgreSQL deployment advisory lock. The pristine proof,
all original migrations through `0031_role_hostnames`, and the final revision
check share **one transaction/connection**. The Alembic environment now supports
this supplied transaction; ordinary Alembic/CI connection behavior is unchanged.

Both phases also require an independently approved **database name and
PostgreSQL cluster system identifier**. They compare these with the actual
connected server before taking the database advisory lock or changing schema/accounts.
An empty database on the wrong cluster is not authorized just because it is
empty. Missing identity arguments, mismatches, or inability to read
`pg_catalog.pg_control_system()` fail closed.

## Prerequisites: human approval/evidence, not defaults

Retain an approved change record identifying the production server/database,
reviewed source SHA/image, empty-install authorization and separate retirement,
phone-continuation, recovery-export and optional Admin-hostname authorization.
Record the intended database name, server/network identity and PostgreSQL
cluster system identifier independently of the tool's `DATABASE_URL`.
On an already approved operator client connection (private service/password
configuration), the read-only evidence query is:

```sh
psql -X -v ON_ERROR_STOP=1 -c \
  'SELECT current_database(), system_identifier, inet_server_addr(), inet_server_port() FROM pg_catalog.pg_control_system();'
```

Have the operator reconcile the result with the approved infrastructure target;
do not automatically derive the confirmation arguments from the same connection
being initialized. Physical replicas/clones can share a system identifier:
it does not replace human server/network verification. The DB role needs
preapproved permission to read `pg_control_system()` as well as historical DDL.
If that permission is absent, stop for DBA review; the tool never grants it.
Inventory and drain **every** application/background/import/external SQL writer.
The marker/lock does not stop writers or close public traffic.

The existing backend-only environment must already provide:

- `APP_ENV=production`, PostgreSQL `DATABASE_URL` for the intended dedicated DB.
- A valid `SESSION_SECRET` (or existing `JWT_SECRET` signing configuration).
- `STAFF_ENCRYPTION_KEYS`, `STAFF_EMAIL_INDEX_KEY`, and the matching active
  `STAFF_ENCRYPTION_KEY_ID` (defaults to `primary`).
- `DIRECTORY_ENCRYPTION_KEYS`, `DIRECTORY_INDEX_KEY`, matching
  `DIRECTORY_ENCRYPTION_KEY_ID` (defaults to `primary`).
- `SUPER_ADMIN_INITIAL_PASSWORD`, 12–128 characters.

Encryption/index/signing keys must satisfy the existing independent-key checks.
No values are printed. Missing configuration stops initialization; this
procedure does **not** edit `.env`. Existing CORS/storage/scanner settings stay
unchanged. The reviewed DB owner must be able to execute the historical DDL and
install trusted `pg_trgm`. Use the same reviewed DB role for recovery export and
retirement; arbitrary grants/owners/catalog dependencies block retirement.

Arrange an approved **durable external** recovery volume, outside all checkouts
and the active deployment, private directory 0700, matching operator UID, files
0600, canonical paths/no symlinks. `install -d` alone does not prove durability.
Arrange an independent isolated PostgreSQL rehearsal server in advance, with
matching DB name/schema/DB-role name and encryption keys, but a **different
server connection**. Its credentials/evidence belong in private operator
storage, never this repository. Never point a rehearsal command at production.
Provide its sole `DATABASE_URL` override in an existing canonical, operator-owned
0600 `/restricted/operator/retirement/clone.env`, on that same private volume.
This is a **new independent operator file**, not the active `.env`. Do not
include other settings or approval flags in it. Human evidence must establish
the actual independent server identity; different URL strings alone do not.

## Exact VPS execution pattern (operator only; not performed by Agent)

First make the reviewed commit available in the approved Git remote; this task
does not push it. These commands extract a sibling checkout/build a tooling
image, without replacing active Compose configuration, application containers,
Nginx/HTTPS, storage or unrelated services:

```sh
ACTIVE=/var/www/newuat.allergyevexia.in
umask 077
: "${REVIEWED_SHA:?Set the reviewed committed release SHA}"
RELEASE="/var/www/evexia-operator-$REVIEWED_SHA"
git -C "$ACTIVE" fetch origin "$REVIEWED_SHA"
install -d -m 0700 "$RELEASE"
git -C "$ACTIVE" archive "$REVIEWED_SHA" | tar -x -C "$RELEASE"
PINNED_BACKEND_IMAGE="evexia-operator:$REVIEWED_SHA"
docker build -f "$RELEASE/artifacts/api-server/backend/Dockerfile" \
  -t "$PINNED_BACKEND_IMAGE" "$RELEASE"
NETWORKS=$(docker inspect --format \
  '{{ range $name, $_ := .NetworkSettings.Networks }}{{ println $name }}{{ end }}' evexia-backend)
test "$(printf '%s\n' "$NETWORKS" | sed '/^$/d' | wc -l)" -eq 1 || exit 1
NETWORK=$(printf '%s\n' "$NETWORKS" | sed '/^$/d')
RECOVERY_DIR=/restricted/operator/retirement
# Already on approved durable storage, owned by this operator:
install -d -m 0700 "$RECOVERY_DIR"
```

Create/retain the canonical maintenance marker **under CI's host flock**.
Do not truncate an existing lock/marker, follow symlinks, or replace its inode.
Retain a marker from an interrupted rollout until reviewed recovery succeeds:

```sh
(
  exec 9>>"$ACTIVE/.deploy.lock"
  flock -x 9
  python3 - "$ACTIVE" <<'PY'
import os, pathlib, stat, sys
root = pathlib.Path(sys.argv[1])
for path in (root, root / ".deploy.lock"):
    assert path == path.resolve(strict=True)
assert stat.S_ISREG((root / ".deploy.lock").stat().st_mode)
marker = root / ".operator-maintenance"
if os.path.lexists(marker):
    assert marker == marker.resolve(strict=True) and stat.S_ISREG(marker.stat().st_mode)
else:
    fd = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    os.fsync(fd); os.close(fd)
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    os.fsync(directory); os.close(directory)
PY
)
# Human: close/drain relevant traffic and stop all external/background writers.
# Stop only this application's backend, after approved writer-drain arrangements:
docker stop evexia-backend
```

Now open **one persistent interactive tooling supervisor**. Docker cannot inherit
the host shell's FD9. This Python supervisor acquires the **same host inode**
inside the container, makes FD9 inheritable, and holds it across preparation,
export, the independent rehearsal, continuation, final verification and traffic
reopening. Keep this shell open throughout. No Docker socket/storage mounts or
application server are needed:

```sh
docker run --rm -it --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" --network "$NETWORK" --env-file "$ACTIVE/.env" \
  -e APP_ENV=production -e PYTHONDONTWRITEBYTECODE=1 \
  -e PYTHONPATH=/operator-release/artifacts/api-server/backend \
  -e EVEXIA_OPERATOR_PYTHON=/workspace/.venv/bin/python \
  -e EVEXIA_DEPLOY_LOCK="$ACTIVE/.deploy.lock" -e EVEXIA_DEPLOY_LOCK_FD=9 \
  --mount "type=bind,src=$RELEASE,dst=/operator-release,readonly" \
  --mount "type=bind,src=$ACTIVE/.deploy.lock,dst=$ACTIVE/.deploy.lock" \
  --mount "type=bind,src=$ACTIVE/.operator-maintenance,dst=$ACTIVE/.operator-maintenance" \
  --mount "type=bind,src=$RECOVERY_DIR,dst=$RECOVERY_DIR" \
  --workdir /operator-release/artifacts/api-server/backend \
  --entrypoint /workspace/.venv/bin/python "$PINNED_BACKEND_IMAGE" -B -c '
import fcntl, os
fd = os.open(os.environ["EVEXIA_DEPLOY_LOCK"], os.O_RDWR | os.O_NOFOLLOW)
fcntl.flock(fd, fcntl.LOCK_EX)
if fd != 9:
    os.dup2(fd, 9); os.close(fd)
os.set_inheritable(9, True)
os.execvpe("/bin/bash", ["bash", "--noprofile", "--norc"], os.environ)
'
```

Inside that supervisor, after explicitly approving the pristine-install scope:

```sh
: "${APPROVED_DB_NAME:?Database name from independently approved target evidence}"
: "${APPROVED_CLUSTER_ID:?PostgreSQL system identifier from independently approved target evidence}"
sh /operator-release/scripts/initialize-api.sh \
  prepare --approve-fresh-install --writers-stopped \
  --expected-database "$APPROVED_DB_NAME" \
  --expected-system-identifier "$APPROVED_CLUSTER_ID"
# Expected: FRESH_INSTALL_PREPARED ... 0031_role_hostnames ... NOT READY
/workspace/.venv/bin/python -B -m app.organization_preflight \
  --backup /restricted/operator/retirement/recovery.json
```

Retain the successful zero-dependency preflight, counts, target identity and
returned backup SHA. Export reports `restoration_verified: false`: a SHA is
**only integrity evidence**. Do not bootstrap or reopen traffic at this point.

## Independent restoration rehearsal — required before retirement

Human-approved separate operation, while the production supervisor remains open:

1. Take/retain a durable full predecessor backup plus a data-only rehearsal
   archive. For the **proven unused fresh installation only**, produce the latter
   from the predecessor with:
   ```sh
   pg_dump -Fc -f /restricted/operator/retirement/full-predecessor.dump
   pg_dump -Fc --exclude-table-data=public.alembic_version \
     --exclude-table-data=public.directory_crypto_stage \
     -f /restricted/operator/retirement/fresh-data.dump
   ```
   Supply the real approved target through private `PGSERVICEFILE`/`PGPASSFILE`,
   not credentials on the command line. This is a PostgreSQL **client** command
   on an approved operator host; the backend image does not include `pg_dump`.
2. On the independently isolated, genuinely pristine rehearsal database, run
   the same `prepare` command with its **private clone environment** and inherited
   supervisor lock, not production's `DATABASE_URL`. All original schema
   migrations replay. They create the real version/staging metadata; those
   metadata rows are deliberately not copied, edited or stamped.
   From the still-locked tooling supervisor, use this explicit child-environment
   function (no new Docker process; FD9 is inherited, not reacquired):
   ```sh
   clone_run() {
     /workspace/.venv/bin/python -B - /restricted/operator/retirement/clone.env "$@" <<'PY'
   import os, pathlib, stat, subprocess, sys
   from dotenv import dotenv_values
   try:
       path = pathlib.Path(sys.argv[1])
       info = path.stat()
       assert path == path.resolve(strict=True) and stat.S_ISREG(info.st_mode)
       assert info.st_uid == os.getuid() and info.st_mode & 0o077 == 0
       values = dotenv_values(path)
       assert set(values) == {"DATABASE_URL"} and values["DATABASE_URL"]
       assert values["DATABASE_URL"] != os.environ["DATABASE_URL"]
       env = dict(os.environ, DATABASE_URL=values["DATABASE_URL"], APP_ENV="production")
       code = subprocess.run(sys.argv[2:], env=env, pass_fds=(9,)).returncode
   except Exception:
       print("Independent clone configuration/execution blocked; no credentials printed.")
       code = 1
   sys.exit(code)
   PY
   }
   : "${APPROVED_REHEARSAL_DB_NAME:?Independently approved isolated clone database name}"
   : "${APPROVED_REHEARSAL_CLUSTER_ID:?Independently approved clone system identifier}"
   test "$APPROVED_REHEARSAL_CLUSTER_ID" != "$APPROVED_CLUSTER_ID" || exit 1
   clone_run /workspace/.venv/bin/python -B -m app.fresh_install \
     prepare --approve-fresh-install --writers-stopped \
     --expected-database "$APPROVED_REHEARSAL_DB_NAME" \
     --expected-system-identifier "$APPROVED_REHEARSAL_CLUSTER_ID"
   ```
3. Restore business data using the real PostgreSQL client:
   ```sh
   pg_restore --data-only --exit-on-error \
     -d "$APPROVED_REHEARSAL_DB_NAME" /restricted/operator/retirement/fresh-data.dump
   ```
   Its private service/password settings must identify the independent server.
   Do not restore schema DDL over the replayed schema or disable triggers.
   A full schema `pg_restore` reserializes the membership role CHECK and can
   violate the existing strict catalog guard even for equivalent expressions.
   Do not alter the guard or patch that restored CHECK to force acceptance.
4. On the clone, run `app.organization_preflight` and independently compare
   `organization_retirement.snapshot(connection)` with
   `organization_retirement.load_backup(recovery_path, reviewed_sha256)`.
   Retain actual restoration logs, zero-dependency preflight, full comparison
   result, source/clone server identities, matching DB/schema/role, archive and
   recovery hashes, timestamps and operator identity. This verifies restored
   data, not merely readable bytes or a matching hash.
   After the independently targeted client restore has succeeded, use:
   ```sh
   clone_run /workspace/.venv/bin/python -B -m app.organization_preflight
   : "${SHA:?Retained export digest required for comparison}"
   clone_run /workspace/.venv/bin/python -B -c '
   import sys
   from sqlalchemy import create_engine, text
   from app.core.config import get_settings
   from app.services import organization_retirement as r
   try:
       engine = create_engine(r.connection_url(get_settings().database_url), hide_parameters=True)
       with engine.connect() as db, db.begin():
           db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
           assert r.preflight(db)["unexpected_dependency_count"] == 0
           assert r.snapshot(db) == r.load_backup(sys.argv[1], sys.argv[2])
       print("INDEPENDENT_RESTORED_DATA_MATCHES: retain restoration logs and human attestation.")
   except Exception:
       print("RESTORATION_COMPARISON_BLOCKED: no approval inferred.")
       sys.exit(1)
   ' /restricted/operator/retirement/recovery.json "$SHA"
   ```
5. Approve/retain a separate successful restoration attestation naming that
   exact recovery SHA. Existing-record recoveries must use their original
   reviewed runbook, **not** this fresh-only metadata/data procedure.

The automated production-mode tests perform this real independent
replay/`pg_dump`/`pg_restore`/comparison on two private PostgreSQL clusters before
supplying any retirement approval. Passing tests is not production approval.

## Existing protected continuation, then finalization

Back inside the still-locked production supervisor, **only after** all genuine
retirement prerequisites and separate phone approval have been satisfied:

```sh
BACKUP=/restricted/operator/retirement/recovery.json
# Set SHA from retained export evidence; set RESTORED_SHA separately from the
# successful independent restoration attestation. Do not automatically copy SHA.
: "${SHA:?Verified export digest required}"
: "${RESTORED_SHA:?Digest explicitly covered by successful restoration attestation required}"
bash /operator-release/scripts/operator-retirement.sh \
  --backup "$BACKUP" --sha256 "$SHA" --restore-verified "$RESTORED_SHA" \
  --attest-restoration-rehearsal --approve-retirement --writers-stopped \
  --external-consumers-reviewed --backup-durable --retention-resolved \
  --approve-phone-continuation

# Separate bootstrap/hostname approval. Omit --admin-hostname if not approved;
# then /portal/resolve returns 200 with role:null until a hostname is configured.
sh /operator-release/scripts/initialize-api.sh \
  finalize --approve-bootstrap --writers-stopped \
  --expected-database "$APPROVED_DB_NAME" \
  --expected-system-identifier "$APPROVED_CLUSTER_ID" \
  --admin-hostname newuat.allergyevexia.in
# Expected: FRESH_INSTALL_READY ... 0036_reference_privacy
/workspace/.venv/bin/python -B -m alembic current
/workspace/.venv/bin/python -B /operator-release/scripts/deploy-migrations.py \
  --backend-dir /operator-release/artifacts/api-server/backend
# Expected: exact single 0035 revision, policy READY, no migrations applied.
```

Finalization refuses other revisions, unexpected tables/views and **any existing
application records**. It uses the existing protected bootstrap and unchanged
readiness checks in one outer transaction; hostname/audit writes are atomic with
account creation. It never rotates existing credentials or seeds master data.
The reserved login is `crm-admin@allergyevexia.in`, using the already-configured
initial password. No password is printed.

From a second host terminal, with the supervisor still holding FD9, verify the
existing backend is the reviewed matching `0035` release before restarting it:

```sh
docker start evexia-backend
curl --fail-with-body https://newuat.allergyevexia.in/api/v1/health/readiness
curl --fail-with-body \
  'https://newuat.allergyevexia.in/api/v1/portal/resolve?hostname=newuat.allergyevexia.in'
# Expected: ready; role admin if explicitly initialized above.
```

Verify actual Admin login and required role behavior. Only after successful
readiness/authentication verification, approved traffic reopening and writer
handover, remove the host marker from that second terminal:

```sh
rm -- /var/www/newuat.allergyevexia.in/.operator-maintenance
```

Then exit the supervisor to release FD9. The next normal CI run sees the current
head and resumes its unchanged guarded migration/promotion process. If an
application replacement is needed instead of restarting the matching existing
image, use a separately reviewed supervised release promotion, not the legacy
unconditional migration deploy script. No Compose/Nginx/HTTPS/storage changes
are part of initialization.

## Failure/recovery

- Validation/target-identity/pristine failure: no migrations/accounts applied. Existing/nonempty
  databases must use the existing guarded policy/operator workflow.
- Preparation errors before commit: the entire supplied transaction rolls back,
  including historical DDL. After connection loss/ambiguous acknowledgement,
  **inspect actual committed revision/catalog** before any retry. A committed
  preparation is deliberately rejected by `prepare`; continue the recovery
  procedure from its real `0031_role_hostnames` state.
- Export/rehearsal failure: stay at the predecessor; keep marker, writer drain,
  supervisor and original artifacts. Never auto-claim restoration success,
  overwrite an existing recovery file or regenerate signing/encryption keys.
- Retirement/merge/phone failure: earlier wrapper invocations may be committed.
  Retain maintenance and inspect the actual revision. Follow the original
  explicitly reviewed recovery/continuation procedure; no automatic downgrade,
  retry, stamp or old-release restart.
- Finalization errors before commit: account/hostname/audit writes roll back
  together. Verify actual state after ambiguous commit. A successful but
  unacknowledged bootstrap causes a retry to refuse populated tables, not change
  the password. Check the protected account and readiness instead.
- Supervisor interruption releases its kernel lock but **leaves the durable
  marker**, so normal CI stays blocked. There is no EXIT-trap marker deletion.
  Do not remove it until recovery/readiness/traffic handover is independently
  approved and complete.

## Tests

```sh
sh scripts/test-fresh-install.sh
python3 -B -m unittest discover -s scripts/tests -p 'test_*.py'
sh -n scripts/initialize-api.sh scripts/test-fresh-install.sh
bash -n scripts/operator-retirement.sh
git diff --check
```

The fresh tests clear inherited credentials, run `APP_ENV=production` with
synthetic keys, and use socket-only disposable clusters under private `/tmp`.
They cannot fall back to the configured workspace or VPS database.
Coverage includes missing target confirmation and mismatched database/cluster
identities in both phases, including another pristine same-named database on
the independent server. No migration/bootstrap function executes on a mismatch.
