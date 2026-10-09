# Restricted staff workspace and master grants

## Authorization boundary

Only the protected system Super Admin administers custom roles (`roles.manage`)
and staff access (`staff.manage`). The singleton remains outside staff assignments
and always retains its existing capabilities. A custom role named Super Admin is
ordinary custom data, never a protected identity.

The catalogue contains forty explicit keys: `add`, `edit`, `delete`, `export`,
and `import` for each of `headquarter`, `zone`, `mr`, `patient`, `doctor`,
`product_category`, `location` (Storage Location), and `courier` (Courier Partner).
The original five Zone keys are unchanged. Unknown or duplicate keys are rejected.
All/Clear select the complete forty-key catalogue; they are not permission keys.
Each group selects its own five keys even while search hides individual actions.

| Capability | Allowed operations |
| --- | --- |
| Any one master grant | That master's live list/detail and minimal bounded consuming reference/filter choices |
| Add | Manual create |
| Edit | Name/status edits, activation and deactivation |
| Delete | Existing soft deletion where that master supports it; no new Doctor/Patient deletion workflow |
| Export | Filtered CSV/XLSX exports |
| Import | Available authenticated samples, existing client templates with download evidence, review and create-only confirmed commit |
| None or no assignment | No master list/detail/action or direct route |
| Protected singleton only | MR password reset, trash/restore, roles/staff administration, global reports, unrelated masters/settings/inventory/private files/domain administration, Patient treatment/history and Doctor payments |

Import is standalone: it neither needs nor implies Add, Edit or Delete. Existing
transfer size/row limits, digest review, create-only semantics, download logging
and recovery behavior remain unchanged. Staff may initiate their permitted master samples in the
download ledger, but cannot read global history or log unrelated module downloads.
Exports are reauthorized again before durable ledger acceptance/file release.

## Explicit staff identity

The immutable User-to-StaffProfile link supplies identity, not a role-name match.
Staff retain null system role, null User.email and generated username/password.
The directory role/designation strings remain business metadata.

Workspace login is opt-in. Eligible staff must have an active User, an active
profile and `workspace_login_enabled=true`. Role assignment is explicit by UUID
and may be null. An enabled staff member with no grants may sign in to a clear
no-access screen, but cannot open any master or other module. Effective grants are
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
`409 role_assigned` while any staff profile references it, including inactive,
login-disabled and retained soft-deleted profiles. Disabling login is not
unassignment. Explicitly unassign/reassign editable Staff through the access
workflow; deleted Staff cannot be edited through that workflow and their retained
links require separate reviewed operator resolution. Never clear links automatically.

Deletion retains the role ID, name, description, normalized global uniqueness
and permission arrays. It sets `deleted_at`/`deleted_by`, `updated_at`/`updated_by`
and increments the shared version exactly once with the existing atomic
`role_delete` audit event. Tombstones are absent from normal list/detail and
rejected for metadata, permission and assignment mutations (even if login is
disabled). Repeat/stale deletes cannot replace deletion evidence. Assigned
tombstones in corruption fixtures fail closed at login, refresh, access/session
validation and transactional grant checks, without clearing stored grants.

Role responses expose read-only required `created_by` and `updated_by` User
UUIDs and nullable timezone-aware `deleted_at`/User UUID `deleted_by`. Requests
reject all four fields. Creators never change; authenticated revalidated actors
own all new attribution. Staff choice hydration uses an authoritative detail
request; missing data from one page or a network error is not deletion evidence.

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
Dirty grants must be saved or deliberately discarded before changing roles,
pages, metadata or leaving. Switching between the Roles and Permissions tabs
preserves the selected role and draft without a save or discard.

Roles initially shows the paginated authenticated directory with sibling
Edit/Delete controls and selected-role description, saved counts and audit
timestamps. Permissions uses the same directory and selection with a Masters >
eight-master workspace. Selected progress, saved counts, All/Clear and tri-state
module selectors always refer to the complete supported forty-grant catalogue;
individual master groups select only their own five grants.
Search filters action presentation only, not counts, selection or save payloads.
The historical layout contributes presentation only: there are no sample roles,
unsupported modules, legacy grant keys or browser-local permission persistence.

## Transaction ordering

A transaction-scoped authorization-policy lock is acquired before actor User,
session, StaffProfile, CustomRole and domain/record row locks for sensitive master actions,
permission changes, assignments, staff inactivation and file acceptance. This
serializes policy revocation against writes and exports: an already authorized
operation may complete before a queued revocation; requests ordered after it
reload the current policy and fail closed. Parsing/encoding is outside the
mutation lock; import commit repeats policy and duplicate checks. Global
serialization favors correctness for this bounded scope, not high-throughput
per-role authorization. Do not change lock order without race validation.

## Opt-in rollout and operational handoff

Required role attribution and soft deletion now use forward `0029_role_lifecycle`
after the accepted Staff lifecycle migration. See
[role lifecycle operations](role-lifecycle-operations.md) for read-only preflight,
conservative evidence rules, reviewed field-specific mappings, blockers, backup,
coordinated rollout and populated-downgrade refusal. Managed execution is unapplied
until separately approved; no automatic legacy actor guesses are allowed.

The original `0015_zone_permissions` migration introduced empty grants and
disabled/unassigned staff defaults. The additive forward migration
`0021_master_permissions` follows the actual `0020_patient_directory` head and
only widens the permission constraint. It preserves every existing role's grants,
metadata/version/timestamps, assignments, staff state and identities. New roles
remain empty. Downgrade refuses non-Zone grants rather than silently losing them.
There is no matching by business label, sample grant, account enablement,
local-data migration or automatic upgrade.

Before an approved shared/production migration, pause writes, verify backups
and restoration, review the forward migration and apply the established operator
Alembic procedure. The API never runs DDL at startup. This implementation does
not migrate a managed/shared database, bootstrap real identities, change real
staff configuration or deploy. Existing readiness verifies required columns;
operators must also verify the permission constraint's migration head before
allowing new grant saves. Startup never automatically widens it.

After migration, a protected administrator must explicitly save desired grants,
choose a custom role for each intended staff account, and enable workspace login.
Use the previously handed-off generated credentials; enabling access never
reveals or regenerates passwords. Unknown/lost initial credentials require a
separately approved recovery design.

## Narrow account and reference workflows

MR Add and Import create only fresh User/MRProfile/directory identities.
Neither grants generic `domain.provision`, identity lookup/administration or MR
password reset. Ambiguous manual MR creation recovery by username is Add-only
and restricted to a successful creation by the same actor and session; unrelated
legacy or other actors' identities are unavailable. Credentials remain one-time,
memory-only responses, absent from list/detail, exports, storage and audit records.

Patient Add/Import creates only a fresh Patient identity and extension; Edit
synchronizes only that saved extension's owner/status/version. Doctor Edit/bulk
MR shifts synchronize already-linked Patient owners transactionally without
granting general `domain.assign_patient`. Existing graph locks, inactive saved
context, versions and assignment invariants are retained.

Reference helpers authorize their consuming master, return bounded minimal
identifier/label/status context and do not expose referenced full directories.
PIN lookup explicitly requires the consuming MR, Doctor or Patient Add/Edit
action, including a fresh check after provider work. MR's associated-Doctor
viewer returns paginated labels/registration/status/Zone context only; links to
Doctor editing appear only with Doctor Edit. Doctor reference aggregation
refuses directories over 10,000 choices rather than silently loading partial data.

Isolated checks: `pnpm run test:api-foundation`, frontend session/role/staff
service tests, `pnpm run validate:release`, and the portal compilation command.
They use disposable databases, separate listeners/results and synthetic
accounts only. They do not certify live migration/bootstrap/deployment readiness.
