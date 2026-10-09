# Role attribution and retained deletion: operator procedure

Forward `0029_role_lifecycle` follows accepted `0028_staff_designation_lifecycle`.
Only `custom_roles` schema changes: required UUID creator/updater with restrictive
User foreign keys and nullable timezone-aware deletion time/restrictive User
deletion attribution. Global name uniqueness stays unchanged, including deleted
names. No roles, users, permissions or staff relationships are created or removed
for backfill. Existing timestamps and versions are never advanced by migration.

## Evidence and reconciliation

The operator-only preflight uses a repeatable-read, read-only transaction.
It inventories **every role**, independently reports creator/updater source and
reason and counts every assigned Staff reference, including retained deleted
Staff. Output contains role/User UUIDs and bounded Staff UUID/status/login/deleted
flags, not contact details, ciphertext, credentials or business labels.

Automatic evidence is successful `custom_role` audit events correlated by the
exact resource UUID and validated against existing User UUIDs:

The shared evidence helper is frozen historical migration logic. Changes to
accepted reconciliation rules require a reviewed forward revision; do not
silently change the behavior of an already applied migration.

- Creator: exactly one `role_create` at the persisted creation timestamp, a
  valid existing actor, no preceding mutation and no contradictory successful
  `role_delete` for that still-present legacy role.
- Updater: creation evidence plus **exactly version-many** successful events
  (creation followed only by metadata/permission saves), all existing actors,
  strictly increasing event timestamps with no ties. Each persisted legacy
  save increments the shared version once, including unchanged permission saves.
- Version 1 can use the verified creator for both fields only if its sole event
  is creation and its saved timestamps are equal.
- An edited role additionally requires the final event's timestamp to equal
  the stored update timestamp. Audit events have no saved version and typically
  use transaction-start `now()` while update timestamps use application time;
  therefore many genuine edited roles **require reviewed updater mapping**.
  Near timestamps, one old update, incomplete counts, ties, nonexistent actors,
  staff ownership, labels and the currently protected administrator are never
  sufficient. Conservative refusal is intentional, not permission to loosen
  evidence rules for rollout.

For each unresolved field, an authorized operator must inspect independent
historical evidence and explicitly review an existing User identity. If that
evidence cannot be established, **stop rollout**. No placeholder users or
permanent nullable attribution are permitted.

JSON mapping format (replace illustrative UUIDs with reviewed existing IDs):

```json
{
  "00000000-0000-4000-8000-000000000001": {
    "created_by": "00000000-0000-4000-8000-000000000002",
    "updated_by": "00000000-0000-4000-8000-000000000003"
  }
}
```

Only supply reviewed fields; omitted fields retain automatic evidence or remain
unresolved. Explicit fields report `reviewed_mapping`, never `audit`.
Unknown roles/users/fields, malformed UUIDs and duplicate keys reject the entire
file. Keep this operator file outside source control and record the reviewer and
supporting evidence in the approved operational record.

## Approval, backups and coordinated release

Configured/shared/production inspection and migration each need separate
operator approval. These commands are the operator procedure; the subsequently
approved connected-development rollout is recorded in the completion report,
not evidence of any production migration.
Take and verify coordinated database/audit backups and restoration, review the
map, pause writes and stop all old API nodes. From the backend directory:

```sh
PYTHONPATH=. python -m app.role_attribution_preflight --limit 100 --offset 0
PYTHONPATH=. python -m app.role_attribution_preflight --mapping-file /operator/path/roles.json --limit 100 --offset 0
alembic -x role_attribution_map=/operator/path/roles.json upgrade head
```

Use all role pages (`--offset`) until `has_more` is false and all Staff reference
pages (`--assignment-offset`) until each `has_more_assignments` is false.
Preserve the full preflight JSON report for reconciliation. Counts cover the
whole snapshot, not just displayed pages. Exit 0 means attribution is complete,
1 means unresolved fields, and 2 means invalid mapping/unavailable inspection.
Assignment blockers do not block schema backfill, but do block deletion.

The migration locks roles, Staff, audits and Users to prevent legacy writes or
actor removal from invalidating the checked evidence. It validates the full map
and all evidence **before DDL**, then backfills and installs required FKs/NOT NULL
in one Alembic/PostgreSQL transaction. Failure leaves the old schema/data intact;
bounded failure text names role IDs/fields/reasons, with full detail available
through preflight. Locks can wait on running traffic: coordinate downtime and
approved operational timeout policy, never bypass locks.

Deploy schema/API/frontend together and check readiness plus the installed
revision and constraints. API startup never migrates. Application-only rollback
is unsafe: old code would physically delete unassigned roles and cannot create
required actor fields. Populated downgrade is refused because it would discard
attribution, revive tombstone grants and lose evidence. Use reviewed forward
repair or a verified coordinated restore; empty-only downgrade deletes no roles.
Never bypass the retained deleted-Staff guard to make a role deletable.

## Completion and current rollout evidence

See [role lifecycle completion report](role-lifecycle-report.md) for exact
disposable test results and existing-data inspection status. A synthetic clean
fixture is not a statement that the managed database has no unresolved roles or
assignment blockers. Previously downloaded workbooks are not refreshed here.
