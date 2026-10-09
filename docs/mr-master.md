# MR Master: identity, rollout and transfer contract

## Designation identity rollout

Forward `0027_mr_designation_identity` follows the single reconciled
`0026_designation_target` head. It replaces required text `designation` with
required UUID `designation_id` and a RESTRICT foreign key to `designations.id`.
The reduced designation catalogue contract stays unchanged. This does not grant
permissions, provision accounts, rewrite Staff text or touch browser-local data.

With writes stopped, take a verified coordinated database/audit backup and run
preflight on a disposable restore before separately approved managed rollout.
Every historical MR (active, inactive and deleted) must match exactly one catalogue
row using its PostgreSQL lower/trim/collapsed-whitespace normalization. All catalogue
history participates, including tombstones; multiple historical matches are
ambiguous, not an invitation to prefer a live row. Failure reports up to 20 MR IDs
and match counts and rolls back atomically. An operator must review those labels
and resolve them through a separately approved reconciliation procedure before
retrying; migration never guesses IDs, creates entries or discards unmatched labels.

Deploy migrated database, API and frontend together; old nodes require the removed
text column and cannot safely continue. Readiness requires the UUID column. No
managed migration or deployment is performed by this work. Populated downgrades
are refused: catalogue renames mean original text cannot be reconstructed.
Use a reviewed forward correction or verified coordinated backup restore.

Create/edit accepts only `designation_id`, never writable `designation` or
`designationName`. Responses derive read-only `designationName` from the linked
catalogue, including soft-deleted names. Renames change display/search/export
without changing MR identity or version. New/reassigned choices must be active
and non-deleted; unchanged inactive choices may be retained with warnings, while
deleted choices must be explicitly replaced. The selector searches/pages server
choices, hydrates saved UUIDs and provides loading/retry and required validation.

CSV/XLSX keep the human-readable `Designation` header. Imports resolve a normalized
active catalogue name or explicit existing active UUID, with missing/ambiguous
errors; they never create catalogue records. Review binds the resolved UUID,
version, status and deletion state, rechecked at commit and after password work
under catalogue locks. Samples require replacing a catalogue-choice placeholder;
exports use the current linked name. A backup containing an inactive/deleted
assignment therefore needs explicit active replacement before create-only import.

Focused isolated regression command:
`sh scripts/test-api-foundation.sh tests/test_mrs.py tests/test_migration_mrs.py tests/test_migration_mr_designation.py`.
Authenticated desktop/mobile journeys run through
`sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/mrs-backend.preview.spec.mjs`.

## Operator prerequisites

The MR revision `0018_mr_directory` follows the delivered
`0018_product_categories` revision, which follows `0017_headquarters`.
Revision identifiers remain unique; these are a single ordered migration chain,
not two Alembic heads. No managed migration is executed by this implementation.

Numeric XLSX payment cells are validated from their original safe XML decimal
lexemes, not rounded spreadsheet-parser floats. Excess precision stays invalid;
plain text payment cells use the same two-place business validation as CSV.

This change delivers code and an isolated, reviewed Alembic migration; it does
not migrate the managed database, modify real accounts, or publish production.
An operator must back up the database and coordinate an application/migration
window before enabling the screens. Apply the existing initialization/migration
procedure through revision `0018_mr_directory`; check `/api/v1/health/readiness`, not just
`/api/healthz`. Readiness requires both new tables. Take a coordinated restore
point before provisioning real accounts: a populated directory cannot be
downgraded by dropping its account/history linkage.

Preflight intentionally refuses ambiguous case-insensitive email/username
namespaces (including the same literal in multiple namespaces). An operator
must inspect and explicitly resolve existing conflicts before retrying migration;
the migration never renames an identity or promotes a staff/domain record.
Existing Super Admin bootstrap and crypto prerequisites are unchanged.
Provisioning requires the protected singleton with **both** `admin.access`
and `domain.provision`, checked again in the service and after slow hashing.
Zone grants, business designations and imported labels are not authorization.

The MR business directory is one-to-one with a newly provisioned MRProfile,
whose existing ID remains the only MR ownership identity. Identity-only profiles
remain without invented directory details. No browser-local MR data is migrated,
mirrored, seeded or used as server references. Patient, Sales Target and payment
demo consumers retain their original local MR collection/IDs. Doctor Master now
uses server MRProfile-linked directory assignments; the MR doctors action lists
those live assignments with server counts/pagination. It never uses local Doctors.
See `doctor-master.md` for that separate directory and remaining local boundaries.

## Business and account validation

Inputs are trimmed and bounded; control/invisible characters are rejected.
Name (200), employee code (64), designation (200), address lines (300),
landmark (200), city/state/country (100) are business strings, not identities.
Name need not be unique. User ID is a lowercase 3–32 character login name:
a letter first, then letters, digits, dot, underscore or hyphen. The generator
suggests an available random username; saving rechecks availability.
Employee codes are case-insensitively unique even after soft deletion.
Username/email uniqueness is enforced case-insensitively across User accounts
by unique indexes plus a serialized database namespace trigger. Prior identifiers
remain reserved after rename or soft deletion; obsolete identifiers do not log in.
Protected administrator/root-style usernames and the protected email are reserved.

Required business fields are name, User ID, employee code, HQ, zone, designation,
joining date, PIN, address line 1, landmark, city, state and country. Address line 2
and manager are optional. The contact rule means either **both** phone and email
are required, or both are optional. A nonblank email must be a real email syntax;
blank email is kept null on User, never replaced by a fabricated address.
Phone accepts a normalized ten-digit Indian number, including a displayed `+91`
prefix and separators. Joining date must be a real ISO calendar date and not
future relative to **Asia/Kolkata**, independently of the viewing preference.
PIN is six ASCII digits, first digit nonzero.

Payment limit is an exact decimal `0.00` through `999999999.99`, never float
arithmetic; no exponent, negative amount or excess precision is accepted.
Doctor-days limit is an integer `0..3650`. Blank optional limits explicitly mean
`0.00` and `0`, preserving prior local defaults. Audit times are server UTC,
not imported or client-authored timestamps. Each mutation requires the saved
version; conflicts require fresh inspection, not last-write-wins.

HQ/zone are server UUID relationships. Newly selected relationships must be active
and nondeleted. Retaining an inactive assignment is allowed with a warning;
a deleted assignment must be replaced on edit. Reference search/paging exposes
all pages and explicitly includes a saved inactive/deleted choice. Designation
is a required server UUID relationship with the same lifecycle rules.
Managers are other directory MRs: new choices must be live/active, retained
inactive links warn, missing/deleted choices and self/indirect cycles fail.
All graph writes/imports share a transaction advisory lock, so competing edits
cannot jointly introduce a cycle. Deletion is blocked while a live child MR
uses the manager; reassign those MRs first.

## Credentials and lifecycle

Create atomically inserts User, MRProfile, directory and audit. Inactive records
are created with disabled User/Profile access. A creation-only initial password
may be entered and confirmed in the form (12–128 characters, whitespace is
significant), or generated by the server with 32 random bytes. The server stores
only Argon2id hashes. Generated/manual initial credentials, and reset/import
credentials, are returned once in no-store responses into the dedicated
memory-only reveal/copy confirmation UI. They never appear in normal projections,
audit/activity, URLs, storage, logs or downloads.

Edit never changes passwords or creates another identity. Identifier changes
preserve the Profile ID and revoke obsolete sessions. Reset is a separate
confirmed, expected-version operation: generate a new one-time password and
revoke sessions. Lost or uncertain credentials cannot be retrieved. Reconcile
the authoritative record, then explicitly reset. Uncertain create results use an
exact username reconciliation endpoint; writes are never automatically replayed.
Import conflicts consume the review and require a new read-only review.

Status/contact/edit/reset/delete are transactional and audited with UTC actor/time.
Deactivation/deletion disable only the linked MR User/Profile, advance identity
and token versions and revoke all sessions; bearer/refresh/file policy checks
fail immediately. Soft deletion retains directory, User, Profile, original deletion
evidence and patient/file assignments; nothing is reassigned or cascaded away.
Activation does not restore revoked sessions or resurrect tombstones.

`/mr` submits an explicit MR portal constraint before session issuance; Admin
submits its own portal constraint. Verified MR accounts use username or configured
email and open only the protected minimal home, sign-out and existing change-own-
password command. MR cannot enter Admin/master operations; Admin/staff cannot
acquire MR identity by portal selection. Doctor remains mock-only. Shared JWT,
rotating HttpOnly refresh, Remember me, replacement, expiry and cross-tab cookie
coordination are unchanged. Bearers/credentials are never persisted in browser
storage. Same-identity renewal preserves mounted drafts but disables protected
interaction; logout/identity changes remove responses, choices and secrets, even
after late body decoding.

## Postal provider boundary

An authenticated same-origin `/api/v1/admin/mrs/postal/{pin}` adapter sends only
the validated public PIN to fixed HTTPS `api.postalpincode.in/pincode/{pin}`.
No account, name, phone, email or address leaves the app. Redirects, environment
proxies, supplied URLs and compressed responses are refused. TLS verification
is enabled. Timeouts are 2 seconds connect, 5 seconds per I/O, with a 6-second
stream deadline and 128 KiB uncompressed response cap; at most 250 office results
and 100 characters per location value are accepted. Four in-process network
slots, 30 requests/minute per authenticated actor and an LRU of 512 public PINs
for one hour bound work. Quota/authority transactions finish before network I/O;
identity is revalidated before returning.

Provider `City` is preferred; where absent, **District is the city suggestion**,
then office name only if both are absent. Duplicate geographic results collapse.
One result autofills; differing results offer explicit choices. The form debounces
450 ms, aborts stale requests and guards PIN/record/identity changes. Deliberate
manual city/state/country edits are not overwritten. Invalid/no-result/provider-
failure responses leave manual entry available, never block account creation.

## Transfer schemas and compatibility

CSV export preserves this exact **21-column** order:

`Employee Code, MR Name, Phone No., User ID, Email ID, Contact Requirement, HQ,
Assigned Zone, Date of Joining, Designation, Reporting Manager, Payment Limit,
Doctor Days Limit, Status, Address Line 1, Address Line 2, Landmark, Pincode, City,
State, Country`

Legacy 20-column exports missing only `Contact Requirement` default explicitly to
**required**. Current CSV imports accept the 21 columns or the documented 25-column
schema; current genuine XLSX samples/exports use those business columns plus
`Created By, Created At, Updated By, Updated At`. Incoming audit values are ignored;
the importer/server owns all evidence. The old reduced six-column mock Excel
template is not a full backup and is rejected with schema-correction guidance.

HQ/zone resolve server UUIDs or case-insensitive names only when uniquely suitable;
Designation resolves existing active UUIDs or unique normalized active catalogue names;
local IDs/unsupported labels fail with setup guidance. Never auto-create references.
Managers may use UUID, unique MR name/User ID/employee code, or explicit
`user:username` / `employee:code`; same-batch managers use these unambiguous
identifiers. Export uses explicit `user:` manager references to avoid duplicate-name
ambiguity. Ambiguous labels, duplicates, cycles, conflicts or any provisioning
failure reject the entire batch. Unknown/password/hash/identity-link/version/
deletion columns are rejected. Formula-leading literals are apostrophe-escaped in
CSV/XLSX and unescaped on import; leading literal apostrophes are doubled so current
exports round-trip. Actual formulas are never evaluated.

Import is create-only: raw/multipart CSV/XLSX, server read-only review, then explicit
confirm. HMAC review binds exact raw bytes, filename, actor, session, identity version,
normalized business data and relationship versions. Confirmation reparses/rechecks
before hashing, then rechecks authority, conflicts and graph under lock before one
atomic transaction. Passwords are generated for the whole confirmed batch and
shown once in memory, never offered as a downloadable credential file. Changed
files invalidate reviews. Duplicate/outdated review commits do not replay writes.

Exports include **all** combined server search/status/zone/HQ matches, stable
pagination-independent results, and explicitly fail above 5,000 records. Accessible
CSV / Excel dropdowns do not download until a format is chosen. Samples and
exports require a durable server download-initiation ledger row before byte release;
client transfer requires its acknowledgement and a live identity guard.

## Resource budgets

Uploads: 2 MiB content, 1,000 records, 15-second body deadline, with only a bounded
64 KiB multipart overhead. XLSX: 100 archive members, 8 MiB aggregate decompressed,
4 MiB/member, one worksheet, at most 25,025 cells and 10,000 characters per XML/cell
text; independent coordinates defeat false worksheet dimensions. Malformed/duplicate
archives, macros, external links, formulas, encrypted/unsupported legacy files and
unsafe XML are rejected before workbook loading, without network/evaluation.

Account hashing: at most **two global PostgreSQL session advisory slots**, held on
separate committed connections without row locks, and 10 account-producing requests
per actor/hour (a batch counts as one). No queue: busy callers retry explicitly.
Each request hashes at most 1,000 records, with a 120-second hash deadline checked
between bounded Argon2id invocations. Database lock wait is 5 seconds and each
statement 10 seconds; the final import write phase is bounded to 20 seconds.
Timeouts roll back the entire batch; split large files if the CPU/database budget
is exceeded. No network work is performed under database locks. Reserve enough
pool capacity for two hash-slot connections plus normal API transactions; do not
remove budgets to compensate for deployment sizing.

Directory pages and exports load referenced accounts, HQs, zones, designations, managers and
audit-label identities in request-local batches of at most 500 distinct IDs per
query, not per MR. Only public scalar account/label columns are loaded by those
queries. Saved inactive/deleted references retain their names and warnings;
export manager references remain explicit account usernames. No projection cache
survives a request or replaces live authorization checks. Ordering, combined
filters, pagination, the 5,000-row cap (including a post-read overflow check), and
download ledger acknowledgement are unchanged.

## Verification

Run the isolated API harness, contract check, generated shared-client checks and
`pnpm run validate:release`. The harness overrides all ambient DB/auth settings,
uses a private temporary PostgreSQL socket and separate API/portal ports, and
removes only its synthetic data. Freeze source during browser passes. Tests cover
full validation/defaults, identity-only preservation, CRUD, graph races, account
namespace/history, filtered transfer, atomic failures, PIN/manual UI, real MR
authentication, own-password change and one-time credentials. Production rollout
still requires operator migration/readiness verification and actual account review.

Isolated PostgreSQL regressions also measure cold-session query counts and elapsed
time for a 100-row page and complete 5,000-row CSV/XLSX exports, with diverse saved
relationships and audit authors. Budgets are 30 statements / 3 seconds per page
and 48 statements / 6 seconds for CSV or 12 seconds for XLSX (including encoding).
These are regression ceilings, not production latency guarantees. Tests compare
exact projections, assert every exported row, check the real 5,001-row rejection
and verify revoked identities cannot reuse either read path.
