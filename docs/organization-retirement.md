# Legacy organization retirement

## Scope and current evidence

EVEXIA remains non-tenant. No replacement organization entity, organization
archive, membership-to-role conversion, new permission system or account
promotion is introduced.

The reconciled migration ancestry is:
`0028_directory_soft_delete` → `0028_staff_designation_lifecycle` →
`0029_role_lifecycle` → `0029_directory_crypto_additive` →
`0030_directory_crypto_retirement` → **`0031_remove_organizations`**.
Every predecessor migration remains unchanged.

An operator-approved **read-only development inspection on 2026-10-10** found:

| Evidence | Count |
| --- | ---: |
| organizations | 0 |
| memberships / membership-linked users | 0 / 0 |
| non-null refresh scope correlations | 0 |
| non-null audit scope correlations | 0 |
| dangling audit scope correlations | 0 |
| logical organization/membership audit resources (including dangling) | 0 |
| unexpected catalog/logical SQL dependencies | 0 |

The connected development database was at **`0029_role_lifecycle`**, not the
directory-encrypted predecessor required by this release. These findings are
point-in-time evidence, not permission to remove data or assurance that it will
remain empty. The reusable preflight must be rerun before operator rollout.
Production data, external SQL consumers, durable recovery custody and a managed
restoration rehearsal are **unverified**. No managed migration, recovery export,
key change or deployment was performed for this work.

## Exact schema removal

The forward migration removes:

- `refresh_sessions_organization_id_fkey`;
- `ix_audit_events_organization_created`;
- `refresh_sessions.organization_id` and `audit_events.organization_id`;
- `memberships`, including its primary key, two FKs, user/scope uniqueness,
  `ck_membership_role` and its two explicit indexes;
- `organizations`, including its primary key and automatic row type/defaults.

There is no `CASCADE`. Database dependency catalogs, exact baseline column,
constraint and index contracts, logical function/procedure bodies, views,
materialized views, triggers, RLS/table-kind/inheritance anomalies and dependent
objects are checked before DDL. Unexpected objects block removal, not deletion.
Non-baseline comments, explicit grants/column ACLs, security labels and a retired
table owner different from the executing role also block removal. They require
reviewed recovery support, not silent deletion and incomplete ownership/grant
recreation. Baseline recovery is bound to the original executing owner role.
Dynamic external SQL, application integrations outside this repository, other
connections and encoded SQL cannot be proved absent by PostgreSQL catalog
inspection. Operator review and stopped old writers remain mandatory.

Users, Staff/MR relationships, permissions/grants, credential rows and chain
links, sessions, identity/token versions, revocation timestamps and existing
audit events are not edited or deleted by this migration.

## Credential rejection boundary

Dropping a nullable scope field must not make an old invalid credential valid.
For each scope-bearing refresh row the migration appends metadata-only audit
evidence:

- action `refresh_rejected`, outcome `failure`;
- resource `refresh_credential`, the existing credential-row UUID;
- persisted owner and session references, reason `legacy_scope_retired`.

No token, token hash, organization correlation or contact information is written
to the marker. Rotation checks owner-bound evidence **before** replay/replacement
classification. Both live and revoked scope-bearing credentials remain denied;
even legitimate `new_login` evidence cannot produce a replacement notice for
such a credential. Memberships never authorize or map a User. Unmapped users
remain unmapped. Ordinary refresh rotation, ownership/version checks, replay
revocation and replacement notices remain separate checks.
The historical access-token `org` claim remains explicitly rejected; its
literal is deliberate historical credential denial, not an organization lookup
or authorization dependency.
Rotation also holds an ordinary relation lock and checks the physical credential
columns against current mappings before reading credentials. Deploying new code
against a predecessor with the extra retired field fails closed; it cannot ignore
that field before migration rejection evidence exists. The lock prevents DDL
from racing that schema check.

These rejection events must be retained with credential history. Downgrade
retains them rather than erasing security evidence or reactivating credentials.
Do not add an audit-pruning rule that deletes them while their credential rows
exist.

## Read-only preflight

From `artifacts/api-server/backend`, with approved operator configuration:

```sh
python3 -m app.organization_preflight --limit 100 --offset 0
```

The tool normalizes bare PostgreSQL URLs to the application's Psycopg 3 driver,
uses a repeatable-read, read-only transaction and a 30-second statement timeout.
Reports contain counts, bounded User UUIDs and eligibility classifications,
plus bounded dependency metadata. They never emit credentials, token hashes,
contact fields or record payloads. Errors are sanitized and explicitly blocked.
Continue membership User pages with `--offset`; count totals are not truncated.
Exit 0 means successful inventory, not migration/retention/backup approval.
Exit 1 means unexpected dependencies; exit 2 means unverified access/schema or
recovery. Neither permits rollout.

The classifications mirror explicit protected Super Admin, active MR profile,
and active enabled non-deleted staff with a non-deleted custom role (when
assigned). A legacy membership label contributes nothing to eligibility.

## External recovery and retention gates

Before any managed removal, stop all old application nodes and external writers.
Resolve audit/identity retention and unknown logical correlations explicitly.
Obtain separate approval for the target database and for durable recovery
custody. Prefer an independently restricted operator backup volume outside the
workspace: parent directory 0700, file 0600, owned by the operator, no symlinks.
Do not use project files, App filesystem deployment storage, Git, browser
storage, or a public file download to hold retired records.

With **separate permission to export retired records**, the same read-only
preflight can create an exclusive new recovery file:

```sh
python3 -m app.organization_preflight --backup /restricted/operator/retirement/recovery.json
```

That path is illustrative, not an existing backup or permission grant. The
directory must already exist and be private. The tool refuses repository paths,
existing files, permissive directories, unknown dependencies or recovery over
64 MiB. It returns only the file SHA-256, not its content. Empty retired data
should also be backed up: empty counts are needed to prove safe empty rollback.

The restricted file contains exact retired rows, scope correlations and
credential/audit retained-row integrity fingerprints, plus membership-linked
identity snapshots and database/schema identifiers. No password or token hash
values are exported. SHA-256 provides integrity, **not encryption or proof of
durability**. The custodian must supply access control/encryption at rest,
independent durable copies, retention and availability. A `/tmp` file used in
tests is not a managed durable backup.

Rehearse restoration using an independent disposable PostgreSQL clone with the
original database/schema names and the exact retained source rows. Exercise
upgrade → downgrade → re-upgrade with the exact recovery file and digest.
Compare every retired row, correlation and retained identity/session/audit row,
and confirm scope-bearing refresh remains rejected. Preserve the custodian's
count/integrity/rehearsal evidence. Only after that successful rehearsal may an
operator attest `organization_restore_verified=<the exact SHA-256>`.
This is an explicit operator attestation, not automatic verification of a
remote backup or an unrun rehearsal.

The migration locks all retirement/eligibility/session/audit tables with
`ACCESS EXCLUSIVE ... NOWAIT`; revalidates dependencies, target identity,
counts/content, recovery integrity and attestations under that lock; and retains
exclusion through DDL. A writer or stale export causes failure, not a partial
drop. The Alembic transaction owns all changes and security marker inserts.

## Coordinated development/external-database rollout

**Do not run these instructions against Replit-managed production.** Its Publish
schema flow requires separate operator review; this document is not a production
migration hook. An external production database also requires its own separately
approved documented operator workflow.

For an individually approved development/external database, first complete the
Staff/Role and directory-encryption prerequisites, current-source preflight,
retention resolution, durable restricted recovery and successful restoration
rehearsal. Then a qualified operator may run Alembic with:

```sh
python3 -m alembic \
  -x organization_removal_approved=yes \
  -x organization_writers_stopped=yes \
  -x organization_external_consumers_reviewed=yes \
  -x organization_backup_durable=yes \
  -x organization_retention_resolved=yes \
  -x organization_backup=/restricted/operator/retirement/recovery.json \
  -x organization_backup_sha256=REVIEWED_SHA256 \
  -x organization_restore_verified=REVIEWED_SHA256 \
  upgrade 0031_remove_organizations
```

The placeholders are not real evidence. Successful synthetic tests do not
authorize a managed drop. `APP_ENV=test` permits a genuinely empty synthetic
forward upgrade without recovery, but populated test data still requires the
recovery gates. Test mode is not an operator shortcut for managed environments.
Post-merge setup now inspects revision status only and **does not automatically
cross this boundary or the still-unapproved encryption predecessors**.
Readiness requires this coordinated schema revision and existing directory
encryption readiness; a listening process alone is not rollout success.
The merged directory-key rotation tool supports both the encrypted predecessor
and this organization-free revision, verifies required encrypted/index columns
and absence of retired plaintext, and reports the actual applied revision.
Its stable encryption approval protocol remains unchanged.

## Downgrade and limitations

Always provide the original file/digest and matching successful rehearsal and
retention attestations, including for an originally empty schema. Separately
approve rollback using `-x organization_rollback_approved=yes`, and stop writers.
The new migration's downgrade restores the exact prior nullable fields, tables,
constraints and indexes, then the saved retired rows and correlations.
It verifies restored counts/content and preserved identity/credential/audit
fingerprints. Required rollback evidence cannot be inferred from the current
absence of the retired tables: an organization could originally have had no
members and leave no retained User rows.

Missing/corrupt/incomplete recovery, a different database/schema, deleted or
changed correlated rows, identity-version changes, record conflicts and failed
restoration roll back the entire downgrade. Security markers stay in the audit
history; no credential is reactivated. This exact-restore path deliberately
refuses rollback after legitimate mutation of a backed-up correlation/identity.
Such a rollback needs separately reviewed recovery/reconciliation, not force,
fake empty tables, broad deletes, or edits to historical migrations.

Downgrading older revisions is **not** promised: previous Staff/Role,
designation, directory-encryption and session-history safeguards still apply.
Do not run a pre-session or pre-encryption application against this release.

## Repository dependency classification and changed files

- Current runtime cleanup: `app/db/models.py` removes both entities and fields;
  `app/services/auth.py` replaces the removed refresh guard; `app/api/v1/system.py`
  verifies the coordinated revision. Authorization, provisioning, repositories,
  reporting contracts, endpoints and frontend UI need no organization system.
- Recovery-only references: the new migration,
  `app/services/organization_retirement.py`, `app/organization_preflight.py`
  and synthetic restoration tests are intentionally historical/recovery tooling.
- Immutable history: `0001_identity_foundation.py`,
  `0003_system_identity_domain.py`, their `0003` preservation fixture and
  `0006` historical SQL fixtures retain original names/columns. The current
  `0006` round-trip fixture uses external synthetic recovery for later
  organization-free heads rather than importing removed entities.
- Current schema assertions: `tests/test_api.py`, `test_domain.py`,
  `test_patients.py` no longer map retired fields. PostgreSQL retirement tests
  assert true physical absence and populated recovery. Historical master/index
  round-trip helpers capture empty-scope recovery rather than bypass rollback
  gates. Encryption fixture upgrades cross the actual new head.
- Schema export: `scripts/schema_dictionary/{generate.py,purposes.py}` handles
  static nested encryption DDL and removed objects, includes migration-only
  encryption infrastructure separately, and removes retired logical associations.
  Current output goes to ignored `generated-artifacts/schema/`; explicit
  `--working-tree` output is labeled unmerged, never a release/live export.
- Historical downloads: `exports/README.md` marks the older checked-in workbook
  and validation JSON as historical, not current. Binary workbook content is not
  erased or treated as live schema evidence.
- Historical explanatory references in `threat_model.md`, account comments,
  repository eligibility comments and storage/auth docs describe legacy
  non-promotion, not runtime dependencies. `AdminLayout.jsx`'s ordinary label
  **People & Organization** remains unchanged.
- `pnpm-workspace.yaml` describes package workspace membership only; it is not
  the retired database entity. Hidden tracked/configured files, generated
  clients, schema exports and uploaded historical requirements were searched.
- Verification prerequisite: existing generated Zod literal bounds were emitted
  after schemas that used them (60 TypeScript initialization errors). A
  tested literal-only hoisting step in the existing codegen pipeline preserves
  values and validation expressions without changing the API contract.
  `scripts/hoist-generated-zod-constants{,.test}.mjs`,
  `lib/api-spec/package.json` and generated Zod output implement that fix.

## Verification evidence

See `docs/organization-retirement-verification.md` for the actual commands,
results and outstanding gates. Never label a synthetic schema test as a managed
migration or a read-only development inventory as production verification.
