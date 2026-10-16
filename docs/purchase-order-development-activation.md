# Purchase Order activation

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
