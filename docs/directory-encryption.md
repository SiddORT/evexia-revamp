# Directory encryption: inventory and coordinated rollout

## Status and approval boundary

The coordinated ciphertext-only runtime, bounded search/continuation, transfers,
reference consumers and guarded retirement are implemented. **This is not a
managed-directory rollout.** The final runtime requires independently provisioned
Directory secrets and the verified `encrypted` schema phase. Do not deploy it
against predecessor plaintext schemas or claim managed PII is encrypted at rest
from disposable tests. Migration and key provisioning require separate approval.
No managed/shared database, real account, deployment or key is changed by the
implementation or its disposable tests.

Inspected predecessor: the single Alembic head
`0028_staff_designation_lifecycle`, following `0028_directory_soft_delete` and
`0027_mr_designation_identity`. Do not rewrite these accepted revisions.
Recheck the head before operator rollout or merge with other schema work.

## Field classification (merged schema)

| Table | Personal fields to encrypt |
| --- | --- |
| doctor_directory | name, phone, alternatePhone, email, dialCountry, dateOfJoining, qualification, clinicName, gstNumber, drugLicenceNumber, addressLine1, addressLine2, landmark, pincode, city, state, country |
| mr_directory | name, phone, email, dateOfJoining, addressLine1, addressLine2, landmark, pincode, city, state, country |
| patient_directory | name, gender, phone, dialCountry, email, dateOfBirth, instructionsLanguage, addressLine1, addressLine2, landmark, pincode, city, state, country |
| patients | No personal fields: id, assigned_mr_id, is_active, version, created_at, updated_at. Preserve unchanged. |

Keep Doctor registrationNumber (professional/business reference), MR employeeCode
(employee reference), and Patient code (operational reference) plaintext with their
existing normalized global uniqueness, including deleted records. They intentionally
remain visible to database operators and can identify people. Keep UUIDs, assignment/
owner/FK graph, HQ/Zone/designation/manager links, financial/contact/invoice settings,
status/verification, versions, timestamps and actor/deletion IDs operational.

User.email, User.username and account_identifier_reservations remain plaintext
identity metadata outside this four-table scope. Encrypting MRDirectory.email does
**not** encrypt MR account email or reserved past identifiers. Historical/audit
datasets and unrelated browser-local records are outside scope. Approved transfers
are intentional plaintext disclosures, not encrypted backups.

## Storage and key contract

Each personal field has a nullable additive `<field>_ciphertext` TEXT column.
These staging columns are accessed only by reflected offline tables, not mapped
into the current runtime ORM: the existing API can still use the predecessor schema
before an approved additive migration. Final ciphertext model mappings belong to
the coordinated runtime cutover.
Randomized AES-256-GCM reuses StaffCrypto's format and nonce handling without
changing Staff AAD, format or rotation. Directory AAD additionally binds the exact
table, UUID, field and format version. SQL NULL remains NULL; encrypted empty text
remains distinct. Dates use a tagged ISO date-only payload; timestamps are rejected.
No plaintext fallback is allowed once a ciphertext value exists.

Operator-managed secrets, independently per environment:

- DIRECTORY_ENCRYPTION_KEYS: JSON key-ID to base64 random 32-byte keyring.
- DIRECTORY_ENCRYPTION_KEY_ID: active non-secret ID, default primary.
- DIRECTORY_INDEX_KEY: independent base64 random 32-byte HMAC key.

Retain historical encryption keys for all live/deleted rows and every retained
backup. Keys must not equal each other, the signing secret or configured Staff
encryption/index keys. No secrets in arguments, SQL, reports or source. Provision
through the approved secret manager, not a generated example from a test harness.
Missing/invalid/historical keys, authentication or index mismatch fails closed
with a fixed safe error. Configuration does not automatically migrate any data.

Only required equality indexes are stored:

- MR name: existing lower(name) exact transfer-reference resolution.
- Doctor state: existing case-sensitive state filter.
- Patient duplicate: PostgreSQL lower(btrim(name)), dialCountry, national phone,
  dateOfBirth, encoded as a tagged JSON array, then domain-separated HMAC-SHA256.
  The final unique constraint must include every lifecycle state.

Blind indexes disclose equality and frequency (and duplicate identity equality)
to database observers. They do not conceal access patterns and are not suitable
for substring search. There are no plain hashes, substring-token indexes,
deterministic ciphertext, plaintext sort keys or stored search sessions.
PostgreSQL normalization is authoritative for legacy parity; do not substitute
Unicode casefolding or locale-dependent client normalization.

## Inspected consumer map and required cutover work

- doctors: projection, contact/status/edit/delete/bulk, SQL name/phone/email/
  qualification/clinic/MR search, state filter values, MR choices.
- mrs: directory predicates and projections, batched manager labels, associated
  Doctor names, manager choices, contact checks and provisioning/edit.
- patients: duplicate identity SQL, name search, batched Doctor/MR labels, Doctor
  choices, compact MR filter labels, owner/version/status and files graph.
- doctor_transfer/mr_transfer/patient_transfer: exact reference resolution,
  uniqueness, review digest/commit, old schemas, full-field CSV/XLSX export.
- sales_targets/sales_target_transfer: joined MR name projection/search/choices;
  employee-code transfer references stay operational.
- opening_balances/opening_balance_transfer: Doctor label/search/choices and
  registration transfer references. These endpoints keep minimal existing grants,
  not a full-directory response or new permission requirement.
- Existing directory and reference API schemas, JS services/hooks, masters and
  transfer pages need a coordinated continuation contract and generated OpenAPI.

Final ORM models map private text ciphertext columns only; logical properties
authenticate and decrypt authorized projections and encrypt mutations using the
record's final UUID. No plaintext dual writer or browser-local migration exists.
Owner/version/file synchronization and operational constraints remain intact.
Required contact/GST validation checks decrypted values, not ciphertext length.
The final MR identity trigger retains role, protected-account, username and
active/profile invariants; decrypted MR/account email equality is validated by
protected server persistence because linked User email remains plaintext.

## Search/resource contract

Existing authenticated GET contracts remain compatible. Application access
logging is disabled; SQL echo and INFO/DEBUG engine logging block crypto work.
Operator rollout must also check proxy/database logging sinks: do not record
query terms, bind values, ciphertext, constraint DETAIL or transfer contents.
Each request freshly revalidates its existing consuming action, including
continuations and downloads. Scan at most 500 candidates (one extra lookahead), return at
most 100 matches, with bounded batch reference reads and per-statement/lock
timeouts. Match literal case-insensitive substrings on exactly the previously
searchable fields, including linked names and business identifiers. Do not decrypt
an unbounded linked directory merely to filter another bounded scan.

UUID keyset continuation contains position only and is not authorization. Orders
are operational UUID order rather than plaintext name order; hydrate saved choices
separately under the consuming permission. No snapshot is promised across edits.
The UI must show partial section scope, scanned counts and explicit continuation,
including a section with zero matches. Never silently traverse every page or
display complete match totals. Search totals are null; Sales Target summaries
describe only the returned section. Choices use explicit continuation and hydrate
saved selections independently with minimal existing permissions.

**Exports include every matching record, not the visible section.** They
independently rescan the same literal query and SQL filters, authenticate candidates
and either export all matches or fail without a file. The ceiling is 10,000 scan
candidates / 5,000 matching file rows, with a thirty-second work deadline.
Search has a five-second work/statement budget. Narrow filters if limits are
exceeded; never silently traverse or return a partial export. Request-local bulk
projections are transient, not persisted plaintext results, browser-local mirrors,
search sessions or per-row queries. UUID cursor positions are not snapshots and
must reset when query, filters or actor change.

## Maintenance/write-exclusion design

Use a coordinated outage, not mixed-version writers or zero-downtime claims.
Stop all protected directory requests, exports/imports, offline writers and
assignment consumers; drain transactions. Use a separate maintenance DB login
which is not the API role and which the API role cannot assume. Runtime roles must
not own tables, have DDL rights, bypass triggers or alter maintenance evidence.
Directory and patient-owner write guards remain installed during resumable batches.
Each batch locks all four tables ACCESS EXCLUSIVE NOWAIT, authenticates existing
ciphertext before any update, and commits only verified encryption/index values.
Versions, original business/audit timestamps and relationships must not advance
merely for encryption. Restart keeps writers excluded and reauthenticates every
already processed row; counts/checkpoints never certify rows changed later.

Backfill is bounded to 500 rows per batch, operator-driven, across active, inactive
and soft-deleted records. Verification uses bounded pages and rejects missing
columns/ciphertext, wrong keys, source mismatch, invalid date encoding, duplicate
identity or wrong indexes. Plaintext does not repair corrupt ciphertext silently.
Reports may contain counts/stage/schema/key IDs and opaque identifiers only;
no raw source, ciphertext, keys, SQL parameters or exception details.
SQL INFO/DEBUG logging blocks maintenance. Each SQL statement has a ten-second
timeout, lock acquisition is NOWAIT, batches have a thirty-second application
deadline and freeze/full verification a 120-second application deadline (checked
between bounded row operations). Large inventories exceeding this budget require
separately reviewed resource sizing; do not remove these limits during rollout.
Normalization is projected in the page query rather than queried per row.

## Separate gates (not automatic startup operations)

1. **Backup/restore gate:** approve outage; take full schema/database/audit/files
   metadata backup and separately controlled key inventory. Restrict legacy
   plaintext backup retention. Restore into a restricted disposable environment
   with no outbound delivery or user access; verify complete relationships,
   assignments, versions and files graph, not just encrypted field counts.
2. **Additive gate:** apply only the additive revision after head reconciliation.
   Legacy columns/constraints are retained. Rehearse failure/rollback and restore.
3. **Backfill gate:** arm database write exclusion with the separate operator role;
   backfill bounded batches, interrupt/restart, authenticate every source and
   ciphertext/index pair. Leave outage/guards active on any error or lost response.
4. **Cutover gate:** only after runtime/client/consumer changes and auth/search/
   transfer tests pass, deploy all writers together, still paused. No old writer
   may return. The guarded retirement below is the coordinated schema cutover.
5. **Retirement gate:** separate explicit operator approval and verified recovery.
   Under exclusion, reverify *all* sources, ciphertext, indexes and graph metadata
   in the same transaction as retirement. Replace plaintext checks with validated
   server rules and final nullability/index constraints; ciphertext nonemptiness
   never proves required phone/email/GST. Drop old columns and indexes only then.
   Missing keys, corrupt data, stale verification, duplicates or concurrent writes
   abort atomically and retain recoverable source data. Revision
   `0030_directory_crypto_retirement` performs this guarded transaction after
   `0029_directory_crypto_additive`; it is never a startup operation.
6. **Resume gate:** verify installed schema, keys, authorization and actual
   configured-service readiness before ending outage. Synthetic tests do not
   establish managed readiness.

After retirement, populated downgrade refuses: plaintext recovery requires
separately approved coordinated backup/key recovery, not application-only rollback.
Review writes since backup and session/audit recovery consequences before restore.
Ciphertext rotation and index rekey are separate approved outages; authenticate all
rows, retain original keys, replace all index values atomically under final unique
constraints, restart every writer with the same key configuration, then verify.
Runtime readiness pins both the exact keyring/active-key configuration and index
key. Even adding an unused historical key changes the configuration proof and
blocks reads/writes until approved maintenance verification updates the anchor.
Do not update that anchor merely to bypass an error. A final-schema Directory
rotation operator tool is a separate change; the staging CLI only supports the
additive predecessor. Staff ciphertext/AAD and Staff rotation tools are unchanged
and remain Staff-only. Never retire keys needed by deleted rows or retained backups.

## Evidence and remaining verification

Required before completion: populated historical migrations and backfill restart/
corruption/lock/restore/stale-write/retirement tests, tamper/key/index/concurrency
tests, action-specific permission/revocation/log-redaction tests, reference/transfer/
search regression tests, API-contract regeneration/check, frontend transport/build
checks and one isolated authenticated browser pass over all changed flows.
Use scripts/test-api-foundation.sh and scripts/run-authenticated-previews.sh;
never use real values or a configured database as a test fixture.

Record exact commands and actual results here as checks run. Do not mark unrun
retirement, runtime, UI, managed migration or deployment checks as passed.

### Checks actually run

- `sh scripts/test-api-foundation.sh tests/test_directory_crypto.py tests/test_directory_staging.py tests/test_migration_directory_deletion.py`:
  **73 passed** before the recovery/deadline checks were added.
- `sh scripts/test-api-foundation.sh tests/test_directory_crypto.py tests/test_directory_staging.py tests/test_migration_directory_deletion.py tests/test_migration_staff_designation.py tests/test_staff_rotation.py tests/test_doctors.py tests/test_mrs.py tests/test_patients.py tests/test_patient_files.py tests/test_master_permissions.py tests/test_sales_targets.py tests/test_opening_balances.py`:
  **276 passed, 1 failed**. The failure was the new logging-refusal test:
  setting a level did not re-enable an Alembic-disabled logger. Corrected the
  test to enable logging explicitly; additionally guard engine-specific logging
  and engine echo. Do not report this broad command as a clean pass.
- `sh scripts/test-api-foundation.sh tests/test_directory_crypto.py tests/test_directory_staging.py` after that fix:
  **71 passed**, including actual isolated `pg_dump`/`pg_restore`, preserved
  source/owner/file/audit snapshots, interrupted batches, deadline rollback,
  stale approval/key configuration, write guards and SQL-logging refusal.
- `sh scripts/check-api-contract.sh`: **passed**, unchanged API contract.
- `node --test artifacts/evexia-portal/src/services/serverDoctors.test.js artifacts/evexia-portal/src/services/serverMRs.test.js artifacts/evexia-portal/src/services/serverPatients.test.js`:
  **6 passed**, unchanged transfer/transport compatibility.

The early results above predate runtime cutover; they are not final acceptance
evidence.

### Cutover verification results (isolated synthetic data)

No command below applied a migration to the managed, shared or production
database. Historical upgrades, backup restore and retirement used disposable
PostgreSQL clusters, synthetic identities, separate synthetic keys and private
runtime/maintenance roles.

```sh
sh scripts/test-api-foundation.sh \
  tests/test_directory_crypto.py tests/test_directory_staging.py \
  tests/test_directory_retirement.py tests/test_directory_runtime.py \
  tests/test_doctors.py tests/test_mrs.py tests/test_patients.py \
  tests/test_sales_targets.py tests/test_opening_balances.py \
  tests/test_patient_files.py tests/test_master_permissions.py \
  tests/test_staff.py tests/test_staff_search.py tests/test_staff_rotation.py \
  tests/test_migration_doctors.py tests/test_migration_mrs.py \
  tests/test_migration_patients.py tests/test_migration_directory_deletion.py \
  tests/test_migration_staff_designation.py tests/test_migration_sales_targets.py \
  --tb=short
```

Actual result: **329 passed, 1 failed in 249.37 seconds**. The failure was the
maximum MR export query budget, not a cryptographic or authorization failure.
The export now reuses one request-local bulk projection for matching and
serialization; it does not persist plaintext results or weaken the budget.

```sh
sh scripts/test-api-foundation.sh tests/test_migration_mrs.py \
  tests/test_migration_opening_balances.py tests/test_mrs.py --tb=short
```

Actual result after bulk-projection reuse: **52 passed, 1 failed**. The remaining
failure was the old created-time export ordering assumption. Assertions now
verify every exported field in stable UUID order and locate the manager sentinel
by its retained business identifier, not its old array position. The simulated
count/read race expects the shared complete-export limit rejection, rather than
the earlier table-specific pre-count rejection.

```sh
sh scripts/test-api-foundation.sh \
  tests/test_migration_mrs.py::test_maximum_exports_bulk_queries_exact_rows_caps_and_revocation \
  --tb=short
sh scripts/test-api-foundation.sh tests/test_migration_mr_designation.py --tb=short
node --test artifacts/evexia-portal/src/services/serverOpeningBalances.test.js
sh scripts/check-api-contract.sh
pnpm --filter @workspace/evexia-portal run build
```

Final focused results: **1 passed** (28 seconds), **4 passed**, **2 passed**,
API contract check passed, and portal build passed (5.97 seconds), respectively.
The 5,000-record CSV/XLSX export still enforces the original query, bind-count
and timing budgets, full field/audit parity, deleted-manager resolution,
over-limit rejection, count/read-race rejection and revoked-session denial.
The earlier designation migration test deliberately stops at its own revision;
the populated encryption upgrades are tested separately through the guarded
backfill/retirement procedure, never by bypassing approval.

The five directory/consumer transport suites were also run together:
`node --test` on `serverDoctors.test.js`, `serverMRs.test.js`,
`serverPatients.test.js`, `serverSalesTargets.test.js` and
`serverOpeningBalances.test.js`: **10 passed**. The later Opening Balance-only
rerun above additionally verifies that a missing cursor is omitted rather than
serialized as the invalid UUID string `null`.

Both managed development services restarted cleanly. This confirms process
startup, not managed schema migration, directory-key provisioning or rollout
approval. The published environment was not changed.
Known warnings: Starlette/httpx compatibility deprecation and Alembic
`path_separator` deprecation; these did not fail the passing checks.

### Authenticated browser evidence

The existing testing harness used isolated synthetic PostgreSQL and authenticated
Chromium actors. Failed or blocked scenarios were followed up narrowly; passing
scenarios were not run again for cosmetic changes. This is accumulated evidence,
not a claim that one uninterrupted full-suite command passed.

- Doctor/Patient filtered follow-up:
  `sh scripts/run-authenticated-previews.sh` with
  `doctors-backend.preview.spec.mjs`, `patients-backend.preview.spec.mjs` and
  `--grep=Doctor.*(all.fields|server.pagination|prepared)|Patient.*PIN`:
  **5 passed**. Earlier **4 passing** cases covered renewal/stale drafts and
  desktop/mobile persistence. The follow-up verified all-fields create/edit,
  explicit continuation, bulk/status actions, relationship labels,
  import-review/commit and CSV/XLSX downloads.
- MR isolated suite initially had **3 passed, 2 failed**. The compact filters/
  query isolation/keyboard/touch/export follow-up passed (**1 passed**), then
  `--grep=deleted.designation` passed (**1 passed**) after the typed rejected
  assignment remained retryable and the response waiter compared URL pathnames.
  Returned identity and replacement-designation assertions ran successfully.
- Sales Target isolated suite initially had **2 passed, 3 failed**.
  The two desktop/mobile CRUD, stale-edit and confirmed-action scenarios then
  passed (**2 passed**). The final prepared transfer follow-up:
  `sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/sales-targets-backend.preview.spec.mjs '--grep=prepared.CSV'`:
  **1 passed in 14.4 seconds**. It verified three-row CSV/XLSX review/import,
  section totals, continuation, returning to an earlier query without reviving
  an old cursor, financial filters, and authenticated CSV/XLSX exports containing
  **all three matching records despite only two displayed in the first section**.
- Opening Balance initial failures blocked the reference picker and old count
  assertions. After the missing cursor was omitted rather than sent as `null`,
  **5 passed** covered modal drafts, desktop/mobile persistence, stale edits/
  deletes, and transfer round trips. Both cold-route picker cases then passed
  (**2 passed**). The final
  `--grep=Doctor.*picker.pages.server.records` case passed
  (**1 passed in 7.9 seconds**): 51-record cursor continuation, UUID-ordered
  second-section selection, retry and late-response-on-logout protection.

The final Sales Target runner was deliberately stopped after its targeted
Playwright test passed, before the unrelated enlarged-text matrix. Its
termination notice is not a clean whole-harness exit and is not reported as one.
Firefox/WebKit and that unrelated layout matrix were not covered by these
focused runs.

`node --test artifacts/evexia-portal/src/hooks/directoryContinuationState.test.js`:
**2 passed**, covering permanent cursor reset across query/filter/actor/limit
changes. The final post-fix portal build passed (**6.22 seconds**); the web
workflow restarted cleanly. Public landing and synthetic authenticated
Doctor/MR, Patient, Sales Target and Opening Balance screenshots were inspected;
static screenshots are not evidence of exported file contents or cursor clicks.

### Offline staging commands (only after approval)

Run from artifacts/api-server/backend using the separately provisioned maintenance
login and managed secrets. The runtime role is a non-secret PostgreSQL role name.
UUIDs/digests below are non-secret approved references, not proof that backups exist.
Do not grant the API stage DML, table ownership, trigger-disable rights or
membership of the maintenance role. Retirement grants only stage SELECT to the
validated runtime login so readiness can verify nonsensitive proofs.

```sh
alembic upgrade 0029_directory_crypto_additive
# Dry-run, review exact plan and complete recovery rehearsal.
python -m app.services.directory_staging freeze --runtime-role "$API_DB_ROLE"
python -m app.services.directory_staging freeze --runtime-role "$API_DB_ROLE" \
  --execute --approval "$PLAN_HASH" --backup-ref "$BACKUP_UUID" \
  --change-ref "$CHANGE_UUID" --writes-paused --recovery-verified
# For production ONLY, separate explicit approval additionally needs:
# --production-approved (on freeze).

# Repeat one deliberate batch until remaining=0 for each table.
python -m app.services.directory_staging batch --table mr_directory --limit 500 --execute
python -m app.services.directory_staging batch --table doctor_directory --limit 500 --execute
python -m app.services.directory_staging batch --table patient_directory --limit 500 --execute
python -m app.services.directory_staging verify
# Separate approved retirement; checks all source/ciphertext/index/owner evidence
# again under the same exclusive locks as DDL. UUIDs must match frozen evidence.
alembic -x directory_retirement_approved=yes -x directory_recovery_verified=yes \
  -x directory_backup_ref="$BACKUP_UUID" -x directory_change_ref="$CHANGE_UUID" \
  upgrade 0030_directory_crypto_retirement
# Production additionally requires: -x directory_production_approved=yes
# Start only the coordinated final writers; verify /api/v1/health/readiness
# and action-specific authorized workflows before reopening requests.
```

The frozen baseline binds all original directory fields plus all Patient owner
fields and the exact key configuration in keyed digests. Full verification detects
operator-side changes to source fields/relationships/versions too. Results certify
only the current locked transaction, never subsequent writes. Encryption/index
columns are excluded from the source digest so restartable backfill can progress.
Adding/replacing any key during staging requires approved recovery/replanning,
not continuing with a different configuration.

No unfreeze exists in this stage: once frozen, leave requests/writers paused.
A failed/lost batch response can be followed by another bounded batch and full
verification. Before backfill, an untouched additive downgrade is allowed.
Frozen state or *any* staged ciphertext/index blocks downgrade. To abandon a
populated staged outage, restore the approved coordinated backup and matching
keys/configuration under the recovery procedure; never manually clear guards
or discard staged ciphertext. Read-only archive/dry-run output is nonsensitive
but still belongs in the restricted operator change record.
