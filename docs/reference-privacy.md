# Saved assignments and Vendor privacy

## Boundary

`0036_reference_privacy` follows `0035_account_identifiers`. It is
**operator-only**, not an automatic deployment migration. No existing
migration or organization/account recovery requirement is relaxed.

- Allergen retains category/storage IDs and saves `category_name` and
  `storage_location_name`.
- MR retains HQ/zone/manager IDs and saves `hq_name`, `zone_name`, and encrypted
  `reporting_manager_name_ciphertext`. No manager means NULL ID and NULL ciphertext.
- Vendor stores only ciphertext for registeredAddress, contactPersonName,
  emailId, phoneNo and dialCountry. Company name and GST remain deliberately
  plaintext with their existing live uniqueness indexes.

Directory AES-GCM uses randomized envelopes, versioned keys and table/record/field
AAD. There are no Vendor sensitive equality indexes or persistent plaintext caches.
The existing MR name index is unchanged. Directory rotation includes Vendor and
manager snapshots only at the explicitly reviewed 0036 revision; historical
staging/retirement/phone inventories remain unchanged. Existing account keys
must remain available for old account ciphertext.

Saved labels change only when the associated reference ID changes. Current
reference status/availability and permission decisions still use authoritative
IDs/current masters. Allergen/MR search and exports use saved assignment labels.
MR exports add an informational `Reporting Manager Name`; imports accept old
formats, ignore that informational field, and resolve/capture assignments on
the server. Exports with names that no longer resolve to current masters require
explicit import review/reassignment; imports never guess or silently substitute.

Vendor search decrypts only in authorized request memory. It scans at most
10,000 status-matching candidates and returns a complete count/page or an explicit
409; it never pretends a partial scan is complete. Exports include every match
up to the existing 5,000-record limit or reject. Company/GST SQL indexes and
international-phone legacy validation are preserved.

Browser-local procurement copies and downloaded CSV/XLSX are **not encrypted by
this server migration**. Authorized API responses/exports contain decrypted
personal data. Audit events retain metadata only; request/SQL plaintext logging
must remain disabled. This is not a claim of whole-product encryption.

## Populated operator rollout (not executed as part of source implementation)

1. Independently confirm the intended database name, PostgreSQL system identifier
   and sole revision `0035_account_identifiers`. Use the existing approved
   retirement/phone/account sequence first if behind; this procedure grants no
   permission to cross those earlier protected boundaries.
2. Retain a durable full database backup, privately owned mode 0600 in restricted
   operator storage. Independently restore those exact bytes to an isolated
   database and retain successful comparison evidence. SHA-256 alone proves
   integrity, **not** successful restoration. Independently retain all active
   and historical directory/account encryption keys, index keys and relevant
   signing/session configuration; do not rotate or replace them for this rollout.
3. Review external consumers and retention/recovery requirements. Pause and drain
   every application/background/admin writer and retain evidence. Hold the existing
   deployment maintenance interlock for the entire upgrade and verification;
   resume writers only after success or reviewed recovery. The migration takes
   NOWAIT exclusive locks on all affected/reference tables and refuses unavailable
   keys, wrong targets, unexpected sensitive dependencies/triggers, invalid Vendor
   values, missing/unreadable references and a frozen directory-rotation state.
4. In the candidate backend's configured runtime environment, supply the actual
   verified values below. These are placeholders, not default/fabricated evidence:

```sh
alembic \
  -x reference_privacy_approved=yes \
  -x reference_privacy_writers_stopped=yes \
  -x reference_privacy_backup_durable=yes \
  -x reference_privacy_restoration_rehearsal=yes \
  -x reference_privacy_external_consumers_reviewed=yes \
  -x reference_privacy_expected_database="$VERIFIED_DATABASE_NAME" \
  -x reference_privacy_expected_system_identifier="$VERIFIED_CLUSTER_ID" \
  -x reference_privacy_backup="$RESTRICTED_DURABLE_BACKUP" \
  -x reference_privacy_backup_sha256="$VERIFIED_BACKUP_SHA256" \
  upgrade 0036_reference_privacy
```

The tooling process must access the actual external backup through the existing
restricted operator-tooling bind-mount procedure. Do not change production Compose,
Nginx, `.env`, or ordinary deployment scripts to bypass recovery verification.
The guard reuses the existing strict account-migration target/file verifier,
but maps **only this revision's explicit approvals**, never grants earlier
retirement/account permissions automatically.

5. Verify sole revision 0036, unchanged row counts/IDs/versions/timestamps/actors,
   retained reference IDs, required snapshots including deleted rows, null-manager
   consistency, absence of the five Vendor plaintext columns, and successful
   authorized decryption/readiness/CRUD/transfer checks. Then allow normal policy
   CI to evaluate the completed path and resume the reviewed release.

## Backfill and failure/recovery

Existing snapshots use the **migration-time current names**, including soft-deleted
records. They do not reconstruct historic labels. Original rows, IDs, metadata,
versions, password hashes, grants and sessions are not reassigned or reset.
All ciphertext is round-trip authenticated and compared before plaintext columns
are removed. Unnormalized/invalid historical Vendor values block the upgrade
rather than being silently normalized.

DDL/backfill/revision update are transactional. Failure rolls back the attempted
036 conversion; leave maintenance/writer exclusion in place and investigate.
Earlier separately committed migrations are not undone by failure here.
Do not rerun with fake approvals or bypass settings.

Automatic populated downgrade is deliberately refused: recreating a plaintext
schema is not data recovery. Restore the independent full backup and reviewed
previous release with retained keys under an approved recovery procedure.
An empty disposable schema can downgrade/re-upgrade for compatibility testing.

Fresh installation uses the existing all-business-tables-empty,
independently target-bound `app.fresh_install finalize` procedure. It may advance
an empty 0034/0035 schema to 0036 before creating the Super Admin. It refuses
existing records; it is not a shortcut for this populated rollout.
