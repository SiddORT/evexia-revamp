# Private storage feature contract

This contract supersedes organizational authorization for the new foundation.
Historical organizations/memberships are retained, not migrated to privileges.
No tenant identifiers, folder scope, or portal/demo import is introduced.

## Identity and permissions

Login uses the existing User, Argon2id, fixed-algorithm JWT and rotating hashed
refresh-session foundation. Only explicitly provisioned `super_admin` and `mr`
system identities may authenticate. Legacy/unmapped users and old credentials
are denied. Mapping or privilege/activation changes bump the identity version
and revoke refresh sessions. Public registration remains unavailable regardless
of its old setting. Bootstrap/mapping is an audited operator command with hidden
password input; there is no default elevated account.

| Action | Super Admin | Active MR |
|---|---|---|
| Provision/map login and MR; create patient; assign patient | yes | no |
| Upload, metadata, verified download, download grant | system-wide | own MR or currently assigned active patient |
| Delete, replace, retry verification/cleanup | yes | no |

Permission-to-role mapping is separate from object ownership. A patient has
at most one assigned MR. An MR profile belongs to one login. Reassignment
changes database authorization, never keys. Authorization is repeated after
slow I/O and on every local grant redemption. Denials must occur before adapter
calls. MR/profile deactivation and user version checks also apply.

## File API and validation

Only `profile` and `documents`; only JPEG (`jpg`/`jpeg`), PNG, and PDF.
Profile permits images only. Uploads use a raw streamed request body, explicit
owner UUID/category and bounded safe original filename query fields; no multipart,
archives, arbitrary keys/paths, remote imports, direct upload grants or bulk API.
Unknown fields are rejected. All identifiers are UUIDs.

Generated immutable keys: `patients/{uuid}/{category}/{file_uuid}.{extension}`
or `mrs/{uuid}/{category}/{file_uuid}.{extension}`. Original names are display
metadata only and never a path. Metadata responses omit keys, paths and provider
details. Downloads are attachment-only, no-store, nosniff, with a fixed safe name.
Actual bytes and checksum are authoritative; Content-Length alone is not trusted.
Signatures, claimed MIME, extension, bounded parsing and independent trusted
malware scanning must all pass. Missing, timeout or error scanner results do not
make content readable. Test clean scanners are dependency injections, not settings.

Endpoints are under `/api/v1`: `/domain` for minimal privileged provisioning
and assignments, `/files` upload, `/files/{id}` metadata/delete,
`/files/{id}/replacement`, `/files/{id}/download`, `/files/{id}/download-url`,
`/files/grants/{token}` redemption, and protected retry/reconciliation commands.
FastAPI schemas are authoritative; exported shared contract/client code is derived.

## Lifecycle and concurrency

`uploading -> quarantined -> verified` only after complete object write, format
verification, clean malware result, and final identity/ownership/version checks.
Invalid content becomes `rejected`; unavailable scanning remains `quarantined`.
`pending_delete` is inaccessible before object deletion; deletion is idempotent.
Storage failures return explicit errors and retain recoverable rows.
`deleted` is a tombstone. Metadata never claims unreadable data is verified.

Replacement creates a new immutable file; old verified content remains until
the replacement verifies. The new file is published and the old row marked
pending_delete in one short transaction, with explicit cleanup afterward.
Failed scanning never removes the original. Concurrent replacements use version
checks; interrupted uploads and pending deletes have privileged reconciliation.

Transactions are short, with lock order identity -> owner -> file(s). Patient
assignment uses the same owner lock as publication. No row locks are held during
storage/parser/scanner I/O. Per-file advisory operation locks prevent concurrent
recovery from racing active object writes; bounded operation slots and persisted
rate limits prevent resource abuse. Slow download streams keep bounded slots
until closed, but hold no row transaction locks.

## Grants and failure boundaries

Local grants contain no path/key, have bounded expiry and identity/version
binding, and are reauthorized against live database state on redemption.
S3 presigning uses the identical authorization/state gate and bounded expiry.
S3 URLs remain bearer capabilities until expiry: reassignment/deletion cannot
guarantee immediate revocation. Do not log credentials or signed URLs.

Object and PostgreSQL transactions are independent. Operators must reconcile
interrupted writes, scanner outages and pending cleanup before retention expiry.
Adapter checksums are SHA-256, never inferred from S3 ETag. Local storage is
private, explicitly configured and not statically mounted. Selecting a provider
never silently falls back to another backend.

## Abuse cases and verification

Super Admin session/audit reporting is read-only and permission-gated by
`admin.access`, not by requested user IDs or browser role labels. Counts describe
persisted backend accounts and distinct currently valid session owners, not
browser-local records or online presence. Histories preserve missing/unattributed
actors with outer joins and expose only bounded safe projections, never refresh
credential history or arbitrary metadata. UTC timestamp ranges are half-open;
the UI's inclusive end day maps to the following midnight. Reporting queries
must not change lifecycle state or infer unrecorded activity. Existing owner-only
session APIs retain their scope.

Cover invalid/expired/wrong issuer/audience/algorithm/version tokens, unmapped
legacy accounts, function-level privilege escalation, guessed file IDs,
reassignment during slow I/O, stale replacement versions, actual-byte overflow,
unsafe filenames, type mismatch, parser/decompression bombs, scanner outage,
symlink/traversal races, adapter/commit failures, interrupted cleanup, denied
adapter-call assertions, grant expiry and response/log secrecy. PostgreSQL tests
use isolated schemas, and concurrency tests independent committed connections.