# Staff Management: scope, configuration and operations

## Boundary

Only the protected system Super Admin has `staff.manage`. Business role labels,
including “Super Admin”, and designation labels grant no backend permissions.
Staff credentials reuse User/Argon2id but have no system role or User.email.
Login is disabled by default. Only an explicit `workspace_login_enabled` change
admits active staff through the existing workspace login, using their existing
User ID/password. A separately chosen custom role ID supplies only the forty
supported master grants, never broad administrator or generic domain/file powers.
Active status alone never enables login; inactive or disabled accounts cannot
authenticate or retain usable sessions. Business labels never become assignments.
Existing protected Super Admin/MR policy and session rotation remain unchanged.
Registered-account counts include staff; eligible enabled staff sessions count
in protected global reporting without granting staff access to those reports.
See [Zone role permissions](zone-role-permissions.md) for opt-in rollout.

Designation Master uses a separate protected server catalogue. Staff Management
loads up to 100 active server choices, fails explicitly above that bound and offers
retry on request failure without discarding drafts. Existing unavailable saved
labels remain selectable during edit. The server stores a bounded selected label
only, not a foreign-key or authorization relationship. No staff labels are rewritten.
See [Designation Master](designation-master.md). Legacy `evexia.admin.staff.v1` is never
read, changed, cleared or automatically migrated by Staff Management. Existing
data there can still be inspected by the browser owner but is not live directory
data. No sample rows are seeded, no local fallback exists.

## Operator-managed keys

Configure these in the backend's managed secret store, independently in each
environment. Do not paste keys in chat, logs, source, SQL or shell arguments.

- `STAFF_ENCRYPTION_KEYS`: secret JSON object mapping short key IDs (1–32 letters,
  digits, underscore or hyphen) to base64-encoded **independent cryptographically
  random 32-byte keys**. Retain every key ID needed by live or backed-up ciphertext.
- `STAFF_ENCRYPTION_KEY_ID`: active non-secret key ID, default `primary`.
- `STAFF_EMAIL_INDEX_KEY`: a separate random 32-byte key encoded as base64.
  This is not an encryption key or the JWT/session signing secret.

Generate keys using the approved secret manager's cryptographic generator
(256 bits), deliver directly into managed secrets, and restrict retrieval to
authorized operators. Never use examples from test harnesses, passphrases,
ordinary hashes, deterministic encryption or signing secrets as staff keys.
Secret configuration is optional for application startup so existing auth can
operate; staff requests fail closed with a fixed 503 when unavailable.

Encryption uses cryptography AESGCM (AES-256-GCM), fresh 96-bit nonces, and
associated data containing `evexia:staff:v1`, the profile UUID and field name.
Stored format is `v1:key-id:base64(nonce+ciphertext+authentication-tag)`.
The email blind index is HMAC-SHA256 over a domain-separated, trimmed/lowercased
email. The unique index rejects races. Operations validate the index key against
persisted encrypted email before proceeding; replacing the index key without
reindexing existing rows fails closed, rather than allowing duplicates.

## Migration and recovery

Migration `0009_staff` only adds an empty profile table, permits null User.email
under explicit deferred profile linkage, and enforces staff identity immutability.
Existing admin, MR, legacy User, session and audit rows remain unchanged.
Staff Users must have a username, null email and null system role; non-staff Users
must retain email. Normal-service writes cannot promote staff or rename their IDs.
No master or local staff data is implicitly imported.

Before an approved migration: pause writes, take and verify a database backup,
record the migration head, retain a separately access-controlled secret-manager
backup/key inventory, and verify restoration on an isolated copy. Review runtime
DB privileges (not table ownership/DDL authority). Then run the established
explicit Alembic/bootstrap initialization described in the backend README.
The API never runs DDL at startup. This task performs no shared/production
migration or deployment. Missing live migration/configuration produces a safe
unavailable state, not demo data.

Backups must preserve profile rows, User hashes and links, audit references,
schema version, encryption key IDs and the original index key together. Lost
encryption keys make ciphertext unrecoverable; there is no fallback/reset that
recovers PII. Stop staff writes on key errors/tampering; triage only opaque
request/profile IDs. Do not expose ciphertext/plaintext or exception/SQL parameters
in tickets or logs. Restore from a verified coordinated backup or use a reviewed
forward correction. Downgrade is refused when staff records exist.

### Operator-only rotation and recovery

The offline `app.services.staff_rotation` command is never called by startup,
an HTTP endpoint or normal Admin editing. Only an authorized operator with
database and managed-secret access may run it. Its flags record operator
attestations, not a substitute for approval through your change-control process.
No key is generated, removed or printed by the tool. Production execution
additionally requires `--production-approved`; this task performs no production
execution, migration or secret changes.

Both procedures below require a planned outage: pause **all** staff requests
and offline writers, drain in-flight transactions, and keep requests paused
through verification and configuration cutover. The dry-run takes a PostgreSQL
SHARE table lock (excluding writes); execution takes ACCESS EXCLUSIVE NOWAIT
(excluding reads and writes, including direct SQL). Lock contention fails closed
immediately: drain requests and rerun rather than repeatedly competing with them.
Do not run with SQL/parameter debug logging. Use a dedicated maintenance database
role; normal API database credentials must not be available to Admin users.

This implementation deliberately uses one all-row atomic transaction, **not**
partially committed batches. Budget memory and transaction duration on an isolated
production-sized restore before approval; an oversized directory requires a
separately reviewed maintenance design, not removing locks. Every name/email/phone
is authenticated with its original record/field AAD before any writes. All source
email indexes and staff credential links are checked. Each changed profile's
version increments, invalidating stale editor drafts; identity, credential hashes,
business metadata and last business editor/time stay unchanged. Replacement
ciphertext is decrypted immediately and the full stored inventory is rechecked
after flush, before commit.

Output contains only counts, key IDs, schema revision, keyed approval/content
digests and status. The approval digest binds database/schema location, the full
profile/credential snapshot (including versions), operation and key configuration.
Any intervening edit or key change requires a new dry-run and approval. Do not
log raw SQL, plaintext, ciphertext, passwords, hashes or key material. Successful
changes and their approval are audited atomically with opaque backup/change UUIDs
and the plan digest; they are explicitly operator events, not staff login events.
Keep the safe JSON output and change record in the restricted operations archive.

#### Coordinated backup prerequisite (both operations)

1. Pause/drain writers. Record environment/database identity, schema head and
   key IDs in an opaque backup inventory UUID. Take a **complete database**
   backup including profiles, Users, linkage, session/audit history and schema.
2. Back up the encryption keyring, active key ID and original email-index key
   separately in the access-controlled secret manager; include the staged target
   keys. Never put those secrets in the database backup, shell arguments or output.
3. Restore the database and keys into an isolated restricted environment with no
   outbound delivery or user access. Run the same dry-run there to authenticate
   every field and validate indexes. Compare `content_digest` with the original
   inventory using `--expected-content-digest`. Approval hashes differ across
   database/schema locations; content digests do not. Use the **same target
   encryption key ID** on both copies, including for an email-index rehearsal.
4. Rehearse forward execution and reverse rotation/restore on the isolated copy.
   Verify complete database restore with your backup system in addition to the
   tool's staff/credential-content check. Record the recovery evidence in the
   approved change UUID. `--recovery-verified` and `--backup-ref` attest this work;
   the tool does not create backups or claim an arbitrary UUID proves recovery.

Run from `artifacts/api-server/backend` with the existing backend environment.
All secret values are injected directly by the approved secret manager. The
variables shown below are **non-secret** opaque approval references/digests:

```sh
# Stage a NEW independent key under a new ID in STAFF_ENCRYPTION_KEYS.
# Keep every existing key. Do not reuse an old ID with different key material.
python -m app.services.staff_rotation encrypt --target-key-id next
# Review/save dry-run output, complete restore rehearsal, approve its exact hash.
python -m app.services.staff_rotation encrypt --target-key-id next \
  --execute --approval "$PLAN_HASH" --backup-ref "$BACKUP_UUID" \
  --operator-ref "$CHANGE_UUID" --writes-paused --recovery-verified
# Authenticate the committed state and match content before resuming requests.
python -m app.services.staff_rotation encrypt --target-key-id next \
  --expected-content-digest "$CONTENT_HASH"
```

For production only, add `--production-approved` to execution **after** separate
explicit production authorization. Select `STAFF_ENCRYPTION_KEY_ID=next` for
**every** API/writer instance before resuming; restart/drain all old instances.
The tool uses the specified target without changing runtime configuration.
Rerunning encryption against an already-complete target is a verified no-op
(no new versions or audit entries). It never removes the historical keys.

#### Separate atomic email-index rekey

Do not combine email-index rekey and ciphertext rotation in one change. Leave
`STAFF_EMAIL_INDEX_KEY` as the original key until execution and verification.
Stage a new independent 32-byte secret as `STAFF_EMAIL_INDEX_NEXT_KEY` in the
**offline operator environment only**; the API does not consume this secret.
The tool checks all source indexes, computes all replacement HMAC indexes,
rejects duplicates before writing, and retains the unique constraint throughout.
Even an old/new index cross-collision fails and rolls back atomically, never
temporarily allowing duplicates or using plaintext indexes.

```sh
python -m app.services.staff_rotation email-index
python -m app.services.staff_rotation email-index \
  --execute --approval "$INDEX_PLAN_HASH" --backup-ref "$BACKUP_UUID" \
  --operator-ref "$CHANGE_UUID" --writes-paused --recovery-verified
```

After commit, while staff requests remain paused, switch the original
`STAFF_EMAIL_INDEX_KEY` to the staged key in **all** runtime instances, restart/
drain them, and run `encrypt --target-key-id <current-active-id>` dry-run with
`--expected-content-digest "$CONTENT_HASH"` to validate the new index configuration.
Remove the staged secret from the offline environment only after evidence is
archived; retain the original index key in the coordinated backup inventory.
An old runtime key fails closed against the rekeyed rows. Empty-directory rekey
has no rows to anchor a key: configuration cutover before the first create is
still mandatory. Do not resume writes between commit and cutover.

#### Interruption, reverse rotation and retirement

On any failure or lost commit response, leave writers paused. Transactions
interrupted before commit roll back all rows and audit events; there is no
partially applied checkpoint to repair. Resume with a new dry-run after the
connection has ended. If encryption is already complete, a fresh approved
execution is a no-op. For email-index uncertainty, validate inventory with the
old configuration and then the staged configuration in isolated operator runs:
only the matching configuration succeeds for a nonempty directory. Never
blindly repeat an old approval after a possibly successful commit.

For a reviewed reverse ciphertext rotation, run a new dry-run targeting the
retained original key ID, obtain a **new** approval/backup and execute, then
select that key in all runtime instances. Versions increment again, never rewind
live versions. For reverse email rekey, use the current index key as source and
the retained original as the staged target, with a fresh plan, approval and
coordinated backup. Alternatively restore the **entire coordinated database and
matching keys/configuration** under outage and verify the saved content digest
on an isolated copy first; never restore just ciphertext, indexes or Users.
Account for writes since backup, lost audit history and stale sessions before
any approved full restore. There is no automatic live restore/reset.

Retirement is a separate explicitly approved operation, **not implemented by
this command**. The final `key_usage` must contain no live references to a
retiring key, and every retained backup, snapshot, legal hold, replica and
disaster-recovery copy must either remain paired with that key or have expired
under the approved retention policy. Inventory and restore-test those copies
before removal; retain keys throughout rollback/retention windows. Missing keys,
unknown versions, AAD substitutions, wrong indexes or unverifiable backups
block execution. There is no key-loss recovery or silent fallback.

## Administrator workflow

Add and Edit share the existing fields/country-phone control and designation
selector. Add leaves User ID empty until the server successfully saves. Usernames
are random `st_` identifiers within the existing 32-character DB limit; collisions
are retried with new random values. Create saves the User hash, encrypted profile
and attributed audit event in one transaction.

On successful Add, hand off the masked/revealable/copyable one-time User ID and
initial password manually through an approved private channel. It is **not a
usable staff login until explicitly enabled**. Dismissal, navigation, reload or session loss
clears the display; do not rely on retrieving it later. Copying places secrets on
the system clipboard, outside application control; clear it after handoff. There
is no later retrieval/reset/rotation UI and ordinary edits never change passwords.

On an uncertain create result, do not repeat the submission: cancel and refresh
the directory to inspect whether it committed. A committed but lost response
cannot recover the password; review with an operator and wait for a separately
approved recovery feature. The UI disables repeat saves after ambiguous failures.
Safe retryable errors keep the draft. Edit/status requires the original version;
409 stale responses never silently merge or overwrite. Inspect current details,
then cancel/reopen deliberately if an updated edit is needed.

Lists/detail operations are authorized and no-store. Paging uses bounded
100-record server batches, with local table pages/search within the current batch;
refresh and opening Edit fetch current DB data. Export is explicitly limited to
authorized displayed batch records, uses an allowlist and spreadsheet-formula
protection, and omits passwords/hashes/internal credential and actor UUIDs.
Downloads leave application protection and require safe handling.

No invitation send/queue/delivery preview, SMTP/provider, bulk provisioning/import,
password recovery or hard deletion exists. Workspace access changes are explicit
and independent of business-label edits, never regenerate credentials, and
require the current directory version. Role removal denies granted master access on the
next protected request; disable and inactivation additionally revoke sessions.
Other browser-local masters remain unchanged. No VAPT certification is claimed.

## Verification

### Directory-wide search privacy and resource review

`POST /api/v1/admin/staff/search` accepts a 2–200-character term in the JSON
body, never in a URL. The same protected Super Admin permission and locked
session revalidation apply on every continuation. No query or match is written
to audit history, browser storage, database tables, caches or logs. Responses
and the dedicated authenticated browser transport are no-store. Generated query
hooks are not used here, since query caches would retain plaintext results.
The existing keyed email uniqueness index is unchanged; no additional search
indexes, plaintext or deterministic substring tokens are introduced.

The selected approach decrypts only in authorized request memory. A primary-key
keyset scan fetches at most 501 profiles (one lookahead) with joined usernames,
decrypts at most 500, and returns at most 100 matches per request. It does not
count all matches, use deep offsets or silently loop through the whole directory.
Users explicitly continue even after a section with zero matches. A UUID cursor
contains no search term or personal fields; it is a position, not authorization.
All non-result objects are discarded at the request boundary. The existing
transaction also applies a two-second per-statement timeout and a one-second lock
wait timeout, both transaction-local. The authorization check additionally verifies one stored email against the configured
uniqueness key; missing, wrong or corrupt keys/ciphertext fail closed, including
when a failing row would not match. No partial success is returned on failure.

Tradeoff: an authorized administrator sees section sizes, match counts, record
positions and timing. Encryption at rest does not conceal this access pattern
from the server/operator, nor personal fields from an authorized browser.
Per-request work is bounded, but repeated deliberate requests can traverse the
directory; it is not constant-time or a global abuse-rate guarantee. Adding a
distributed search rate/concurrency policy would require a separate operational
decision. The existing admin lock serializes same-actor search transactions.
Searching is case-insensitive literal substring matching, including local phone
digits and the non-secret business labels/date/status. No wildcard syntax is used.

Results are UUID-ordered, not creation-ordered, and are not a database snapshot.
Concurrent changes can move membership between sections; refresh/restart is the
explicit freshness path. Previous-section navigation stores only cursor/progress
in page memory, refetching rather than caching results. Changing the search term
starts from the beginning. Exports and the retained table filter cover only the
loaded search section. Legacy local records, credential retrieval and optimistic
write/version semantics are unchanged.

`pnpm run test:api-foundation` uses private ephemeral PostgreSQL, never a configured
shared database. Staff tests cover forward migrations, encrypted fields, credential
hashes, missing/wrong keys, field/record substitution, rollback, uniqueness races,
stale status/edit versions, permission and identity linkage protections.
`tests/test_staff_rotation.py` additionally exercises operator approval,
full-inventory authentication, stale plans, missing historical keys, transaction
interruption/rollback, idempotent resumption, exclusive database locking, separate
atomic index rekey, duplicate rejection and coordinated recovery verification.
`pnpm run validate:release` includes staff service/session checks and the
authenticated staff browser spec in the isolated synthetic API/Vite harness.
Test keys and bootstrap credentials are synthetic and must never be used outside
that temporary fixture. FastAPI remains authoritative; run
`python3 scripts/export-api-contract.py` then
`pnpm --filter @workspace/api-spec run codegen` for contract changes.
