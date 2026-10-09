# Directory encryption: inventory and coordinated rollout

## Status and approval boundary

This is a staged implementation, **not an encrypted-directory rollout**. The
current API still uses legacy plaintext columns. The additive schema and offline
crypto/backfill support do not authorize a cutover or plaintext retirement.
Do not deploy this stage as evidence that directory PII is encrypted at rest.
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

Only required equality indexes are planned:

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

Runtime persistence/projections, search/continuation UI, consumer cutover and
plaintext retirement are **not yet implemented**. No current workflow reads the
additive ciphertext columns and no automatic plaintext/ciphertext dual writer is
introduced. Do not start a maintenance outage until the coordinated cutover build
and all tests below are available.

## Planned search/resource contract

Authenticated JSON-body search avoids personal terms in request URLs. Each request
must freshly revalidate the existing consuming action, including continuations and
downloads. Scan at most 500 directory candidates (one extra lookahead), return at
most 100 matches, with bounded batch reference reads and per-statement/lock
timeouts. Match literal case-insensitive substrings on exactly the previously
searchable fields, including linked names and business identifiers. Do not decrypt
an unbounded linked directory merely to filter another bounded scan.

UUID keyset continuation contains position only and is not authorization. Orders
are operational UUID order rather than plaintext name order; hydrate saved choices
separately under the consuming permission. No snapshot is promised across edits.
The UI must show partial section scope, scanned counts and explicit continuation,
including a section with zero matches. Never silently traverse every page or
display complete match totals. Export must use the identical section scope or a
separately bounded complete-match plan that rejects incomplete scans explicitly;
never claim a section export is a complete filtered export. No persisted plaintext
results, browser-local mirror, cache/session or per-row queries.

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
   may return. The current stage has no cutover command.
5. **Retirement gate:** separate explicit operator approval and verified recovery.
   Under exclusion, reverify *all* sources, ciphertext, indexes and graph metadata
   in the same transaction as retirement. Replace plaintext checks with validated
   server rules and final nullability/index constraints; ciphertext nonemptiness
   never proves required phone/email/GST. Drop old columns and indexes only then.
   Missing keys, corrupt data, stale verification, duplicates or concurrent writes
   abort atomically and retain recoverable source data. The current stage has no
   retirement migration/command.
6. **Resume gate:** verify installed schema, keys, authorization and actual
   configured-service readiness before ending outage. Synthetic tests do not
   establish managed readiness.

After retirement, populated downgrade must refuse: plaintext recovery requires
separately approved coordinated backup/key recovery, not application-only rollback.
Review writes since backup and session/audit recovery consequences before restore.
Ciphertext rotation and index rekey are separate approved outages; authenticate all
rows, retain original keys, replace all index values atomically under final unique
constraints, restart every writer with the same key configuration, then verify.
Staff rotation tools remain Staff-only.

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

These are isolated synthetic foundation/staging regressions, not encrypted
runtime or managed migration evidence. No new search/projection/UI/retirement
workflow exists to verify yet. No full release gate, authenticated encryption
browser pass, final retirement test or production migration/deployment was run.
Known warnings: Starlette/httpx compatibility deprecation and Alembic
`path_separator` deprecation; these did not fail the passing checks.

### Offline staging commands (only after approval)

Run from artifacts/api-server/backend using the separately provisioned maintenance
login and managed secrets. The runtime role is a non-secret PostgreSQL role name.
UUIDs/digests below are non-secret approved references, not proof that backups exist.
Do not grant the API access to directory_crypto_stage, table ownership, trigger
disable rights or membership of the maintenance role.

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
