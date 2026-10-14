# Historical scope notice

This procedure remains limited to `0031_role_hostnames`. It does not authorize
the secure-domain release `0037_domain_admission`, its predecessor migrations,
or any infrastructure action. Current code requires separately reviewed rollout
and exact recovery-host configuration; see [domain-admission.md](domain-admission.md).

# Reviewed additive hostname-only operator procedure

This is a separate recovery path for the confirmed UAT predecessor
`0030_directory_crypto_retirement`. It executes **one literal target**:
`0031_role_hostnames`. It never invokes `upgrade head`, organization retirement,
the branch merge, or phone-country migration. It does not deploy code, push Git,
start/stop services, configure networking, seed mappings, stamp revisions or
automatically downgrade.

The full-retirement script, migration policy, historical migrations, application
readiness requirement and unattended deployment planner remain unchanged.
The broader release remains operator-blocked. Success here establishes neither
full-release readiness nor successful browser entry.

## Safety and review contract

Use `scripts/operator-hostnames.py`, not `operator-retirement.sh`. It requires:

- A separately reviewed, clean, pinned standalone checkout. All tracked changes
  and untracked source are rejected. The original migration and Alembic environment
  have fixed reviewed SHA-256 hashes. A changed release head needs fresh review.
- Production settings from the existing secure operator environment; no test
  settings, replacement keys, alternate database URL CLI arguments or SQL logging.
  The existing directory-encryption readiness/configuration checks must pass.
- Exactly one applied revision, **0030**, with the intended schema's predecessor
  tables and no conflicting hostname relation. A replay or later revision blocks.
- Read-only inspection of the actual connection, emitting only target fingerprints,
  source identity and a plan digest. The custodian must independently verify the
  target; a digest of the wrong database does not make that database correct.
- Separately approved maintenance/writer exclusion, the canonical existing
  `/var/www/newuat.allergyevexia.in/.operator-maintenance` marker, and an inherited
  supervisor-held **exclusive** flock of the canonical `.deploy.lock` inode.
  The existing shared database advisory lock is held throughout inspection/DDL.
- Explicit hostname-only approval bound to the exact plan and reviewed recovery
  evidence. A final inspection under the locks must still match that plan.
- Restricted backup/evidence descriptors and shared file locks held during DDL.
  Files must be canonical absolute paths outside both release and active deployment,
  regular, operator-owned and inaccessible to group/other. Parent ownership/privacy
  are checked. Symlink aliases, overwrite assumptions and changed files block.

No checks are removed from the existing full-retirement path. Its retirement,
retention and external-consumer approvals are **not impersonated** here: this path
does not enter any migration that retires their data.

## Minimum recovery evidence for this additive migration

An organization-only JSON export cannot recover the whole predecessor database.
The separate hostname path instead requires:

1. A full PostgreSQL **custom-format dump of the intended database, all schemas
   and default large-object coverage**, taken after verified writer exclusion.
   No table/schema/data filtering or unlogged-data exclusion. Securely retain its
   original ownership/privilege requirements and the matching externally held
   staff/directory encryption and index-key inventory. Keys must never appear
   in the dump evidence JSON, Git, command arguments or reports.
2. Approved durable external storage, operator-owned parent mode 0700 and file
   mode 0600 (or stricter), access control/encryption at rest, independent durable
   copies and a custodian-defined retention/availability window. Creating a
   directory does not establish these properties.
3. SHA-256 integrity and successful `pg_restore --list` validation.
4. **An actual successful independent restore rehearsal of that exact dump**,
   on an authorized empty disposable PostgreSQL target, not UAT. Preserve database/
   schema names and provision the original role/extension prerequisites. Verify
   predecessor revision 0030, absence of the hostname table, full schema/ownership/
   grants/data/large-object integrity and all retained identity/session/audit rows.
   Exercise encryption/index-key recovery with the matching key inventory.
   Retain the comparison results and approvals outside Git.
5. A restricted JSON attestation tied to the inspected plan and the exact dump
   digest, with opaque UUID references to real backup, rehearsal, key-inventory
   and change-approval records. True flags are **operator attestations**, not
   automatic proof of a restore. The procedure validates their contract and
   binding; it cannot independently prove custody or an external rehearsal.

No organization-removal upgrade/downgrade/re-upgrade rehearsal is required for
this additive path: it retires no existing rows. A recovery action on UAT itself
would still require separate approval; do not perform one as a rehearsal.
The ordinary downgrade drops the new mapping table and must not be used as an
automatic recovery once mappings exist.

## Exact operator sequence (not executed by the agent)

These are conditional operator instructions, **not authority to run them now**.
Obtain separate backup-export, isolated-rehearsal and maintenance/service-stop
permissions. Supply a standalone reviewed checkout containing the delivered
commit without pushing the deployment branch or changing the active checkout.
Use the existing authorized operator environment with Git, project Python
dependencies, libpq clients and secure production/key configuration available.
Do not substitute the live API container: it lacks the recovery mounts and
cannot establish the supervisor's lock/writer exclusion.

Public, non-secret inputs (replace placeholders with independently reviewed values):

```sh
set -eu
umask 077
PINNED_RELEASE=/var/www/evexia-hostname-operator
RELEASE_SHA=REPLACE_WITH_DELIVERED_REVIEWED_COMMIT_SHA
PYTHON=/absolute/path/to/reviewed/operator/python
RECOVERY_DIR=/absolute/path/on/approved/durable/external/storage
BACKUP="$RECOVERY_DIR/hostname-predecessor.dump"
PLAN="$RECOVERY_DIR/hostname-plan.json"
EVIDENCE="$RECOVERY_DIR/hostname-recovery.json"
# These UUIDs identify ACTUAL approved records, not generated placeholder evidence.
: "${BACKUP_REF:?Actual approved backup record UUID required}"
: "${REHEARSAL_REF:?Actual successful rehearsal record UUID required}"
: "${KEY_INVENTORY_REF:?Actual recoverable key-inventory record UUID required}"
: "${CHANGE_REF:?Actual hostname-only change approval record UUID required}"
export APP_ENV=production
# DATABASE_URL and existing keys come from the established secure operator
# environment. Never echo them or source an unreviewed dotenv file as shell code.
test "$(git -C "$PINNED_RELEASE" rev-parse HEAD)" = "$RELEASE_SHA"
cd "$PINNED_RELEASE"
export EVEXIA_DEPLOY_LOCK=/var/www/newuat.allergyevexia.in/.deploy.lock
export EVEXIA_DEPLOY_LOCK_FD=9
exec 9>"$EVEXIA_DEPLOY_LOCK"
flock -x 9
test ! -L /var/www/newuat.allergyevexia.in/.operator-maintenance
touch /var/www/newuat.allergyevexia.in/.operator-maintenance
# NO EXIT trap removes the marker. Keep this supervisor/FD alive throughout.
```

The supervisor must now carry out the separately approved writer-stop procedure
and verify **all** API nodes, jobs and external writers are stopped/excluded.
This tool does not infer that fact from a flag or manage those services.
Do not proceed until the approved operator records establish exclusion.

Run inspection and export. The libpq service `evexia_hostname_backup` must be
securely configured and independently verified to identify the **same database**
as the inspected application connection; credentials stay in approved libpq
service/password files. `evexia_hostname_rehearsal` must identify the **different,
empty, disposable restore target**, never UAT or another managed database.
Do not invent either service or silently accept its target.

```sh
install -d -m 0700 "$RECOVERY_DIR"
test ! -e "$PLAN" && test ! -L "$PLAN"
(set -C; "$PYTHON" -B scripts/operator-hostnames.py --inspect \
  --release-sha "$RELEASE_SHA" > "$PLAN")
# Verify READ_ONLY_HOSTNAME_PLAN and intended target before exporting.
test ! -e "$BACKUP" && test ! -L "$BACKUP"
pg_dump --dbname=service=evexia_hostname_backup --format=custom --file="$BACKUP"
pg_restore --list "$BACKUP" > /dev/null
sha256sum "$BACKUP"
stat -c '%a %u %F %n' "$RECOVERY_DIR" "$BACKUP" "$PLAN"
```

The next command **writes only to the separately authorized disposable target**.
It is NOT a command to run against UAT. Provision its matching role/extension
prerequisites and verify independent target identity before running:

```sh
pg_restore --exit-on-error --single-transaction \
  --dbname=service=evexia_hostname_rehearsal "$BACKUP"
```

Perform and retain the full integrity/key-recovery comparisons described above.
There is no automated substitute for those source-specific comparisons. Do not
set attestation flags or create the following evidence before they actually pass.
Only after independent recovery review and recorded hostname-only approval:

```sh
"$PYTHON" -B - "$PLAN" "$BACKUP" "$EVIDENCE" \
  "$BACKUP_REF" "$REHEARSAL_REF" "$KEY_INVENTORY_REF" "$CHANGE_REF" <<'PY'
import hashlib, json, os, sys
plan_path, backup, output, backup_ref, rehearsal_ref, keys_ref, change_ref = sys.argv[1:]
with open(plan_path) as source:
    report = json.load(source)
assert report["result"] == "READ_ONLY_HOSTNAME_PLAN"
digest = hashlib.sha256()
with open(backup, "rb") as source:
    for block in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(block)
evidence = {
    "format": 1, "migration": "0031_role_hostnames",
    "predecessor_revision": "0030_directory_crypto_retirement",
    "plan_sha256": report["plan_sha256"],
    "backup_sha256": digest.hexdigest(), "restored_backup_sha256": digest.hexdigest(),
    "backup_format": "postgresql_custom", "backup_scope": "full_database_all_schemas",
    "backup_durable": True, "backup_after_writer_exclusion": True,
    "archive_list_verified": True, "restoration_rehearsal_passed": True,
    "full_restore_checks_passed": True, "matching_keys_recoverable": True,
    "backup_ref": backup_ref, "rehearsal_ref": rehearsal_ref,
    "key_inventory_ref": keys_ref, "change_ref": change_ref,
}
fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
with os.fdopen(fd, "w") as destination:
    json.dump(evidence, destination, sort_keys=True)
    destination.flush()
    os.fsync(destination.fileno())
PY
APPROVAL=$("$PYTHON" -B -c \
  'import json,sys; print(json.load(open(sys.argv[1]))["plan_sha256"])' "$PLAN")

"$PYTHON" -B scripts/operator-hostnames.py --execute \
  --release-sha "$RELEASE_SHA" --approval "$APPROVAL" \
  --approve-hostnames --writers-stopped --recovery-reviewed \
  --backup "$BACKUP" --recovery-evidence "$EVIDENCE"
```

**Stop here.** Expected success is `HOSTNAME_MIGRATION_APPLIED`, revision
`0031_role_hostnames`, `migrations_applied: 1`, readiness `not_established`.
Any failure/timeout/post-check issue is blocked or unconfirmed: retain existing
maintenance/writer exclusion, investigate privately and obtain reviewed recovery
instructions. Never retry automatically, remove the marker in an EXIT trap,
stamp a revision, create a substitute table, advance to head or invoke the full
retirement script.

Service resumption, deployment, live resolver/readiness probes and fresh browser
entry remain separately authorized operations. This handoff supplies no automatic
resume command and claims no live recovery.

## Focused verification

```sh
python -B -m unittest discover -s scripts/tests -p 'test_operator_hostnames.py' -v
bash scripts/test-api-foundation.sh tests/test_operator_hostnames.py
```

The first suite covers fixed targets, graph/policy drift, approval/recovery gates,
digest/permission/symlink validation, real inherited exclusive locks, timeouts and
non-continuation. The second uses only disposable schemas: real 0030 → 0031 DDL,
retained organization rows and predecessor projections, and rejection of later/
inconsistent revisions and conflicting relations. Synthetic test artifacts and
mocked attestations are explicitly **not live backup/rehearsal evidence**.
