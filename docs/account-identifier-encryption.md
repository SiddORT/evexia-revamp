# Ciphertext-only authentication identifiers

## Approved scope and release boundary

Task 02 includes `users.email`, `users.username`, and the dependent historical
`account_identifier_reservations` storage/triggers. No public registration or
forgot-password feature is enabled. No existing accounts need deleting.

`0035_account_identifiers` follows `0034_shared_phone_countries` and is
**operator_only**. Normal CI must stop with exit 42 before release promotion.
The matching application requires revision 0035 and a valid account crypto
anchor. Never run the new application against an older account schema.

## Storage and keys

The original email/username/identifier column names now contain AES-GCM
ciphertext, not plaintext. Keyed normalized email/username indexes and the
reservation primary key share an account-specific login namespace. Encryption
AAD binds owner UUID and identifier field. Neither encryption nor index keys
are stored in the database. Equality/frequency and reference metadata remain
visible to database readers. Authorized API responses remain plaintext.

Reuse the existing `DIRECTORY_ENCRYPTION_KEYS`, `DIRECTORY_ENCRYPTION_KEY_ID`,
and `DIRECTORY_INDEX_KEY`, with **different account AAD and HMAC domains**.
Keep all key IDs needed by accounts, reservations, directories, and backups.
Existing directory-only rotation does not rekey accounts or reservation history;
do not remove old keys merely because directory rotation completed.

## Production operator procedure — not executed by this task

1. Confirm the intended database/host independently and the exact predecessor
   revision 0034. Review dependent external consumers. Do not infer approval from
   an empty database or from its connection URL.
2. Acquire the existing deployment lock, create the durable maintenance marker,
   stop and drain **all** writers, including jobs and direct SQL consumers.
   Retain lock/drain and external-consumer evidence.
3. Create a full, restricted, durable PostgreSQL backup outside the repository
   and container filesystem. Compute its SHA-256. Independently restore it in
   an isolated rehearsal environment and verify schema, accounts, historical
   identifiers, sessions, credentials, audit and other business records.
   A matching checksum is **not** proof of successful restoration.
4. Supply the reviewed external backup directory to the existing operator
   tooling container. The file and parent must be operator-owned, private
   (0600/0700); no symlinks. Preserve encryption keys independently of the dump.
5. Invoke Alembic with a **fixed** target and explicit, human-reviewed gates:

   ```sh
   uv run --project /workspace alembic \
     -x account_crypto_approved=yes \
     -x account_writers_stopped=yes \
     -x account_backup_durable=yes \
     -x account_restoration_rehearsal=yes \
     -x account_external_consumers_reviewed=yes \
     -x account_expected_database=INDEPENDENTLY_APPROVED_DATABASE_NAME \
     -x account_expected_system_identifier=INDEPENDENTLY_APPROVED_CLUSTER_IDENTIFIER \
     -x account_backup=/restricted/operator/accounts/full-backup.dump \
     -x account_backup_sha256=REVIEWED_BACKUP_SHA256 \
     upgrade 0035_account_identifiers
   ```

   Run inside the reviewed maintenance tooling environment with the backend's
   Alembic working directory, production environment and explicit recovery bind
   mount. These arguments are not supplied by CI or the retirement wrapper.
   The rehearsal flag is an explicit operator attestation; retain the actual
   independent rehearsal report, logs and comparison evidence separately.

6. Verify exact revision 0035, readiness, encrypted user/history columns, both
   login forms, provisioning, history collision rejection, refresh/revocation,
   permissions and reporting. Only then promote the matching application and
   remove maintenance under the lock. Bootstrap is idempotent: the existing
   protected Super Admin UUID/password/roles remain unchanged.

## Migration safeguards and recovery

An exclusive NOWAIT lock covers account/history and linked identity/session
tables throughout the transaction. Preflight rejects invalid identifiers,
normalization differences, duplicate cross-column identifiers, missing history,
conflicting history ownership and invalid protected identities. Reports contain
only UUIDs/problem codes, not identifiers or credentials. No repair, guessing,
reassignment or deletion is performed.

Encryption is staged into shadow columns and decrypted back against every
original and every persisted copy **before** plaintext columns are retired.
All DDL/data/trigger changes commit together. A failure rolls back to the
original schema, identifiers and revision; keep writers stopped and maintenance
present until the cause is reviewed. PostgreSQL retains old values in WAL,
backups and possibly dead tuples: this release does not erase old backup/media.

Automatic downgrade to plaintext is refused, even for test environments.
After commit, use a reviewed forward correction or restore the full verified
backup with its matching previous application and keys. Never use stamp,
fake approvals, test settings or an unqualified upgrade-head operator command.
