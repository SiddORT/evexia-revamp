# Private storage feature contract

Private PDF preparation and local grant redemption require durable metadata-only
download-log acceptance before stream release. S3 PDF capability issuance is
logged as issuance, not delivery. Logging failure closes the prepared spool and
releases the transfer lease without sending a file. Accepted preparation remains
history if a later stream/handoff fails. See `docs/download-logs.md` for privacy,
retry keys, rollout and release coverage.

This contract supersedes organizational authorization for the new foundation.
Historical organizations/memberships are retained, not migrated to privileges.
No tenant identifiers, folder scope, or portal/demo import is introduced.

## Identity and permissions

Login uses the existing User, Argon2id, fixed-algorithm JWT and rotating hashed
refresh-session foundation. Explicitly provisioned `super_admin`/`mr` identities
and opt-in active StaffProfile-linked workspace identities may authenticate.
Staff have no system role; custom role labels are never identities and staff
cannot access private files or domain administration. Legacy/unmapped users and old credentials
are denied. Mapping or privilege/activation changes bump the identity version
and revoke refresh sessions. Public registration remains unavailable regardless
of its old setting. Bootstrap/mapping is an audited operator command with hidden
password input; there is no default elevated account.

| Action | Super Admin | Active MR |
|---|---|---|
| Provision/map login and MR; create patient; assign patient | yes | no |
| Staff list/detail/create/edit/status (`staff.manage`) | protected singleton only | no |
| Zone list/detail/create/edit/status/soft-delete/import/export | all; opt-in staff limited to five explicit Zone grants | no |
| Courier Partner list/detail/create/edit/status/soft-delete/import/export (`admin.access`) | protected singleton only | no |
| Storage Location list/detail/create/edit/status/soft-delete/import/export (`admin.access`) | protected singleton only | no |
| Designation list/detail/create/edit/status/soft-delete/import/export/sample (`admin.access`) | protected singleton only; Zone staff grants do not apply | no |
| Headquarter list/detail/create/edit/status/soft-delete/import/export/sample (`admin.access`) | protected singleton only; Zone staff grants and business labels do not apply | no |
| Product Category list/detail/create/edit/status/soft-delete/import/export/sample (`admin.access`) | protected singleton only; no Zone/custom-role elevation | no |
| MR business directory list/detail/edit/status/contact/soft-delete/reference/PIN/export/sample (`admin.access`) | protected singleton only | no |
| MR account create/import/reset/generate username (`admin.access` AND `domain.provision`) | protected singleton only | no |
| Upload, metadata, verified download, download grant | system-wide | own MR or currently assigned active patient |
| Delete, replace, retry verification/cleanup | yes | no |

Permission-to-role mapping is separate from object ownership. A patient has
at most one assigned MR. An MR profile belongs to one login. Reassignment
changes database authorization, never keys. Authorization is repeated after
slow I/O and on every local grant redemption. Denials must occur before adapter
calls. MR/profile deactivation and user version checks also apply.

Staff uses the same User credential store but is intentionally unmapped and
ineligible for login. Only explicitly linked staff or directory-backed MR Users can omit email;
staff email exists only as AES-GCM ciphertext in the profile, with a unique
HMAC-SHA256 blind index. Name/phone ciphertext uses randomized nonces and
record/field/version binding. Business roles/designations never affect
authorization. Directory status does not enable login.
All staff mutations are atomic and stale-version checked; passwords are
generated server-side, Argon2id-hashed and returned once on create only.
No hard-delete, import, invitation, staff sign-in, password reset or rotation API
exists. Legacy browser-local staff storage is untouched/unused; Designation
Master offers bounded active server choices, but saved staff labels remain
business metadata, not foreign-key or authorization relationships.
See `docs/staff-security.md` for key retention and coordinated backup/recovery.

MR Master is a one-to-one business extension of MRProfile, not an automatic
promotion of identity-only profiles. Enrollment atomically creates fresh User,
MRProfile and directory rows. Patient/file history and browser-local MR consumers
remain separate. Status/deletion coordinate identity versions and session revocation;
all previous account identifiers remain reserved, including tombstones. Labels,
Zone grants and arbitrary account links confer no MR identity.
See `docs/mr-master.md` for rollout, resources, transfers and one-time secrets.

Zone Master uses server-owned UTC audit times and User actor references, immutable
creation metadata, mandatory expected versions and non-deleted lower-name
uniqueness including inactive rows. Deletion retains a database tombstone and
deleter metadata; no normal lookup/export exposes deleted rows. CSV/XLSX imports
are explicit, bounded review/confirm, create-only and transactional. Imported
audit strings are ignored. Legacy local-zone demo relationships remain untouched.
See `docs/zone-master.md` for exact schemas, limits and failure recovery.

Courier Partner Master is separate shared persistence with server-owned UTC audit
times, User actor references, mandatory expected versions and partial normalized
name uniqueness including inactive rows. Soft deletion preserves the row and
deleter while excluding it from ordinary reads/exports. Imports are explicit,
identity-bound review/confirm, bounded, create-only and transactional; incoming
audit attribution is ignored. Local courier records remain untouched and unused.
See `docs/courier-partner-master.md` for transfer limits and operations.

Storage Location Master is a distinct shared name/address/status resource, not
private uploaded-file storage or a Zone. It uses server-owned UTC times, User
actor references, required expected versions, non-deleted normalized-name
uniqueness and retained soft-deletion evidence. CSV/XLSX imports are explicit,
identity/session-bound, create-only and atomic; imported audit values are ignored.
Allergen/PO/PR keep their separate browser-local location records and IDs.
See `docs/storage-location-master.md` for exact schemas, limits and recovery.

Designation Master uses separate shared persistence, exact `NUMERIC(11,2)` values,
server-owned User/UTC audit details, expected versions and normalized live-name
uniqueness including inactive rows. Tombstones preserve deletion attribution.
The protected singleton alone can use CRUD, identity/session-bound atomic CSV/XLSX
imports, samples and full-filter exports. Transfers require durable download
acceptance. No local data or staff labels are migrated; see
`docs/designation-master.md` for exact ten/fourteen-column schemas and bounds.

## File API and validation

Product Category Master uses exact `NUMERIC(18,6)` persistence/string transport,
server-owned User/UTC audit evidence, live-name uniqueness, expected versions,
retained soft deletion and bounded identity/session-bound atomic CSV/XLSX imports.
Price bounds/search/status share predicates with full-filter exports. Allergen and
procurement keep untouched separate local category IDs. Transfers require durable
download acceptance. See `docs/product-category-master.md`.

Headquarter Master is a separate name/code/status catalogue with live-name
uniqueness, User/UTC audit metadata, expected versions and retained deletion
evidence. Code defaults abbreviate the HQ name, never geographic lookup;
manual overrides and saved edit codes persist. Identity/session-bound
create-only atomic CSV/XLSX transfers ignore incoming audit attribution and
require durable download acceptance. Legacy local records/drafts are untouched
and unused. See `docs/headquarter-master.md` for deterministic Unicode generation,
transfer schemas, resource bounds and approved-operator-only rollout.

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