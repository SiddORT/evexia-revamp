# Current release-authorization policy

**For a new empty database, use [the current one-command installation
procedure](installation.md).** The staged/signed-evidence instructions below
remain an opt-in legacy workflow, not the ordinary installation requirement.
Existing-data retirement retains its separate protected operator procedure.

The enforceable [release-authorization policy](release-authorization.md) now
allows validated routine releases and evidenced pristine-origin fresh phases
without a per-release human digest approval. It preserves the fixed 0031/0034/
0039 boundaries and all existing-database operator gates. The explicit manual
commands below remain supported; their human approvals are not required by the
separate machine-evidenced fresh mode. No production approval is implied.

# Secure-domain release prerequisite

The current coordinated candidate target is `0041_location_geography`. Before starting
production services, independently verify the existing approved exact
`PORTAL_BOOTSTRAP_HOSTS`, trusted proxy peers, DNS/TLS and the guarded API/nginx
entrypoints described in [domain-admission.md](domain-admission.md).
Do not change DNS, TLS, ingress or proxy configuration during initialization;
any missing prerequisite needs a separate reviewed operation.
Any optional fresh-install Admin hostname row remains unverified and is not
automatically admitted; recovery allowlist access retains path routing without
assigning an Admin role. Updated source review metadata is not target approval.

## Communication candidate correction — operator validation still required

This source correction extends only the separately approved **empty-only
finalization** to `0041_location_geography`. Preparation still stops at
`0031_role_hostnames`; the retirement wrapper still stops at
`0034_shared_phone_countries`. No retirement approval authorizes populated-account
conversion or Communication activation on an existing installation.

`0039_communication` remains **operator_only**. Normal CI must still return
`OPERATOR_MIGRATION_REQUIRED` / exit 42 before promotion when it is pending.
Neither CI nor an application startup initializes an empty database. `/health`
200 establishes only that the process is alive; an absent schema correctly
fails readiness. Do not delete/recreate the database or PostgreSQL volume.

The candidate manifest binds all 44 migrations, current policy/schema/readiness
sources, the dedicated Communication crypto implementation, and installer
changes. Its status still requires human release approval of its exact SHA256.
No release or regression checks were run during the initial source correction.
The subsequent [verification report](release-0039-verification.md) records
passing fresh-install/operator regressions, the resolved browser runtime blocker,
and the full release gate's remaining browser assertions. Historical results
below are not current candidate evidence.
Complete the remaining coordinated gate before release approval/promotion;
do not treat the new hashes as evidence it passed.

The `0039` catalog uses a strict additive projection: every new PostgreSQL 17
catalog row is frozen explicitly. After removing those **exact** rows, the
entire remaining catalog must match the unchanged frozen `0038` digest. Missing,
altered or additional DDL fails closed; no name-prefix exclusions or alternative
restored-catalog digests are accepted. The new rows were inspected read-only
in the retained local PostgreSQL 17 Communication rehearsal, not on the VPS.
This source/DDL inspection is not a fresh-install/restoration rehearsal.

The finalizer accepts pristine, catalog-reviewed `0034`–`0041` stages, still rejects any business
records, and requires an unused PO sequence at every stage containing Purchase Orders. At `0039` and `0040`,
only the exact migration-owned channel rows `email=1`, `sms=1`, `waba=1` are
allowed; Communication configurations must be empty. Finalization atomically
applies the remaining reviewed migrations, checks that metadata, bootstraps the
protected Super Admin, and verifies the unchanged readiness requirement.

For an **existing/populated** database, do not use `prepare` or `finalize`.
Retain maintenance and use its separately reviewed, explicit operator migration
and recovery procedure. This fresh-only release review does not supply that
authorization.

# Fresh production installation (dedicated empty PostgreSQL)

Current schema declarations and review-source fingerprints are checked together
by `python -B scripts/review-schema-release.py`. Author the schema in
`development-contract.json`; regeneration is not release authorization. See
[development synchronization](development-sync.md) for the separate routine
development pipeline. Historical reports below do not approve an uninspected VPS.

This is an **operator procedure**, never a CI fallback. Do not run
`deploy-scripts/deploy.sh` or a bare historical `initialize-api.sh`.
The current entry point requires an explicit `prepare` or `finalize` phase.
No stamp, test environment, skipped migration, hand-built schema or automatically
claimed retirement/recovery approval is used.

## Reviewed history and scope

This candidate covers **44** migration files and their upgrade/downgrade guards.
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
| 0037_domain_admission | Operator-only shared primary configuration and exact-host ownership/admission. Legacy role rows remain unverified; retain separately approved recovery access before activation. |
| 0038_purchase_orders | Operator-only empty PO tables/sequence; included only in this new candidate's separately approved empty-only finalization scope, never in retirement authorization. |
| 0039_communication | Operator-only encrypted configuration storage plus three fixed channel/version rows. Reviewed empty-only finalization includes it; existing databases need separate operator approval. No provider calls or delivery activation. |
| 0040_po_tax_basis | Two nullable JSON Purchase Order columns; no backfill. Remains operator-only for existing production databases. Empty-only finalization extends the exact 0039 catalog by these two columns. |
| 0041_location_geography | Four empty-default Storage Location columns and a country-code check; no inference/backfill. Included in empty-only initialization/finalization and exact catalog review. Still operator-only for existing databases; this review grants no existing-data upgrade approval. |

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
PGSERVICEFILE=/restricted/operator/retirement/pg_service.conf \
PGPASSFILE=/restricted/operator/retirement/pgpass PGSERVICE=evexia-source \
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

## Candidate review evidence and approval boundaries

**This is a candidate source review and an operator runbook, not human release
approval or permission to execute on the VPS. No VPS state has been verified.**
The reported empty `newevexia_db`, owner `newevexia_user`, health/readiness result,
existing lock, and absent marker are operator reports, not repository findings.
No production command, push, secret inspection, database reset, or key rotation
was performed for this review. Never run the development PO activation helper
on production. A push to `main` triggers deployment; do not use a push as a
method of making this candidate available before separate release approval.

## Historical 0038 audit and approval boundary

The starting repository had **43 source migrations and 42 reviewed migrations**:
all 42 historical revision hashes matched; only `0038_purchase_orders` was absent.
The graph has one head, `0038_purchase_orders`, descending from 0037 through
0036/0035/0034 and both merged historical branches. All 43 revisions are
classified; 0038 is **operator_only**. Policy SHA256 changed from
`3cc68799bad59feb3ca3f1ddb2141cbe65ea5cb1cec404ef106ed1530c0f6f72`
to `d7e3f02b352a670ebe3a0266160a1a6b28734d18a29d47fdd9b1add19ed2c7bc`.
The sole mismatched reviewed guard was `account_crypto.py`: reviewed
`955b645468f0b8cd5fdf7b6e7218592bba8629c438bb0012fd4a59803193f753`,
actual `ffea1624ee7d659c5dd3972f36ad094e9e7b56452aa923eebfcd1c31ee6a9b9d`.
It explicitly admits 0038 without changing account encryption/anchor checks.

The old installer/manifest deliberately stayed at 0037: approval of domain
admission did not authorize later procurement DDL. Advancing only the target or
rehashing files would be unsafe. Other blockers were:

- The retirement wrapper admitted only source releases 0034/0035. In addition,
  its planner was asked to treat bounded 0034 as the source head; that conflicts
  with the planner's intentional source-head check on successor releases.
- Finalization guessed predecessor tables from **current ORM metadata**, which
  already registers four PO tables absent before 0038. Even an empty valid
  predecessor would fail its table check.
- Readiness requires the application's exact single 0038 revision plus current
  directory/account crypto configuration. `/health` 200 proves neither.
- An optional legacy hostname mapping is **unverified**, not admitted Admin
  traffic. It must resolve to `role:null` until separately verified/admitted.

### Explicitly reviewed candidate scope

0038's reviewed DDL creates `purchase_order_number_seq` (start 1), headers,
lines, audit metadata and idempotency requests, with FKs to users, vendors,
storage, products and existing audit events. It adds dates/status/version/total
constraints and reference/search indexes. It does not import local POs, seed
data, activate staff permissions, or affect stock/receiving/payments. Its SHA256
is `768d4d86d2efc07fc78351091ec9ae5063a9cc7088bd0c787f93d5fc36b04c43`.
Policy remains unchanged, including operator-only account/reference/domain/PO
migrations. The existing account and reference conversion guards still permit
the genuinely all-business-empty path, not a populated-account shortcut.

The current manifest labels itself
`reviewed_candidate_requires_human_release_approval`. It binds all 44 migration
bytes, policy, historical guards, installer, catalog checker/evidence helper,
wrapper, planner, bootstrap, metadata registration and readiness sources.
There is no automatic manifest regeneration command. A future change requires
another source/DDL/reachability review and corresponding isolated evidence.
Never update hashes merely to make a rejection disappear.

Supported sequence:

| Stage | Exact revision | Public tables | PO sequence/tables |
|---|---|---:|---|
| Prepare (not ready) | 0031_role_hostnames | historical predecessor | absent |
| Protected retirement + phone | 0034_shared_phone_countries | 30 | absent |
| Empty account conversion | 0035_account_identifiers | 31 | absent |
| Empty reference conversion | 0036_reference_privacy | 31 | absent |
| Empty domain conversion | 0037_domain_admission | 32 | absent |
| Empty PO stage | 0038_purchase_orders | 36 | present |
| Empty finalization + bootstrap | 0041_location_geography | 38 | present |

`scripts/fresh-install-catalog.json` contains frozen PostgreSQL **17** projections
for every supported 0034–0041 finalization start. These are not derived from the
current ORM. They bind relations, columns/defaults, constraints, indexes,
triggers/functions, types, namespace objects and sequence definitions.
Finalization locks all expected tables, rechecks the exact catalog, proves
every business table empty (including account history, audit and PO retry data),
upgrades only to the explicit reviewed target, and rechecks revision/catalog/unused sequence and
the exact three migration-owned Communication channel/version rows.
Bootstrap, optional hostname, audit and readiness share one outer transaction.
No arbitrary old revision, object, populated installation, or future head is
accepted. The canonical supervisor lock also excludes other operator/CI work;
the PostgreSQL advisory lock coordinates database migration invocations.

**Separate human approvals required, never inferred from these tests/hashes:**

1. Release the exact candidate commit, manifest SHA256, PostgreSQL 17/client
   versions, reviewed source/image IDs, and all reachable operations.
2. Independently approve the actual server/network, DB/role and cluster ID;
   a matching cluster ID alone does not authenticate a host or physical clone.
3. Approve downtime, writer drain and exact affected services; review external
   consumers and retention; approve durable recovery custody.
4. Approve pristine preparation only through 0031.
5. After real independent full restoration, full-data/catalog review and
   protected-path rehearsal, attest the exact recovery digest and separately
   approve organization retirement and phone continuation **only to 0034**.
6. Approve empty-only account/reference/domain/PO/Communication/tax-basis/geography finalization through 0041 and
   protected bootstrap, plus the optional *unverified* hostname mapping.
7. Separately approve release-matched service promotion, readiness/authentication
   checks and traffic/writer handover. Domain ownership/admission remains separate.

## Prerequisites and stop conditions

The existing backend-only environment must already provide:

- `APP_ENV=production`, PostgreSQL `DATABASE_URL` for the intended dedicated DB.
- A valid `SESSION_SECRET` (or existing `JWT_SECRET` signing configuration).
- `STAFF_ENCRYPTION_KEYS`, `STAFF_EMAIL_INDEX_KEY`, and the matching active
  `STAFF_ENCRYPTION_KEY_ID` (defaults to `primary`).
- `DIRECTORY_ENCRYPTION_KEYS`, `DIRECTORY_INDEX_KEY`, matching
  `DIRECTORY_ENCRYPTION_KEY_ID` (defaults to `primary`).
- Dedicated `COMMUNICATION_ENCRYPTION_KEYS` (JSON keyring of base64-encoded
  32-byte keys) and matching `COMMUNICATION_ENCRYPTION_KEY_ID` (defaults to
  `primary`). Do not reuse staff/directory/signing key material. Validate and
  independently retain these keys in private recovery custody before starting.
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
Arrange independent isolated PostgreSQL 17 recovery/rehearsal servers in advance, with
matching DB name/schema/DB-role name and encryption keys, but a **different
server connection**. Its credentials/evidence belong in private operator
storage, never this repository. Never point a rehearsal command at production.
Use one genuinely pristine server for full archive restoration, and a second
genuinely pristine server for exact historical replay plus data restoration.
They must be independent of production and each other. Their sole
`DATABASE_URL` overrides belong in existing canonical, operator-owned 0600
`/restricted/operator/retirement/full-restore.env` and `clone.env` files.
These are **new independent operator files**, not the active `.env`. Do not
include other settings or approval flags in it. Human evidence must establish
the actual independent server identity; different URL strings alone do not.

## Exact VPS execution pattern (operator only; not performed by Agent)

First make the reviewed commit available in the approved Git remote; this task
does not push it. On Ubuntu use Bash, Docker Engine/Compose v2, GNU flock,
Python 3 and approved PostgreSQL 17 client tools. Stop if these are unavailable.
Do not install/upgrade PostgreSQL or restart Docker as part of this procedure.
The existing backend Dockerfile supplies `/workspace/.venv/bin/python` and Bash;
it does **not** supply PostgreSQL clients.
These commands extract a sibling checkout/build a tooling
image, without replacing active Compose configuration, application containers,
Nginx/HTTPS, storage or unrelated services:

```bash
set -euo pipefail
ACTIVE=/var/www/admin-uat.allergyevexia.in
umask 077
: "${REVIEWED_SHA:?Set the reviewed committed release SHA}"
: "${APPROVED_RELEASE_REVIEW_SHA:?Manifest SHA256 from explicit human release approval}"
: "${APPROVED_DB_NAME:?Independently approved production database}"
: "${APPROVED_CLUSTER_ID:?Independently approved production system identifier}"
: "${APPROVED_REHEARSAL_DB_NAME:?Independently approved replay database}"
: "${APPROVED_REHEARSAL_CLUSTER_ID:?Independently approved replay system identifier}"
: "${APPROVED_FULL_RESTORE_DB_NAME:?Independently approved full-restore database}"
: "${APPROVED_FULL_RESTORE_CLUSTER_ID:?Independently approved full-restore system identifier}"
[[ "$REVIEWED_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$APPROVED_RELEASE_REVIEW_SHA" =~ ^[0-9a-f]{64}$ ]]
test "$APPROVED_DB_NAME" = "$APPROVED_REHEARSAL_DB_NAME"
test "$APPROVED_DB_NAME" = "$APPROVED_FULL_RESTORE_DB_NAME"
test "$APPROVED_CLUSTER_ID" != "$APPROVED_REHEARSAL_CLUSTER_ID"
test "$APPROVED_CLUSTER_ID" != "$APPROVED_FULL_RESTORE_CLUSTER_ID"
test "$APPROVED_REHEARSAL_CLUSTER_ID" != "$APPROVED_FULL_RESTORE_CLUSTER_ID"
RELEASE="/var/www/evexia-operator-$REVIEWED_SHA"
git -C "$ACTIVE" fetch origin "$REVIEWED_SHA"
test "$(git -C "$ACTIVE" rev-parse "$REVIEWED_SHA^{commit}")" = "$REVIEWED_SHA"
test ! -e "$RELEASE"           # Never overwrite an interrupted release/evidence.
install -d -m 0700 "$RELEASE"
git -C "$ACTIVE" archive "$REVIEWED_SHA" | tar -x -C "$RELEASE"
test "$(sha256sum "$RELEASE/scripts/fresh-install-review.json" | cut -d' ' -f1)" \
  = "$APPROVED_RELEASE_REVIEW_SHA"
PINNED_BACKEND_IMAGE="evexia-operator:$REVIEWED_SHA"
docker build -f "$RELEASE/artifacts/api-server/backend/Dockerfile" \
  -t "$PINNED_BACKEND_IMAGE" "$RELEASE"
TOOL_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$PINNED_BACKEND_IMAGE")
# Retain this immutable image ID in the private human-reviewed release record.
NETWORKS=$(docker inspect --format \
  '{{ range $name, $_ := .NetworkSettings.Networks }}{{ println $name }}{{ end }}' evexia-backend)
test "$(printf '%s\n' "$NETWORKS" | sed '/^$/d' | wc -l)" -eq 1 || exit 1
NETWORK=$(printf '%s\n' "$NETWORKS" | sed '/^$/d')
RECOVERY_DIR=/restricted/operator/retirement
# Already on approved durable storage, owned by this operator:
install -d -m 0700 "$RECOVERY_DIR"
export APPROVED_RELEASE_REVIEW_SHA APPROVED_DB_NAME APPROVED_CLUSTER_ID
export APPROVED_REHEARSAL_DB_NAME APPROVED_REHEARSAL_CLUSTER_ID
export APPROVED_FULL_RESTORE_DB_NAME APPROVED_FULL_RESTORE_CLUSTER_ID
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
  -e APPROVED_RELEASE_REVIEW_SHA -e APPROVED_DB_NAME -e APPROVED_CLUSTER_ID \
  -e APPROVED_REHEARSAL_DB_NAME -e APPROVED_REHEARSAL_CLUSTER_ID \
  -e APPROVED_FULL_RESTORE_DB_NAME -e APPROVED_FULL_RESTORE_CLUSTER_ID \
  --mount "type=bind,src=$RELEASE,dst=/operator-release,readonly" \
  --mount "type=bind,src=$ACTIVE/.deploy.lock,dst=$ACTIVE/.deploy.lock" \
  --mount "type=bind,src=$ACTIVE/.operator-maintenance,dst=$ACTIVE/.operator-maintenance" \
  --mount "type=bind,src=$RECOVERY_DIR,dst=$RECOVERY_DIR" \
  --workdir /operator-release/artifacts/api-server/backend \
  --entrypoint /workspace/.venv/bin/python "$TOOL_IMAGE_ID" -B -c '
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
set -euo pipefail
umask 077
: "${APPROVED_DB_NAME:?Database name from independently approved target evidence}"
: "${APPROVED_CLUSTER_ID:?PostgreSQL system identifier from independently approved target evidence}"
sh /operator-release/scripts/initialize-api.sh \
  prepare --approve-fresh-install --writers-stopped \
  --approve-release "$APPROVED_RELEASE_REVIEW_SHA" \
  --expected-database "$APPROVED_DB_NAME" \
  --expected-system-identifier "$APPROVED_CLUSTER_ID"
# Expected: FRESH_INSTALL_PREPARED ... 0031_role_hostnames ... NOT READY
/workspace/.venv/bin/python -B -m app.organization_preflight \
  --backup /restricted/operator/retirement/recovery.json
/workspace/.venv/bin/python -B -m app.services.fresh_recovery export \
  --evidence /restricted/operator/retirement/full-evidence.json \
  --approve-release "$APPROVED_RELEASE_REVIEW_SHA" \
  --expected-database "$APPROVED_DB_NAME" \
  --expected-system-identifier "$APPROVED_CLUSTER_ID"
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
   # On the approved PostgreSQL-client host; existing private files, not .env:
   export PGSERVICEFILE=/restricted/operator/retirement/pg_service.conf
   export PGPASSFILE=/restricted/operator/retirement/pgpass
   # Approved service stanzas: evexia-source, evexia-full-restore, evexia-replay.
   # Each pins its independently verified server, database, role and TLS policy.
   # Verify file owner/0600/canonical paths without displaying their contents.
   test ! -e /restricted/operator/retirement/full-predecessor.dump
   test ! -e /restricted/operator/retirement/fresh-data.dump
   pg_dump --dbname='service=evexia-source' -Fc \
     -f /restricted/operator/retirement/full-predecessor.dump
   pg_dump --dbname='service=evexia-source' -Fc --exclude-table-data=public.alembic_version \
     --exclude-table-data=public.directory_crypto_stage \
     -f /restricted/operator/retirement/fresh-data.dump
   sha256sum /restricted/operator/retirement/full-predecessor.dump \
     /restricted/operator/retirement/fresh-data.dump
   ```
   Supply the real approved target through private `PGSERVICEFILE`/`PGPASSFILE`,
   not credentials on the command line. This is a PostgreSQL **client** command
   on an approved operator host; the backend image does not include `pg_dump`.
2. Define these helpers in the still-locked tooling supervisor. No secret values
   are printed or passed on command lines. On the independently isolated, genuinely
   pristine replay database, run the same `prepare` command with its **private clone environment** and inherited
   supervisor lock, not production's `DATABASE_URL`. All original schema
   migrations replay. They create the real version/staging metadata; those
   metadata rows are deliberately not copied, edited or stamped.
   From the still-locked tooling supervisor, use this explicit child-environment
   function (no new Docker process; FD9 is inherited, not reacquired):
   ```sh
   independent_run() {
     /workspace/.venv/bin/python -B - "/restricted/operator/retirement/$1.env" "${@:2}" <<'PY'
   import os, pathlib, stat, subprocess, sys
   from dotenv import dotenv_values
   try:
       path = pathlib.Path(sys.argv[1])
       assert path.name in {"clone.env", "full-restore.env"}
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
   clone_run() { independent_run clone "$@"; }
   full_run() { independent_run full-restore "$@"; }
   : "${APPROVED_REHEARSAL_DB_NAME:?Independently approved isolated clone database name}"
   : "${APPROVED_REHEARSAL_CLUSTER_ID:?Independently approved clone system identifier}"
   test "$APPROVED_REHEARSAL_CLUSTER_ID" != "$APPROVED_CLUSTER_ID" || exit 1
   clone_run /workspace/.venv/bin/python -B -m app.fresh_install \
     prepare --approve-fresh-install --writers-stopped \
     --approve-release "$APPROVED_RELEASE_REVIEW_SHA" \
     --expected-database "$APPROVED_REHEARSAL_DB_NAME" \
     --expected-system-identifier "$APPROVED_REHEARSAL_CLUSTER_ID"
   ```

   **Full restoration is a separate required operation**, not just the data-only
   replay below. First confirm the *full-restore* server's approved target and
   pristine catalog without changing it:
   ```sh
   full_run /workspace/.venv/bin/python -B -c '
   import sys
   from sqlalchemy import create_engine
   from app import fresh_install as f
   from app.core.config import get_settings
   from app.services.organization_retirement import connection_url
   try:
       with create_engine(connection_url(get_settings().database_url), hide_parameters=True).connect() as db:
           f.verify_database_target(db, sys.argv[1], int(sys.argv[2]))
           f.pristine(db)
       print("FULL_RESTORE_TARGET_PRISTINE")
   except Exception:
       print("FULL_RESTORE_TARGET_BLOCKED"); sys.exit(1)
   ' "$APPROVED_FULL_RESTORE_DB_NAME" "$APPROVED_FULL_RESTORE_CLUSTER_ID"
   ```
   On the private client host, verify the `evexia-full-restore` service against
   the same independently approved server/cluster, then restore the full archive:
   ```sh
   pg_restore --dbname='service=evexia-full-restore' --exit-on-error \
     /restricted/operator/retirement/full-predecessor.dump
   ```
   Back in the supervisor, use the retained digest from `full_recovery export`
   (not an automatically generated approval):
   ```sh
   : "${FULL_EVIDENCE_SHA:?Retained full-evidence export digest}"
   full_run /workspace/.venv/bin/python -B -m app.services.fresh_recovery verify \
     --evidence /restricted/operator/retirement/full-evidence.json \
     --sha256 "$FULL_EVIDENCE_SHA" \
     --catalog-report /restricted/operator/retirement/full-check-report.json \
     --approve-release "$APPROVED_RELEASE_REVIEW_SHA" \
     --expected-database "$APPROVED_FULL_RESTORE_DB_NAME" \
     --expected-system-identifier "$APPROVED_FULL_RESTORE_CLUSTER_ID"
   full_run /workspace/.venv/bin/python -B -m app.organization_preflight
   ```
   Expected: all table data and non-CHECK catalog match. The private report
   retains any reserialized CHECK definitions for independent human DDL review.
   **A data-match message is not exact CHECK equivalence or restoration approval.**
   Any non-CHECK difference, data mismatch, unreviewed CHECK difference, or strict
   preflight failure is a stop condition. Retain the original archive and logs.
   Never edit restored constraints or relax a live guard to make it pass.
   The fully restored database is recovery evidence, not the exact-catalog
   production finalization target. Do not delete/reset it.

3. Restore business data into the **separate prepared replay server**, using the real PostgreSQL client:
   ```sh
   pg_restore --data-only --exit-on-error \
     --dbname='service=evexia-replay' /restricted/operator/retirement/fresh-data.dump
   ```
   Its private service/password settings must identify the independent server.
   Do not restore schema DDL over the replayed schema or disable triggers.
   A full schema `pg_restore` can reserialize CHECK expressions and
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
5. After independently reviewing the full archive restoration, full comparison
   and CHECK report, separately approve a **rehearsal-only** retirement/phone and
   empty-finalization run against the replay server. These commands are not
   production approval:
   ```sh
   : "${SHA:?Retained organization recovery digest}"
   : "${RESTORED_SHA:?Digest named by independent human restoration attestation}"
   clone_run bash /operator-release/scripts/operator-retirement.sh \
     --approve-release "$APPROVED_RELEASE_REVIEW_SHA" \
     --expected-database "$APPROVED_REHEARSAL_DB_NAME" \
     --expected-system-identifier "$APPROVED_REHEARSAL_CLUSTER_ID" \
     --backup /restricted/operator/retirement/recovery.json \
     --sha256 "$SHA" --restore-verified "$RESTORED_SHA" \
     --attest-restoration-rehearsal --approve-retirement --writers-stopped \
     --external-consumers-reviewed --backup-durable --retention-resolved \
     --approve-phone-continuation
   # Expected: continuation complete at 0034; NOT application-ready.
   clone_run sh /operator-release/scripts/initialize-api.sh \
     finalize --approve-bootstrap --writers-stopped \
     --approve-release "$APPROVED_RELEASE_REVIEW_SHA" \
     --expected-database "$APPROVED_REHEARSAL_DB_NAME" \
     --expected-system-identifier "$APPROVED_REHEARSAL_CLUSTER_ID"
   # Expected: FRESH_INSTALL_READY: 0041_location_geography.
   ```
   Retain the rehearsal result and approve/retain a separate production
   restoration/continuation attestation naming that exact recovery SHA.
   Existing-record recoveries must use their original
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
  --approve-release "$APPROVED_RELEASE_REVIEW_SHA" \
  --expected-database "$APPROVED_DB_NAME" \
  --expected-system-identifier "$APPROVED_CLUSTER_ID" \
  --backup "$BACKUP" --sha256 "$SHA" --restore-verified "$RESTORED_SHA" \
  --attest-restoration-rehearsal --approve-retirement --writers-stopped \
  --external-consumers-reviewed --backup-durable --retention-resolved \
  --approve-phone-continuation

# Separate bootstrap/hostname approval. Omit --admin-hostname if not approved;
# /portal/resolve remains role:null until separately verified/admitted,
# even if the optional unverified mapping below is created.
sh /operator-release/scripts/initialize-api.sh \
  finalize --approve-bootstrap --writers-stopped \
  --approve-release "$APPROVED_RELEASE_REVIEW_SHA" \
  --expected-database "$APPROVED_DB_NAME" \
  --expected-system-identifier "$APPROVED_CLUSTER_ID" \
  --admin-hostname newuat.allergyevexia.in
# Expected: FRESH_INSTALL_READY ... 0041_location_geography
/workspace/.venv/bin/python -B -m alembic current
/workspace/.venv/bin/python -B /operator-release/scripts/deploy-migrations.py \
  --backend-dir /operator-release/artifacts/api-server/backend
# Expected: exact single 0041_location_geography revision, policy READY, no migrations applied.
```

Finalization refuses other revisions, unexpected tables/views and **any existing
application records**. It uses the existing protected bootstrap and unchanged
readiness checks in one outer transaction; hostname/audit writes are atomic with
account creation. It never rotates existing credentials or seeds master data.
The reserved login is `crm-admin@allergyevexia.in`, using the already-configured
initial password. No password is printed.

From a second host terminal, with the supervisor still holding FD9, verify the
existing backend is the independently reviewed matching **0041** image before restarting it.
Do not infer that from an image tag, container name, or a successful `/health`.
On that second host terminal (not inside the tooling shell), restore the
non-secret approved release/image variables from the retained operator record:

```sh
: "${APPROVED_BACKEND_IMAGE_ID:?Immutable image ID approved for this exact source release}"
test "$(docker inspect --format '{{.Image}}' evexia-backend)" = "$APPROVED_BACKEND_IMAGE_ID"
# If this fails: STOP. Do not start the old backend; use the separate promotion branch below.
docker start evexia-backend
curl --fail-with-body https://newuat.allergyevexia.in/api/v1/health/readiness
curl --fail-with-body \
  'https://newuat.allergyevexia.in/api/v1/portal/resolve?hostname=newuat.allergyevexia.in'
# Expected: ready; role:null for the unverified legacy mapping even if initialized above.
```

If the existing image differs, **a separately reviewed service promotion is
required** while the tooling supervisor still owns FD9. Do not use `deploy.sh`,
restart CI, or acquire another flock while that supervisor holds it. Only after
human approval of the exact backend/frontend images, project name, Compose
service/network settings and affected-service list, use this scoped host branch:

```bash
set -euo pipefail
ACTIVE=/var/www/admin-uat.allergyevexia.in
: "${RELEASE:?Approved extracted source release}"
: "${APPROVED_BACKEND_IMAGE_ID:?Reviewed local immutable backend image ID}"
: "${APPROVED_FRONTEND_IMAGE_ID:?Reviewed local immutable frontend image ID}"
# The frontend image must also be built from the exact approved commit, using
# its Dockerfile, in the separate image review. No running source bind mounts.
PROJECT=$(docker inspect --format \
  '{{ index .Config.Labels "com.docker.compose.project" }}' evexia-backend)
[[ "$PROJECT" =~ ^[a-zA-Z0-9_-]+$ ]]
[[ "$APPROVED_BACKEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$APPROVED_FRONTEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]
docker image inspect "$APPROVED_BACKEND_IMAGE_ID" >/dev/null
docker image inspect "$APPROVED_FRONTEND_IMAGE_ID" >/dev/null
# Create this once in the private release directory. Do not overwrite recovery evidence.
( set -o noclobber
  printf 'services:\n  backend:\n    image: %s\n  frontend:\n    image: %s\n' \
    "$APPROVED_BACKEND_IMAGE_ID" "$APPROVED_FRONTEND_IMAGE_ID" > "$RELEASE/approved-promotion.yml"
)
docker compose --project-name "$PROJECT" --project-directory "$ACTIVE" \
  --env-file "$ACTIVE/.env" -f "$ACTIVE/docker-compose.yml" \
  -f "$RELEASE/approved-promotion.yml" \
  up -d --no-build --no-deps backend frontend
test "$(docker inspect --format '{{.Image}}' evexia-backend)" = "$APPROVED_BACKEND_IMAGE_ID"
test "$(docker inspect --format '{{.Image}}' evexia-frontend)" = "$APPROVED_FRONTEND_IMAGE_ID"
docker exec evexia-backend /workspace/.venv/bin/python -B -c \
  'from app.core.schema import SCHEMA_REVISION; assert SCHEMA_REVISION == "0041_location_geography"'
docker exec evexia-backend /workspace/.venv/bin/python -B -c \
  'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8080/api/v1/health/readiness", timeout=5).read()'
docker exec evexia-frontend wget -q -O /dev/null http://127.0.0.1/
```

This targets **only backend/frontend**, not PostgreSQL, unrelated containers,
volumes, keys or ingress. The tooling image can be approved as the backend image
only after the separate image/source review; building it is not promotion approval.
If other EVEXIA workers exist, their exact stop/restart commands require the
operator's inventory and approval; stop here until that list is complete. Never
use `docker compose down`, `docker stop $(docker ps -q)`, volume removal, or
PostgreSQL restart. Do not start background writers until checks/handover permit it.

Verify actual **Super Admin** login through the approved bootstrap host using the
already privately configured initial password, then `/api/v1/auth/me` and protected
Admin/PO/Communication reads, logout and rejection of unauthenticated protected reads. Use the
browser, not a password/token-bearing shell command or a captured HAR. Confirm
no business seed data, no admitted domain policy, no PO records and no Communication
configurations (only the three fixed channel/version rows). `role:null` is correct
until a separate domain-ownership/admission operation; do not edit DNS/TLS/ingress
as part of this installation. `PORTAL_BOOTSTRAP_HOSTS` and accepted proxy/Host
configuration must already match the approved host; if they do not, stop for a
separate reviewed configuration change.

Only after successful
readiness/authentication verification, approved traffic reopening and writer
handover, remove the host marker from that second terminal:

```sh
rm -- /var/www/admin-uat.allergyevexia.in/.operator-maintenance
```

Then exit the supervisor to release FD9. The next normal CI run sees the current
head and resumes its unchanged guarded migration/promotion process. If an
application replacement is needed instead of restarting the matching existing
image, use a separately reviewed supervised release promotion, not the legacy
unconditional migration deploy script. The approved image-only Compose override
above is a separate service-promotion operation; no base Compose, Nginx, HTTPS,
storage, PostgreSQL or key changes are part of initialization.

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
  together with any 0035–0041 DDL in the same outer transaction. A rejected
  0034/0035/0036/0037/0038/0039/0040/0041 catalog, populated table, changed channel version
  or used PO sequence is not
  permission to repair it by deleting records or changing the sequence.
  Verify actual state after ambiguous commit. A successful but
  unacknowledged bootstrap causes a retry to refuse populated tables, not change
  the password. Check the protected account and readiness instead.
- Full archive restore failure or unreviewed CHECK report: preserve that isolated
  target, logs and archives; do not stamp it, edit constraints, drop its database,
  or silently replace full recovery with a data-only restore. Arrange a newly
  approved independent recovery target and resolve the discrepancy first.
- Failure after database readiness but before service readiness/authentication:
  keep traffic drained and the marker; do not restart an older schema-incompatible
  image. Retain exact image/revision evidence and request a separately approved
  forward fix or full recovery. Never infer that an application rollback permits
  a database downgrade.
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
It also exercises all five finalization starts, real full archive restoration
and full-data/non-CHECK comparison, CHECK-report review boundaries, the actual
retirement shell wrapper after independent replay/restoration, wrong wrapper
targets/releases/graphs/policies, missing marker/FD/phone approval, unexpected
tables/views/sequences/types/functions/columns, populated history, atomic
DDL/bootstrap rollback and lost-success retry without password reset.
Container runtime, Ubuntu-specific client packaging, live ingress/authentication,
and approved image promotion must still be verified by the operator. A local
test pass is neither human release approval nor evidence of the reported VPS state.

### Historical 0038 verification evidence — not rerun for the 0039 correction

- Isolated production-mode fresh-install suite: **27 passed** on socket-only
  PostgreSQL 17 clusters with synthetic keys/passwords. The added used-PO-sequence
  rejection was also verified in a focused 0038 rerun: **1 passed**.
- Deployment/script unit suite: **79 passed**.
- All **43** migration hashes and policy/guard/release-source hashes match.
- All **18** runbook shell blocks parse; installer/test/wrapper shell syntax and
  `git diff --check` pass.
- Candidate manifest SHA256:
  `3c3cc02a285c05f926522f44a52d65000e14eee9a3d7acc77f20bd5532929d5d`.
  This identifies reviewed candidate bytes, **not** a human approval.
- No Ubuntu Docker run, production migration, production authentication,
  image promotion, secret inspection or deployment-triggering push was performed.
