# Purchase Order activation

This document records **development-only** approval and evidence. It does not
authorize production, another workspace, or a fresh production install. The
separate [0038 fresh-install release candidate](fresh-install.md) has its own
human release, target, recovery and empty-finalization approvals; this historical
development activation must not be used to satisfy any of them.

## Original-development completion reported by the user — 16 October 2026

The user confirmed that the main workspace completed the original-development
operation described in the handoff below. This is **user-supplied evidence from
the main workspace**, not a migration or live verification performed by this
isolated task workspace:

- The running API connection and an independent query identified the original
  Helium development database at exactly `0037_domain_admission`, with no PO
  objects present.
- The guarded runner retained a private backup and successfully restored it on a
  separate cluster; all **32 existing tables and 1,547 rows** matched.
- Only `0038_purchase_orders` committed. All four PO tables and the numbering
  sequence were confirmed present; the new tables were empty. No orders were
  inserted.
- After API restart, the original preview returned HTTP 200 for health/readiness,
  Super Admin login, and the checked PO listing, overview, Activity, Analytics,
  historical filters and reference endpoints. Logout returned HTTP 204.
- The six activation safety tests passed in the original workspace.
- Production/VPS were untouched. The main workspace reported updating this
  document locally without committing or pushing.

The task workspace has not repeated those operations, logged in again or
attempted to migrate its own database copy. The main workspace's updated document
and private recovery evidence remain authoritative for exact backup locations
and checksums; the earlier task-workspace archive below must not be substituted.
Independent key recovery and a full browser interaction/release pass are not
attested by this completion report. No UI code changed in this task.

The following handoff records the earlier access limitation and conditional
approval. Its pending-action statements describe the state **before** the user
reported successful original-workspace execution; they are not instructions to
rerun the now-completed migration.

## Original-preview recovery handoff — 16 October 2026

**Historical investigation status: original preview not repaired or verified
from this task workspace. No activation was attempted
during this investigation.** The execution report below remains evidence for a
different task workspace, not authorization or evidence for the original preview.

### Conditional approval received

The user explicitly approved: **"Approve after the original live database is
independently confirmed."** This authorizes the guarded single-successor
activation only in the original EVEXIA development workspace after its actual
running API connection is independently reconciled with the target database.
It does not authorize activation of this task's copy, production/VPS changes,
or automatic migration after merge. No permission to replace the user's active
Admin session was supplied; coordinate any new verification login separately.
The target-confirmation condition remains unmet in this isolated workspace.

Read-only inspection in the current task workspace found:

- The development database tool and the application's configured session factory
  both returned `heliumdb`, cluster `7689828272860483604`, database OID `16384`;
  the application's connection host is `helium`, environment `development`.
- Its only migration marker is `0037_domain_admission`. No relation named
  `purchase_orders`, `purchase_order_lines`, `purchase_order_audit`,
  `purchase_order_requests` or `purchase_order_number_seq` exists in any schema.
- Those identifiers match the earlier report despite a different catalog state.
  Matching identifiers are therefore insufficient to identify the original
  preview's live database across task-workspace copies.
- This task preview hostname ends in `-6u9froal.sisko.replit.dev`; all its managed
  workflows were `not_started`. Public health and readiness requests returned
  HTTP 502, not API responses.
- The candidate original preview, the exact configured origin without a task
  suffix, returned HTTP 307 to `replit.com/__replshield` for both health routes.
  No API health response or original-runtime database identity was observable
  through that ingress. No access restriction was bypassed.
- Migration and Alembic-environment SHA-256 values still match the activation
  helper's reviewed pins. Required encryption/signing secrets and private storage
  configuration were reported present; their values were not displayed or
  independently recovered. No new backup or restoration evidence was produced.

## Original-development continuation — 16 October 2026

After the task handoff was merged, the original running API was independently
checked before execution. Its process environment and application settings
connected to `helium:5432`, database `heliumdb`, cluster
`7689828272860483604`, database OID `16384`. A separate development database
query matched this identity. The live marker was still exactly
`0037_domain_admission`, with none of the five Purchase Order objects present.
The task-workspace execution described below was not used as migration evidence
for this original database.

The existing guarded runner applied only `0038_purchase_orders`, with explicit
target arguments and development approval. Before DDL, a full private archive
was restored into a separate socket-only cluster and all **32 tables / 1,547
rows** matched. Backup and recovery reports were retained in private App Storage
with checksum readback and anonymous-access denial:

```
.private/operator-recovery/purchase-orders/evexia-po-recovery-g44v_mhu/
  before-0038.dump
  recovery.json
  activation.json
```

Archive SHA-256:
`8e21f3eb4abc9c7234f84bc9dcfcf5b0a1fde101e5fd007ca39dcabf41544d1e`.
Local working files are under `/tmp/evexia-po-recovery-g44v_mhu`, not the
durable backup location. Independent secret-key recovery was not newly
attested by this operation; existing keys were unchanged.

Post-commit queries confirmed revision `0038_purchase_orders`, all four empty
PO tables, and the numbering sequence. After restarting the original managed
API, actual HTTPS requests through the original preview verified liveness,
readiness, Super Admin login/current user, PO listing, overview, Activity,
Analytics, both historical filter directories and all three reference
directories: **HTTP 200**. The verification session was logged out (**204**).
No shared order was created, edited or deleted. Six pure activation-target
guard tests passed. No full release gate or authenticated browser interaction
test was run for this continuation.

No production/VPS or task-copy database was migrated by this continuation.
No migration, migration policy, application configuration or keys were changed.

## Development execution — 16 October 2026

The operator confirmed the **Replit Helium development database** and approved
only `0038_purchase_orders` after backup/recovery verification. This does not
approve VPS, UAT, production, inventory seeding, or any predecessor migration.

Read-only database inspection through the development database tool independently
matched the application's connection: database `heliumdb`, host `helium`,
cluster `7689828272860483604`, database OID `16384`. The database was exactly at
`0037_domain_admission`; no Purchase Order tables or sequence existed. No
surviving evidence of a partially completed activation was found.

`scripts/activate-purchase-orders-development.py` executed the single successor:

- Explicit development approval and independently supplied database, host,
  cluster and OID confirmations; no automatic confirmation from configuration.
- Pinned migration and Alembic-environment hashes; no `head` override and no
  change to migration policy or the historical fresh-install runner.
- Existing migration advisory mutex plus SHARE locks on all application tables,
  held across backup, rehearsal and DDL. Concurrent Inventory/application writes
  wait rather than racing the backup or migration.
- Full custom-format `pg_dump`, archive-list validation, then actual
  `pg_restore --exit-on-error --no-owner --no-acl` into a distinct disposable
  PostgreSQL cluster with only a private Unix socket.
- Every restored table's ordered row-content digest and count matched:
  **32 tables, 1,408 rows**, including the predecessor migration marker.
- Backup and recovery evidence uploaded to existing private App Storage with
  create-only object writes, authenticated checksum readback and anonymous
  access denial. No archive, data, keys or credentials entered Git or the Library.
- Only `0038_purchase_orders` was applied, on the same locked transaction;
  all four new tables and the sequence were checked before commit. Tables
  started empty. No Purchase Order, local-record migration, or master-data seed
  was inserted by this activation.

Recovery location in private App Storage:

```
.private/operator-recovery/purchase-orders/evexia-po-recovery-oi849v8d/
  before-0038.dump
  recovery.json
  activation.json
```

Backup SHA-256:
`3c5fe00188c589dfc269bd2b7b31abb75ee73d0e5fe89cc1bffe61d72dd055e8`

Private local recovery working files remain outside the repository under
`/tmp/evexia-po-recovery-oi849v8d` (directory 0700, files 0600). The rehearsal
server was stopped. The durable App Storage copy, not `/tmp`, is the recovery
archive. This is a database restoration rehearsal, **not independent recovery of
encryption/signing keys**. Existing workspace secrets were unchanged and still
decrypted the protected account successfully; preserve the matching retained
keys through the existing secure operator custody process. No object-store
assets were modified by this schema-only activation.

### Verified results

After restart of the managed API workflow:

- Public liveness and schema readiness: **HTTP 200**, `ok` / `ready`.
- Actual Super Admin login and `/auth/me`: **HTTP 200**. The development
  origin allowlist inherited an older preview address; the current exact HTTPS
  preview origin was added without removing the old approved origin, accepting
  wildcards, or changing production settings.
- Authenticated PO list, overview, both historical filter-option endpoints,
  Activity, Analytics and all three reference endpoints: **HTTP 200**.
- Listing, historical filters and Activity returned legitimate empty pages.
  Overview returned five zero aggregates; Analytics returned zero mutation
  counts and no vendor groups. Reference directories were empty in this
  workspace at verification time; this task did not seed them.
- The verification login session was logged out (**HTTP 204**); bearer/cookie
  values were never persisted to files or printed.
- `sh scripts/test-api-foundation.sh tests/test_purchase_orders.py`:
  **13 passed**, using a separate socket-only disposable database. This verified
  authenticated synthetic creation, CRUD, exact amounts, stale reviews,
  idempotent retries, filters, audit and analytics without adding shared orders.
- `python -m unittest discover -s scripts/tests -p test_purchase_order_activation.py -v`:
  **6 passed**. These pure guard checks refuse production, test environments,
  missing approval, other databases and VPS/other hosts without opening a
  database or reading credentials. Python compilation and `git diff --check`
  also passed.
- The public Admin login screen rendered. No authenticated browser interaction
  pass or cross-browser matrix was run; the protected results above are actual
  authenticated HTTP checks, not a screenshot claim.

### Release-validation limitation

The completion code review passed. The configured `pnpm run validate:release`
command ran its preceding service/backend checks, then failed during browser
setup before authenticated browser tests could start. Its configured library
source `/nix/store/q70d15vcgipibv45yxp44hdjfhdmdmg5-playwright-browsers` does not
exist in this task environment (`ENOENT` from
`scripts/prepare-nix-download-browsers.mjs`). The available replacement bundle
contains only Chromium, not the Firefox/WebKit libraries required by that
adapter. No passing full release-gate result is claimed.

The full gate cannot finish with the installed runtime. Do not substitute an old
browser, disable authentication tests, weaken the gate, or rerun the already
committed migration to address this. Restore the reviewed browser dependencies
in the release-test environment before the next complete release validation.
The focused activation checks and actual authenticated live HTTP evidence above
passed independently.

Execution affects this task workspace's confirmed Helium development database.
It is not evidence that a different/original workspace database, VPS, UAT or
production database is migrated. Verify readiness in the intended main workspace
after merge; do not automatically rerun an operator migration there.

## Separately running the migration on your VPS

**Nothing was executed on the VPS.** The Replit-only helper deliberately refuses
VPS hosts and production settings. Do not change its guards to reuse its approval.

For an external PostgreSQL database hosted on your VPS, use the VPS's reviewed
operator procedure and securely configured Python environment:

1. Confirm its server/host and database independently. Inspect its migration
   marker and catalog without making changes. It must be exactly
   `0037_domain_admission`, with none of the five new PO objects present.
   Stop on a different, multiple, missing or partial revision; do not run `head`,
   a fresh-install runner, earlier migrations or a destructive repair.
2. Obtain separate target-specific approval, stop API/background/Inventory
   writers, exclude other migration operators, and retain the full database
   backup and matching keys using approved private custody. Actually restore
   the archive to a separate database and verify it before proceeding.
3. From a pinned reviewed checkout, with the VPS's installed backend dependencies
   and securely supplied settings (never put a database URL/password in command
   arguments or logs), apply **only**:

   ```sh
   cd artifacts/api-server/backend
   python -m alembic current
   # Proceed only after the exact-predecessor/catalog/backup checks above.
   python -m alembic upgrade 0038_purchase_orders
   python -m alembic current
   ```

4. Coordinate the matching application version and restart your existing API
   service using the VPS procedure. Check `/api/v1/health/readiness`, then the
   authenticated PO endpoints listed above. Do not create a sample order in
   shared data without separate approval. Resume writers only after checks pass.

These are instructions for your **external VPS database**, not a production
operation performed or approved here. For Replit-managed production, follow the
supported Publish schema-review process instead; this development approval does
not authorize publishing.

### Operator actions required in the original workspace

1. Resume the operation in the workspace that actually runs the user's preview,
   not another task fork. Identify its exact preview ingress independently and
   reconcile the running API process's configured connection with an independent
   database inspection. Inspect `current_database()`,
   `pg_control_system().system_identifier`, database OID, actual connection host,
   the complete `alembic_version` result and the five PO relation names across
   schemas. Require exactly the predecessor above and no PO objects. Stop on any
   discrepancy; do not redirect the application to another database.
2. Honor the conditional original-development approval recorded above only once
   the original live target is independently confirmed. Earlier separate-workspace
   activation approval does not transfer. Confirm matching retained
   encryption/signing-key custody separately; a database backup does not recover
   workspace secrets. Coordinate verification sign-in because a new login can
   replace the user's active session.
3. From the reviewed checkout in that original workspace, invoke the existing
   guarded helper with the **independently confirmed** identity values:

   ```sh
   python scripts/activate-purchase-orders-development.py \
     --confirm-database <confirmed-database> \
     --confirm-host <confirmed-host> \
     --confirm-cluster <confirmed-cluster> \
     --confirm-oid <confirmed-database-oid> \
     --approve-development
   ```

   The placeholders are not executable confirmation values. Do not automatically
   fill them from the migration connection or copy them from this task's report.
   The helper must retain its migration mutex and writer locks throughout backup,
   independent restoration and the single-successor transaction. Require private
   archive readback, anonymous access denial and matching restored table contents
   before DDL. Preserve the resulting private recovery location and checksums.
   Do not use `upgrade head`, startup migrations, schema stamping or seeds.
4. Confirm the same database now has exactly `0038_purchase_orders`, all four PO
   tables empty and its sequence present. Restart the original managed API
   workflow, `artifacts/api-server: API Server`, after coordinating the matching
   merged application version. Check logs and HTTP 200 responses from the
   **original preview ingress** for `/api/v1/health` and
   `/api/v1/health/readiness`; task-workspace checks do not substitute.
5. Using a coordinated authenticated session, require HTTP 200 and valid response
   bodies under `/api/v1/admin/purchase-orders` for:
   the listing (including search/status/date/sort filters), `/overview`,
   `/filter-options/vendors`, `/filter-options/products`, `/activity`,
   `/analytics`, `/references/vendors`, `/references/locations` and
   `/references/products`. Check legitimate empty order/activity/filter pages,
   zero overview and analytics aggregates, and the target's actual existing
   reference directories without assuming they are empty. Do not insert orders.
   In the original signed-in preview confirm cards, filters, Activity, Analytics
   and new-order reference selectors render those results without submitting.
   Repeat final readiness verification after merge/restart if the operation
   preceded merge. Record that evidence separately before declaring recovery.

Until these actions succeed, the original preview remains unverified and this
task must not be reported as a completed repair. Production and VPS operations
remain outside this approval and handoff.
