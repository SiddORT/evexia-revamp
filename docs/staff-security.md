# Staff Management: scope, configuration and operations

## Boundary

Only the protected system Super Admin has `staff.manage`. Business role labels,
including “Super Admin”, and designation labels grant no backend permissions.
Staff credentials reuse User/Argon2id but have no system role, no User.email and
no login eligibility. Directory active/inactive is metadata, not login access.
Existing Super Admin/MR login, refresh, revocation and reporting are unchanged.
Registered-account counts include new staff Users; active-session counts do not.

Designation Master remains browser-local. The existing selector supplies a
bounded selected label only; the server does not verify a catalogue, import one
or treat the label as authorization. Legacy `evexia.admin.staff.v1` is never
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

### Future rotation

The versioned keyring can decrypt old ciphertext while a new independent key ID
is active for new writes. Retain old keys until every applicable live row and
backup is accounted for. A bulk re-encryption/rotation command is not implemented:
plan a paused-write or version-checked audited procedure with integrity verification
and rollback before removal of any key. The stable email index key requires a
separate all-row atomic reindex plan under paused staff writes, duplicate checks,
backup recovery compatibility and explicit approval; simply changing it is unsafe.

## Administrator workflow

Add and Edit share the existing fields/country-phone control and designation
selector. Add leaves User ID empty until the server successfully saves. Usernames
are random `st_` identifiers within the existing 32-character DB limit; collisions
are retried with new random values. Create saves the User hash, encrypted profile
and attributed audit event in one transaction.

On successful Add, hand off the masked/revealable/copyable one-time User ID and
initial password manually through an approved private channel. It is **not a
usable staff login in this phase**. Dismissal, navigation, reload or session loss
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

No invitation send/queue/delivery preview, SMTP/provider, staff sign-in, permission
assignment, bulk provisioning/import, password recovery or hard deletion exists.
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
`pnpm run validate:release` includes staff service/session checks and the
authenticated staff browser spec in the isolated synthetic API/Vite harness.
Test keys and bootstrap credentials are synthetic and must never be used outside
that temporary fixture. FastAPI remains authoritative; run
`python3 scripts/export-api-contract.py` then
`pnpm --filter @workspace/api-spec run codegen` for contract changes.
