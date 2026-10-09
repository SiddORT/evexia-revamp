# Role lifecycle completion report

## Connected app database: approved and applied

The operator subsequently approved inspection/migration of the app's connected
development database. Read-only inspection confirms **1 role, 1 existing User,
0 Staff profiles and 0 assignment blockers**, at `0028_directory_soft_delete`.
Its Staff lifecycle prerequisite and role migration are now both installed.
No production database was inspected or changed.

A full custom-format backup was made outside source control with owner-only
permissions, and its archive listing verified for User/Staff/role/audit data.
Backup size: 184,347 bytes; SHA256:
`e695b43ac96b750a2f31999ad530663950a54d998292f3088831096c9cc24a3e`.
After the operator explicitly chose “Use the recorded Super Admin,” the exact
updater mapping was applied as **reviewed**, not automatic audit inference.
The API was stopped for a fresh coordinated backup and forward migration.
Installed revision is now **`0029_role_lifecycle`**.

The coordinated backup is 184,347 bytes, SHA256
`39ac4ce11e3c449b2cfe6f57d0198de889d035eb6420345aaf22ae23f15c524d`.
Backups, complete before/after preflight JSON, the reviewed map and migration/
integration results are retained under `.local/role-lifecycle-operator/`, outside
source control with directory mode 0700/file mode 0600. They contain private
database data and are not public downloadable assets.

| Required existing-data evidence | Actual status |
| --- | --- |
| Total connected development roles inventoried | 1 |
| Automatically verified fields | 1 creator |
| Explicitly reviewed fields | 1 updater, operator-confirmed recorded Super Admin |
| Roles requiring manual creator attribution | None |
| Roles still requiring manual updater attribution | None: reviewed mapping applied to `7f7bde03-31db-40b5-af73-65ef2e4d3777` |
| Assigned Staff references blocking deletion | None: 0 profiles, 0 references |
| Production data and migration status | Unverified; no production operations |

For role `7f7bde03-31db-40b5-af73-65ef2e4d3777` (version 2), the creator is
automatically verified as User `2932bd1e-e112-4a85-b400-229a396fc27b`.
The one successful update uses the same existing protected Super Admin actor,
but audit time `2026-10-07T09:31:48.677105Z` differs from the saved update time
`2026-10-07T09:31:48.683199Z`. This was unresolved before explicit operator
review; it remains classified **reviewed_mapping**, never audit-derived or
timestamp-proximity inference.

The pre-prerequisite read-only inventory used the frozen role evidence rules
unchanged, with a historical NULL deletion projection for Staff. The zero-Staff
count was independently verified before that projection; it does not infer
unknown Staff lifecycle state from a missing column.

After installing the prerequisite, the unmodified standard preflight CLI
actually ran successfully against the connected app database with the reviewed
map: **1 role, 1 automatic field, 1 reviewed field, 0 unresolved fields,
0 assignment blockers**, no additional pages.

All four role columns and three validated restrictive actor FKs are verified
installed; creator/updater are UUID NOT NULL, deletion time is nullable
TIMESTAMP WITH TIME ZONE, deletion actor is nullable UUID. Every previous column
of the existing role is unchanged, including its version **2**, UUID, names,
description, grants and creation/update times. Existing User identity/version/
active/protected state is unchanged. No Staff/User/role was created for backfill.

### Connected-database field lifecycle integration

Actual FastAPI HTTP routes were exercised against the newly migrated connected
database inside an outer transaction. A transient valid session/actor fixture
was revalidated by the normal server authorization path; only the database
dependency was scoped to savepoints. No authentication/permission dependency
was bypassed or product code weakened.

- Creation: HTTP 201, version 1, `created_by=updated_by` server actor, deletion
  fields NULL.
- Metadata edit: HTTP 200, version 2, creator/time unchanged, updater set by
  server and update time advanced.
- Permission save: HTTP 200, version 3, same attribution rules/time advanced,
  requested grant stored.
- Deletion: HTTP 200, version 4, server updater/deleter, timezone-aware
  `deleted_at=updated_at`; role/name/grants remain stored.
- Repeated delete and deleted detail: HTTP 404; live list omits tombstone.
  Exactly one success audit for each of create/update/permissions/delete.

The outer transaction was then rolled back. Independent readback confirms the
original migrated role unchanged and **no persisted test roles, sessions or
audits**. User/Staff/role/session/audit counts match pre-test counts. API and
portal were restarted afterward; the actual proxied readiness endpoint returns
HTTP 200 `{"status":"ready"}` against the installed app schema.

Do not interpret disposable fixture success as “no affected records.” The
read-only command in [operations](role-lifecycle-operations.md) produces every
role ID, field-specific automatic/reviewed/unresolved evidence and reason, and
all assignment counts. It separately pages authorized Staff UUID/status/login/
deleted references without contact or credential data. Preserve every report
page and manually reconcile all unresolved fields before managed rollout.
Deleted-Staff links cannot be cleared through the normal editable Staff workflow;
report those blockers for reviewed operator resolution, not bypass.

## Actual disposable migration/preflight coverage

All migrations below actually ran against local private PostgreSQL test databases
using synthetic identities, never configured URLs:

- Fresh empty database: foundation-to-head migration succeeds. Required
  attribution and nullable deletion columns are installed without invented
  roles/users.
- Populated `0028_staff_designation_lifecycle` historical role: every legacy
  column (including UUID, raw/normalized name, description, grants, version and
  both timestamps) is compared before/after forward upgrade.
- Two complete automatic-evidence fixtures: one version-1 unmodified role and
  one version-3 creation→metadata→permission history. Each has 1 inventoried
  role, **2 audit-derived fields, 0 reviewed fields, 0 unresolved fields**.
- Six incomplete/conflicting fixtures: missing history, one old update,
  tied timestamps, conflicting creations, nonexistent actor and near-but-not-
  exact final timestamp. Every fixture refuses upgrade atomically with actionable
  role UUID/field/reason, unchanged row/schema and unchanged migration head.
  Explicit **field-specific** existing-user review then permits each upgrade:
  missing/conflict/nonexistent-actor fixtures need both fields; old-update/tie/
  proximity fixtures retain verified creators and need reviewed updaters.
- Invalid UUIDs, duplicate keys, unknown role/User references and extra mapping
  fields reject before DDL. CLI preflight actually ran on a historical role
  with **1 role, 0 automatic fields, 0 reviewed fields, 2 unresolved fields**,
  reporting its generated synthetic role UUID and returning exit 1.
- Populated assignment fixture actually inventories **1 role and 4 blockers**:
  active/enabled, inactive, login-disabled and retained deleted Staff. Its
  generated synthetic role/Staff UUIDs are returned by preflight; assignment-
  offset paging returns only the requested bounded references. Both creator/
  updater require reviewed mapping (no audit history). Forward migration
  preserves every User and Staff column/reference unchanged.
- Restrictive actor FKs/NOT NULL are exercised; missing actors and null required
  attribution fail. Populated downgrade is refused.

Automatic updater evidence requires full version-counted strictly chronological
history, including permission saves, and exact final persisted timestamp evidence.
An old event or timestamp proximity never proves the current updater. Edited
legacy roles commonly need manual updater review because historical audit and
application update clocks differ. This is deliberately conservative.

## Focused verification results

- Initial 13-file backend run: **120 passed / 3 failed**. Failures were a test's
  UTC string representation comparison and two obsolete physical-deletion/
  downgrade expectations, not silent migration fallback.
- Corrected affected 4-file run, including added assignment-inventory and
  transactional tombstone checks: **32 passed, 0 failed**. Together with the
  unchanged passing checks this covers **125 distinct focused checks**.
  Commands:

  ```sh
  sh scripts/test-api-foundation.sh tests/test_roles.py tests/test_role_lifecycle.py tests/test_migration_roles.py tests/test_migration_role_lifecycle.py tests/test_zone_permissions.py tests/test_master_permissions.py tests/test_migration_zone_permissions.py tests/test_migration_master_permissions.py tests/test_migration_staff_designation.py tests/test_staff_lifecycle.py tests/test_migration_couriers.py tests/test_migration_locations.py tests/test_migration_designations.py
  sh scripts/test-api-foundation.sh tests/test_role_lifecycle.py tests/test_migration_role_lifecycle.py tests/test_migration_zone_permissions.py tests/test_migration_master_permissions.py
  ```

- API checks cover server-owned actor fields/spoof rejection on all mutations,
  retained grants/names, repeated/stale deletes, unavailable metadata/permission
  edits, all Staff reference states, disabled-login assignment rejection,
  explicit unassignment, login/refresh/access/session identity denial and
  policy-lock transactional denial. Independent connections cover duplicate/
  edit/delete races, assignment-versus-delete and queued grant-dependent writes.
- Frontend session/Staff/role service run: **44 passed, 0 failed**.
- Authoritative OpenAPI export and Orval regeneration: pass; shared-library
  TypeScript build: pass. Generated changes are limited to role response
  attribution/deletion fields, without unrelated schema-name churn.
- `sh scripts/check-api-contract.sh`: pass.
- Portal `pnpm --filter @workspace/evexia-portal run build`: pass.
- Managed API and portal processes restart and serve cleanly. Signed-out login
  preview renders normally; this does not certify installed managed schema or
  authenticated readiness by itself; the subsequently approved installed-schema
  readiness and HTTP integration are recorded above.
- The approved connected-database inspection exposed a preflight-only driver
  mismatch for bare `postgresql://` configuration. Role preflight now explicitly
  selects the installed Psycopg 3 driver, as existing application/Alembic
  connections already do. The historical assignment-inventory CLI regression
  ran with a bare PostgreSQL URL: **1 passed, 0 failed**.
- Authenticated isolated browser pass (Roles baseline, Staff permissions and
  new lifecycle spec): **15 Chromium tests passed, 2 failed** initially. The new
  fixture used an email domain rejected by EmailStr and created a role before
  setup failed; that role contaminated the baseline's empty-state assertion.
  The fixture now uses a permitted synthetic example.com address and its own
  private harness/database whenever batched, preserving baseline empty-state
  and Staff count isolation.
- Focused continuation of that previously blocked lifecycle flow:
  **1 passed, 0 failed**. Real login and persistence, aborted role-detail
  request/retry, response-level tombstone rejection even when a stale list still
  contains the ID, disabled unavailable choice, explicit No role remediation,
  persisted unassignment and actual versioned soft-delete response all pass.
  Screenshot review confirms Staff remains after explicit unassignment.
  Passed baseline tests were not repeated. The initial empty-state failure was
  fixture contamination, not deletion inferred from a page; its fresh-isolated
  baseline was subsequently exercised by the configured release gate.
- The configured `pnpm run validate:release` actually ran: all **174 Chromium
  baseline checks passed**, including Roles' clean empty-state baseline;
  **45 Roles & Permissions matrix checks passed** across Chromium, Firefox and
  WebKit (not native Safari). The gate also completed **30 Download checks**,
  plus the printed backend/service batches, before moving to unrelated Patient
  enlarged-text fixtures.
- The entire configured gate did **not** reach completion: its completion
  monitoring budget was exhausted after 1,800 polls and the shell was terminated
  with Hangup during that later Patient group. No task-related test assertion
  failed in this gate. The full release is recorded **incomplete due to runtime
  infrastructure**, not passed; retrying the unchanged oversized command would
  reproduce the cutoff. Completion explicitly audits skipping that unfinishable
  full gate while preserving the finished focused/backend/contract/browser and
  connected-database checks above. Its assertions and configuration were not
  weakened.

No live deployment, local-demo migration, previously downloaded workbook refresh,
grant cleanup, automatic reassignment or role recovery API/UI was performed.
