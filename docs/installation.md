# EVEXIA: install once, then deploy ordinary patches automatically

## Boundaries

The schema target is `development-contract.json` (currently
`0045_pr_batch_numbers`); source metadata is generated with
`python -B scripts/review-schema-release.py --refresh` during development.
No migrations, volumes, `.env`, Compose overrides, Nginx or HTTPS settings need
to be deleted/recreated to use the procedure below.

There are three separate operations:

| Operation | Entry point | Required protection |
| --- | --- | --- |
| First installation | `scripts/initialize-production.py` | Independently supplied target, proven pristine DB, valid keys/password, host and DB locks, atomic schema/bootstrap/readiness |
| Routine patch | push to `main` / normal GitHub deployment | Successful exact-commit CI report, automatic migration policy, existing locks, runtime/image/asset verification |
| Historical migration with embedded retirement/recovery guards | Existing operator runbooks if the actual migration rejects unmet prerequisites | Genuine recovery, maintenance and dependency evidence required by that historical migration; automatic classification does not bypass its code |

**Current policy:** all revisions, including future revisions, default to automatic
in Replit development and VPS deployment. There is no separate per-migration human
approval or additive-only execution gate in the normal runners. See
[`migration-automation.md`](migration-automation.md) for remaining checks,
historical limits and destructive-change risks.

The first two operations do **not** need separately provisioned validation
signing keys, a trust JSON file, external recovery certificates or repeated human
release approval. CI reports are produced/transferred by GitHub automatically;
they are not files an operator must construct. The legacy signed staged
installer is still available, but is not the default.

## One-time prerequisites

1. Use the intended, tested checkout at
   `/var/www/admin-uat.allergyevexia.in`. Review the diff and deploy the updated
   tooling there through your authorized source-update process.
   Run as the **same Unix deployment account used by the existing GitHub SSH
   workflow**, so restricted lock/maintenance files remain accessible to CI.
   Do not change account ownership or permissions merely to bypass a failure.
2. The existing backend and PostgreSQL containers/volume must remain in place. Do **not**
   run `docker compose down -v`, reset the database, or use Alembic `stamp`.
3. `.env` must already contain the correct production `DATABASE_URL`,
   `SESSION_SECRET`, `SUPER_ADMIN_INITIAL_PASSWORD` (12–128
   characters), `STAFF_ENCRYPTION_KEYS`, `STAFF_ENCRYPTION_KEY_ID`,
   `STAFF_EMAIL_INDEX_KEY`, `DIRECTORY_ENCRYPTION_KEYS`,
   `DIRECTORY_ENCRYPTION_KEY_ID`, `DIRECTORY_INDEX_KEY`,
   `COMMUNICATION_ENCRYPTION_KEYS`, `COMMUNICATION_ENCRYPTION_KEY_ID`, and valid
   production HTTPS/CORS, exact `PORTAL_BOOTSTRAP_HOSTS` and trusted-proxy
   configuration. The existing secure-domain runbook still applies: the optional
   Admin hostname row is not a claim that DNS/TLS ownership has been verified.
   Preserve private copies of keys; this
   procedure never generates/replaces existing keys or prints passwords.
   Bootstrap preserves the application's fixed protected Super Admin identity
   (`crm-admin@allergyevexia.in`); setting another `SUPER_ADMIN_EMAIL` value does
   not reassign it.
   File-storage settings remain required for the corresponding file features.
4. Independently verify the backend's actual target. The following is
   read-only, prints no password or connection URI, and does not initialize it:

   ```sh
   cd /var/www/admin-uat.allergyevexia.in
   docker exec -i evexia-backend /workspace/.venv/bin/python - <<'PY'
   import json
   from sqlalchemy import create_engine, text
   from sqlalchemy.engine import make_url
   from app.core.config import get_settings
   url = make_url(get_settings().database_url)
   if url.drivername == "postgresql":
       url = url.set(drivername="postgresql+psycopg")
   engine = create_engine(url, hide_parameters=True)
   with engine.connect() as db:
       db.execute(text("SET TRANSACTION READ ONLY"))
       name, cluster, replica = db.execute(text(
           "SELECT current_database(),system_identifier,pg_is_in_recovery() "
           "FROM pg_control_system()")).one()
       print(json.dumps(dict(database=name, cluster=cluster, replica=replica,
           host=url.query.get("host") or url.host, port=url.port or 5432)))
   engine.dispose()
   PY
   ```

   Confirm these identify your intended database/primary, not a task copy or
   another service. Do not blindly pipe the observed identity into initialization:
   the expected values below are the operator's explicit target selection.

## Initialize: one command

The empty-only initializer includes the original `0041_location_geography`
migration after `0040_po_tax_basis`, in the same transaction. Its four
empty-default geography columns and country-code constraint are included in
the exact catalog review. It is not a separate post-install operation.
For **existing** databases, 0041 is now automatic under the project's standing
migration policy. Normal deployment plans the exact pending path and applies it
after CI/artifact validation. This fresh-install review is not proof that any
specific existing database has been migrated.

Replace the identity placeholders with the verified values above; `postgres`
is only an example hostname. The hostname option creates the initial Admin
portal mapping without enabling public registration.

```sh
cd /var/www/admin-uat.allergyevexia.in
python3 scripts/initialize-production.py \
  --expected-database newevexia_db \
  --expected-system-identifier VERIFIED_CLUSTER_INTEGER \
  --expected-host VERIFIED_DATABASE_HOST \
  --expected-port 5432 \
  --admin-hostname newuat.allergyevexia.in
```

The host wrapper holds the same exclusive `.deploy.lock` as CI, creates
`.operator-maintenance`, builds a backend candidate, and runs a disposable
`docker compose run --rm --no-deps` tool container with the reviewed source
mounted read-only. **The host retains its flock for the entire invocation;
Docker does not inherit that descriptor.** No running app/PostgreSQL service is
replaced or restarted and no Compose/Nginx/HTTPS configuration is changed.

The initializer validates production keys and password, independently supplied
host/port/database/cluster and primary state, takes the shared database
interlock, and rejects any existing version table, data tables, unreviewed
schemas or database objects. A previously initialized but empty-looking schema
is still an **existing** database and is rejected.

Only then does it run the actual Alembic dependency graph in one transaction.
The single historical organization-retirement revision has a separate,
explicit empty-install implementation: it rechecks the unchanged legacy
dependency preflight and zero counts, then performs the same retirement DDL.
It can only be reached through a closure bound to the original pristine
connection and transaction. All other original upgrade functions are executed
unchanged. No historical migration is edited, no revision is stamped/skipped,
and no approval flags or fictitious recovery receipts are supplied.

The full final catalog, migration-owned Communication constants, encrypted
account bootstrap, optional hostname and readiness are checked before commit.
`INITIALIZATION_READY` followed by `INITIALIZATION_COMPLETE` means the schema
and initial Super Admin committed successfully. It does not mean application
containers have been promoted.

## Failure/recovery

### Isolated Docker CI rehearsal

The `Smoke test empty Docker installation` GitHub workflow runs on pull requests,
can be started manually, and is a required job dependency before deployment.
It uses a new GitHub-hosted runner, the actual backend Dockerfile and repository
Compose topology, PostgreSQL 17, and generated synthetic credentials/keys only.
It never receives deployment secrets or connects to the VPS/UAT database.

The rehearsal reserves a new canonical-path fixture rather than relaxing the
wrapper's production path checks. Its original backend/frontend containers idle
without starting application writers. It verifies mounted-source imports and
read-only mounts, a non-default existing Compose project, host lock contention,
maintenance ownership, wrong host/port/database/cluster rejection, existing
schemas/version tables/data rejection, and a real atomic installation.
A test-only Python import hook raises after actual bootstrap/readiness to prove
that the entire schema and account roll back together. No historical migration
or embedded migration guard is changed or bypassed by this test.

After each invocation it compares original container IDs, images, start times,
restart counts, mounts, volume identity and cluster identity. Only after these
assertions does cleanup remove resources labeled with that CI run's random
project name. The harness refuses a nonempty Docker daemon or pre-existing
fixture checkout. Do not run it on an installation host.

### Operator recovery

#### Retrying an AccountCryptoError from the 0041 installer

The reviewed account-readiness list now explicitly includes
`0041_location_geography`. That migration adds only Storage Location geography;
account ciphertext, lookup domains and protected-account anchors are unchanged.
Unknown revisions and multiple revision rows remain blocked. Do not solve this
error by changing keys, stamping a revision or removing the readiness check.
The VPS checkout and the outcome of your earlier transaction must be inspected;
local test results do not establish their state.

**Update source without deploying.** Obtain the reviewed, merged fix through
your authorized source channel first. This task does not push to GitHub or
authorize a deployment. In particular, do not push to `main` just to transfer
the fix: that starts the normal deployment workflow. As the existing deployment
Unix account, with no initialization/deployment/operator running, inspect:

```sh
cd /var/www/admin-uat.allergyevexia.in
git status --short
git rev-parse HEAD
git fetch origin
git show --stat VERIFIED_FIX_COMMIT
git diff HEAD VERIFIED_FIX_COMMIT -- \
  artifacts/api-server/backend/app/services/account_crypto.py \
  scripts/fresh-install-review.json docs/installation.md
```

`VERIFIED_FIX_COMMIT` means the exact trusted commit containing the fix and
consistent generated review metadata, not a moving branch name. Review its full
diff and passing validation evidence too. Fetching does not check out or deploy
it. If the checkout is clean and the intended commit has been verified, update
the canonical checkout under the existing lock:

```sh
flock -n .deploy.lock git switch --detach VERIFIED_FIX_COMMIT
python3 -B scripts/review-schema-release.py
```

The metadata check needs the application's Python dependencies; if host Python
does not have them, use the existing approved tool environment rather than
installing packages or altering the check. Do not force checkout, discard local
changes, delete lock files, change file ownership, run a deploy script or restart
services. Detached source is deliberate for this non-deploying retry; normal
deployment is a separate operation after initialization succeeds.

**Inspect actual database state read-only.** Run the following using the existing
backend environment. It prints only target identity, object names, counts and
transaction/lock activity, never identifiers, passwords, keys or query text:

```sh
docker exec -i evexia-backend /workspace/.venv/bin/python - <<'PY'
import json
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from app.core.config import get_settings
url = make_url(get_settings().database_url)
if url.drivername == "postgresql":
    url = url.set(drivername="postgresql+psycopg")
engine = create_engine(url, hide_parameters=True)
with engine.connect() as db:
    db.execute(text("SET TRANSACTION READ ONLY"))
    target = db.execute(text(
        "SELECT current_database() AS database, system_identifier AS cluster, "
        "pg_is_in_recovery() AS replica FROM pg_control_system()")).mappings().one()
    print(json.dumps(dict(target)))
    objects = db.execute(text(
        "SELECT n.nspname,c.relname,c.relkind FROM pg_class c "
        "JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' "
        "ORDER BY 1,2")).all()
    print("relations:", [tuple(r) for r in objects])
    if db.scalar(text("SELECT to_regclass('public.alembic_version')")):
        print("revisions:", list(db.scalars(text("SELECT version_num FROM public.alembic_version"))))
    if db.scalar(text("SELECT to_regclass('public.users')")):
        print("accounts:", dict(db.execute(text(
            "SELECT count(*) AS total, count(*) FILTER (WHERE is_protected_system_admin) "
            "AS protected FROM public.users")).mappings().one()))
    print("other_database_sessions:", [tuple(r) for r in db.execute(text(
        "SELECT pid,state,xact_start IS NOT NULL AS has_transaction,wait_event_type "
        "FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()"))])
    print("migration_interlock:", [tuple(r) for r in db.execute(text(
        "SELECT pid,mode,granted FROM pg_locks WHERE locktype='advisory' "
        "AND classid=0 AND objid=145002 "
        "AND database=(SELECT oid FROM pg_database WHERE datname=current_database())"))])
engine.dispose()
PY
```

If these reads fail, permissions hide relevant sessions, any operator remains
active, revisions are unexpected, or objects/accounts exist in an uncertain
state, **stop and retain maintenance**. No version table is necessary for a
pristine database, but its absence alone is not sufficient: the initializer
still checks all objects, schemas, extensions and target identity. Do not reset
an existing installation. A committed schema and protected account require
readiness and protected lookup using the reviewed candidate before proceeding,
not another initialization. An older running backend can still reject 0041;
its response is not evidence that the committed database should be recreated.

For a confirmed committed installation, check the updated source without
replacing the running backend. Establish the existing Compose project exactly
as the wrapper does; stop if it cannot be verified. This uses a disposable tool
container, the existing environment and a read-only database transaction:

```sh
PROJECT=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' evexia-backend)
case "$PROJECT" in ''|*[!a-zA-Z0-9_-]*) echo "Unverified Compose project"; exit 1;; esac
docker compose --project-name "$PROJECT" --project-directory "$PWD" \
  --env-file .env -f docker-compose.yml run --rm --no-deps -T \
  --workdir /release-source -v "$PWD:/release-source:ro" \
  -e APP_ENV=production -e PYTHONPATH=/release-source/artifacts/api-server/backend \
  --entrypoint /workspace/.venv/bin/python backend -B - <<'PY'
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.api.v1.system import readiness
from app.bootstrap import SUPER_ADMIN_EMAIL
from app.db.models import User
from app.services.account_crypto import lookup
url = make_url(get_settings().database_url)
if url.drivername == "postgresql":
    url = url.set(drivername="postgresql+psycopg")
engine = create_engine(url, hide_parameters=True)
with Session(engine) as db:
    db.execute(text("SET TRANSACTION READ ONLY"))
    assert readiness(db) == {"status": "ready"}
    user = db.scalars(select(User).where(lookup(db, SUPER_ADMIN_EMAIL))).one()
    assert user.email == SUPER_ADMIN_EMAIL and user.is_protected_system_admin
    assert user.system_role == "super_admin" and user.is_active
    assert db.scalar(text("SELECT count(*) FROM users")) == 1
    print("COMMITTED_INSTALL_READINESS_AND_PROTECTED_LOOKUP_OK")
engine.dispose()
PY
```

Use this singleton-count check only for the never-used installation being
reconciled, not an installation that has since admitted other accounts.
Any failure leaves the result unresolved; retain maintenance and investigate.

**Reconcile maintenance ownership before retrying.** Under
`flock -n .deploy.lock`, inspect `.operator-maintenance` with `lstat`/`stat`
(not by following a symlink). Confirm it is a regular nonsymlink file owned by
the deployment account. Its expected JSON is
`{"operation": "empty-database-initialization"}`. Check your attempt's timing
and operator records: this generic content alone does not prove ownership.
Ensure the lock and marker identities have not changed, no tool container or
other operator/deployment is active, and the failed transaction is reconciled.
Do not unlink/recreate `.deploy.lock`.

Only when the intended database is proven still pristine and the marker is
confirmed to belong to **your failed attempt**, an authorized operator may
remove that marker while holding the same exclusive lock, rechecking its
device/inode before removal. Do not blindly run `rm .operator-maintenance`.
Release the lock before invoking the normal initialization command above (the
wrapper acquires it itself); it builds the candidate and creates its own marker.
If the prior attempt committed, do not retry initialization: preserve the
account and credentials, verify candidate readiness/lookup, and reconcile that
attempt's marker under the same ownership checks before the separately
authorized normal deployment. Keep maintenance whenever any outcome is unknown.

- Validation failure before DDL: zero schema/account changes.
- Migration/catalog/bootstrap/readiness failure: the **entire transaction**
  rolls back, including historical retirement and the account.
- The wrapper leaves maintenance in place on any failure/interruption and CI
  remains blocked. Never remove another operator's marker.
- If a network/process failure occurs during commit, the result is unknown:
  inspect actual revision, user count and readiness first. Do not guess and do
  not retry by deleting tables. A successful but unacknowledged installation
  will reject another initialization rather than reset the account.
- After confirming the database is genuinely still pristine and no other
  operator is active, an authorized operator may remove this failed attempt's
  `.operator-maintenance` marker under the same `.deploy.lock` and retry.
  If it committed, retain its data and proceed with the ordinary deployment.
- Existing populated databases never qualify: use the ordinary migration
  planner or protected operator workflow, with real recovery evidence.

## Deploy and subsequent patches

After installation, use the normal push-to-`main` workflow (or rerun the
workflow for the intended current commit). Do not call the older
`deploy-scripts/deploy.sh`: it is intentionally untouched and still has an
unconditional historical upgrade.

For verification **without contacting the VPS**, use **Run workflow** on
`Validate exact release artifact` and `Smoke test empty Docker installation`.
Both support manual dispatch and contain no deployment job. A normal push to
`main` does trigger deployment; for an explicitly verification-only push use
`[skip ci]` in that commit message, then manually dispatch these validation
workflows for the pushed commit. This does not waive any validation checks.

GitHub automatically runs **all** release, fresh-install and policy suites.
Only complete success on the same clean, unchanged commit produces the CI
report. It is transported through the authenticated GitHub/SSH deployment
job, matched to the exact Git archive, full file hashes, policy and schema.
An unsigned CI report is not an independent recovery/retirement authority.

Before replacing active app containers, deployment plans every dependency.
The active version-2 policy makes every literal, graph-validated revision
automatic, including future revisions without a new classification entry.
Unknown database revisions, malformed graphs/policies and unexpected database
state still fail closed. There is no additive-only DDL allowlist on execution.
Exit **42** remains supported for maintenance interlocks and legacy version-1
operator policies; it never promotes the candidate.

Both images are built before migration execution. Authors must preserve the old
release's schema compatibility during rolling upgrades; automatic classification
does not make destructive SQL reversible or compatible. Then deployment recreates only app containers,
checks actual image IDs, loaded backend identity, database readiness, served
frontend metadata and compiled asset bytes before marking promotion successful.
It never resets credentials/data or touches the PostgreSQL volume.

If migration succeeds but container startup/verification fails, report failure,
retain evidence and inspect compatibility. Never assume a blind downgrade is
safe. Replit browsing remains free of recurring compatibility quarantine;
manual development diagnostics and automatic production deployment checks are
separate.
