# EVEXIA: install once, then deploy ordinary patches automatically

## Boundaries

The schema target is `development-contract.json` (currently
`0040_po_tax_basis`); source metadata is generated with
`python -B scripts/review-schema-release.py --refresh` during development.
No migrations, volumes, `.env`, Compose overrides, Nginx or HTTPS settings need
to be deleted/recreated to use the procedure below.

There are three separate operations:

| Operation | Entry point | Required protection |
| --- | --- | --- |
| First installation | `scripts/initialize-production.py` | Independently supplied target, proven pristine DB, valid keys/password, host and DB locks, atomic schema/bootstrap/readiness |
| Routine patch | push to `main` / normal GitHub deployment | Successful exact-commit CI report, complete policy classification, additive-only pending DDL, existing locks, runtime/image/asset verification |
| Existing-data retirement or other risky migration | Existing operator runbooks | Exact operator approval, actual backup/restoration/key recovery, maintenance and dependency checks |

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
or operator-only classification is changed or bypassed by this test.

After each invocation it compares original container IDs, images, start times,
restart counts, mounts, volume identity and cluster identity. Only after these
assertions does cleanup remove resources labeled with that CI run's random
project name. The harness refuses a nonempty Docker daemon or pre-existing
fixture checkout. Do not run it on an installation host.

### Operator recovery

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
An operator-only pending revision returns **42**, applies **zero** migrations
and reports **DEPLOYMENT BLOCKED — OPERATOR MIGRATION REQUIRED**. Unknown
revisions/classifications or unexpected database state fail closed. Automatic
pending code must also pass the conservative additive DDL allowlist; marking
arbitrary SQL/destructive code `automatic` is insufficient.

Both images are built before migration execution. Supported additive upgrades
are transactional, have bounded lock/statement timeouts and preserve the old
release's schema compatibility. Then deployment recreates only app containers,
checks actual image IDs, loaded backend identity, database readiness, served
frontend metadata and compiled asset bytes before marking promotion successful.
It never resets credentials/data or touches the PostgreSQL volume.

If migration succeeds but container startup/verification fails, report failure,
retain evidence and inspect compatibility. Never assume a blind downgrade is
safe. Replit browsing remains free of recurring compatibility quarantine;
manual development diagnostics and automatic production deployment checks are
separate.
