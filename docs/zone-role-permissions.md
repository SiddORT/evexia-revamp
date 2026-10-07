# Restricted staff workspace and Zone grants

## Authorization boundary

Only the protected system Super Admin administers custom roles (`roles.manage`)
and staff access (`staff.manage`). The singleton remains outside staff assignments
and always retains its existing capabilities. A custom role named Super Admin is
ordinary custom data, never a protected identity.

The five persisted grant keys are `zone.add`, `zone.edit`, `zone.delete`,
`zone.export`, and `zone.import`. Unknown or duplicate keys are rejected.
All/None select checkboxes; they are not permission keys.

| Capability | Allowed operations |
| --- | --- |
| Any one Zone grant | Non-deleted Zone list/detail as prerequisite |
| Add | Manual create |
| Edit | Name/status edits, activation and deactivation |
| Delete | Soft deletion |
| Export | Filtered CSV/XLSX exports |
| Import | CSV/XLSX sample downloads, review and create-only confirmed commit |
| None or no assignment | No Zone list/detail/action or direct route |
| Protected singleton only | Trash list, restore, roles/staff administration, global reports, unrelated masters/settings/inventory/private files/domain administration |

Import is standalone: it neither needs nor implies Add, Edit or Delete. Existing
transfer size/row limits, digest review, create-only semantics, download logging
and recovery behavior remain unchanged. Staff may initiate Zone samples in the
download ledger, but cannot read global history or log unrelated module downloads.
Exports are reauthorized again before durable ledger acceptance/file release.

## Explicit staff identity

The immutable User-to-StaffProfile link supplies identity, not a role-name match.
Staff retain null system role, null User.email and generated username/password.
The directory role/designation strings remain business metadata.

Workspace login is opt-in. Eligible staff must have an active User, an active
profile and `workspace_login_enabled=true`. Role assignment is explicit by UUID
and may be null. An enabled staff member with no grants may sign in to a clear
no-access screen, but cannot open Zone or any other module. Effective grants are
loaded from current records at login, refresh, `/me` and sensitive requests, never
trusted from client or token claims. Tokens remain memory-only and refresh cookies
remain HttpOnly, rotating, session-bound and single-active-session.

Disabling login or inactivating a staff profile revokes its sessions in the same
transaction. Role revocation/reassignment/removal changes the next protected
request without waiting for a token to expire. Missing/deleted identity links
fail closed. No credential reset, invitation or recovery feature is introduced.

## Administration contracts

`POST /api/v1/admin/roles/{id}/permissions` accepts
`{permissions: [...], expected_version: N}`. It preserves name/description,
advances the role version and records `role_permissions`. Metadata edits preserve
permissions and use that same concurrency version. Role deletion returns
`409 role_assigned` while any staff profile references it, including disabled ones.

`POST /api/v1/admin/staff/{id}/access` accepts
`{custom_role_id: UUID|null, workspace_login_enabled: boolean, expected_version: N}`.
It preserves encrypted PII, business metadata, immutable User ID and password.
Inactive accounts cannot be enabled. Stale versions, missing roles, unknown
fields or attempts to target the protected singleton are rejected. Access changes
advance the staff version and record `staff_access`. Audit actor, session,
resource, request and UTC time are server-owned and commit with the change;
PII, credentials and role descriptions are not copied into audit records.

Lost commit responses require authoritative refresh/review, never automatic
replay. The permissions editor keeps its draft through recoverable failures.
Stale/deleted roles and uncertain outcomes require explicit reconciliation.
Dirty grants must be saved or deliberately discarded before switching/leaving.

## Transaction ordering

A transaction-scoped authorization-policy lock is acquired before actor User,
session, StaffProfile, CustomRole and Zone row locks for sensitive Zone actions,
permission changes, assignments, staff inactivation and file acceptance. This
serializes policy revocation against writes and exports: an already authorized
operation may complete before a queued revocation; requests ordered after it
reload the current policy and fail closed. Parsing/encoding is outside the
mutation lock; import commit repeats policy and duplicate checks. Global
serialization favors correctness for this bounded scope, not high-throughput
per-role authorization. Do not change lock order without race validation.

## Opt-in rollout and operational handoff

Forward migration `0015_zone_permissions` follows the reconciled
`0014_download_reporting_index` head. Existing roles gain empty grants; existing staff gain
null assignment and disabled login. There is no matching by business label,
sample grant, account enablement, local-data migration or automatic upgrade.

Before an approved shared/production migration, pause writes, verify backups
and restoration, review the forward migration and apply the established operator
Alembic procedure. The API never runs DDL at startup. This implementation does
not migrate a managed/shared database, bootstrap real identities, change real
staff configuration or deploy. Health readiness verifies the new columns;
an unmigrated live instance is BLOCKED, not evidence of synthetic test failure.

After migration, a protected administrator must explicitly save desired grants,
choose a custom role for each intended staff account, and enable workspace login.
Use the previously handed-off generated credentials; enabling access never
reveals or regenerates passwords. Unknown/lost initial credentials require a
separately approved recovery design.

Isolated checks: `pnpm run test:api-foundation`, frontend session/role/staff
service tests, `pnpm run validate:release`, and the portal compilation command.
They use disposable databases, separate listeners/results and synthetic
accounts only. They do not certify live migration/bootstrap/deployment readiness.
