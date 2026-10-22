# MR Master: identity, rollout and transfer contract

## Current contact, credentials and reporting-manager contract

Live MR and Doctor creates, full edits and imports require **at least one of
primary phone or email**. Both are allowed; neither is individually required.
Whitespace-only values count as blank. Doctor alternate phone remains separate.
Supplied contacts retain their existing format checks. `Contact Requirement`
remains inert historical metadata for compatible reads/backups, not a configurable
policy; legacy contact-toggle endpoints reject changes. Blank-contact history
remains readable and supports unrelated administrative actions, but requires
correction on the next full edit. No contact data is backfilled or rewritten.

Interactive Add MR has no User ID input or candidate-generator call. The server
chooses and reserves a unique `mr.` login identifier within account creation,
using bounded secure candidates and collision retries against the encrypted
shared account namespace. Import User IDs and existing edit identities retain
their supported contracts. The existing one-time post-save presentation shows
the committed identifier/password; uncertain creations reconcile by employee
code with same-session creation evidence, not an unknown generated username.
An absent email remains `None` on the account and blank on the business profile.

Add MR password generation produces 15 characters with uppercase, lowercase,
digits and special characters, using secure randomness and a shuffle. Manual
passwords remain 12–128 characters. Blank enrollment fields preserve server
generation and password-setup-required semantics. Staff creation, reset/recovery
policies and existing passwords are unchanged. Plaintext credentials stay in
request/browser memory, never logs or local persistence.

Reporting manager choices now show **Staff names** through the existing searchable
selector. The MR-authorized helper returns only reference/name/lifecycle fields,
scans at most 500 candidates per request, and requires explicit continuation.
It hydrates only the one selected ID; it grants no Staff Management permission.
New Staff assignments must be active/nondeleted under transactional locks.
Saved inactive Staff remain readable and may be retained.

Forward migration `0055_mr_staff_managers` adds nullable `reportingStaffId` with
a RESTRICT foreign key and an independently encrypted saved name. Historical
`reportingManagerId` MR links and their encrypted labels stay separate and are
shown as **legacy MR** assignments until explicitly replaced/cleared. No name-based
mapping or MR cascade is introduced. Staff selection captures its current name
once; retaining the same ID does not refresh the saved snapshot. Runtime rotation
includes the new field only at the reviewed successor revision, while earlier
inventories and migration sources remain frozen.

Current files append **Reporting Staff ID** to the prior multizone columns;
exports additionally carry **Reporting Manager Name** and **Reporting Staff Name**.
Staff IDs are server UUIDs and saved-name columns are informational. Old header
variants and old MR-manager references remain supported, without guessing Staff
mappings. Old `required`/`optional` values never override the fixed contact rule.
Current samples have 24 columns, CSV exports 26, XLSX exports 30. Existing file,
row, export-result and cell-size limits are unchanged.

This refinement was source-inspection-only apart from offline contract generation
and static compilation/typechecking. No tests were added, modified or run.
No browser scenarios, service restarts, database migrations, live mutations or
production actions were performed. Automatic activation remains the existing
post-merge lifecycle; no running revision or migration success is claimed here.
Historical descriptions below describe earlier milestones, not current policy.

## Multiple assigned zones

MR Master now has two MR-scoped searchable multiselects: Assigned zone in the
list and Assigned zone in Add/Edit. Both have checkmarked options, keyboard
navigation, removable selected chips and Select all. At least one form zone is
required. No HQ restriction, area assignment or browser-local migration is added.

`0051_mr_zones` is the forward successor to source head `0050_opening_stock`.
It backfills every existing MR (including inactive/deleted history) from its
unchanged singular zone and saved zone label into an ordered MR→zone collection.
Parent/member deferred integrity guards require the primary to remain a member;
duplicate memberships/positions are rejected. Downgrade refuses records with
additional memberships instead of discarding them. Applied migrations remain
unchanged. The automatic migration policy in `replit.md` supersedes historical
per-revision approval descriptions below.

Protected MR responses include ordered `zoneIds` and `assignedZones` (saved
label, status and deletion state), alongside existing `zoneId`/`zoneName`.
Create/edit accepts an explicit nonempty, distinct `zoneIds` array (maximum
10,000) plus compatibility `zoneId`. Existing primary remains primary while
selected; removal chooses the first remaining member. Both the selected summary
and listing mark **Primary**. New assignments must be active/non-deleted under
transactional reference locks. Saved inactive memberships may be retained;
deleted memberships require explicit removal or replacement. Parent expected
version and existing authorization, account, graph, audit and uncertain-save
boundaries remain in force. Old scalar-only edits preserve additional saved
members, adding a newly requested zone if necessary, never replacing the entire
collection implicitly.

Doctor, Patient and Sales Target continue to derive their one zone from
`zoneId`; they do not gain multizone assignment behavior. MR list/cards and MR
search use every member, with saved labels and per-member lifecycle warnings.

Form Select all traverses the MR-authorized reference endpoint without a search
term using `active_only=true`, 100 choices per page. The zone endpoint returns
each page, total and a catalogue-version fingerprint from one SQL snapshot.
Every page must have the same total/fingerprint, unique active nondeleted IDs,
and complete coverage before any selection is applied. Failure, cancellation,
catalogue changes or the 10,000-choice bound leave the selection unchanged;
retry is explicit and Save is blocked while selection is pending. Existing
selections (including inactive/deleted ones) are retained, so Select all never
silently removes an unavailable saved assignment. Future zones are not assigned
automatically. Ordinary search/paging does not discard selected chips.

List/export accept comma-separated UUIDs in `zone_ids`; legacy `zone_id`
remains accepted, and when both are supplied they are combined. Matching is
**any assigned zone**, using a membership subquery rather than a duplicating
join. Empty/reset/Select all means no zone predicate, including unloaded,
inactive and retained deleted assignments. Pagination/counts and CSV/XLSX use
the same predicate. The browser sorts the selected set to bind/reset its search
continuation, and server-issued MR search cursors are HMAC-bound to the actor,
search, status, selected set, HQ and page size. Old unbound search cursors must
restart after this rollout.

### Portable multizone files

The current sample adds **Assigned Zones JSON** immediately after Dial Country.
It is a JSON array of distinct zone UUIDs or uniquely resolvable catalogue names,
for example `["North","South"]`. JSON escaping, not commas/semicolons within
names, defines member boundaries. The existing **Assigned Zone** column supplies
the compatibility primary and must resolve to one member. Exports put UUIDs in
both columns to avoid name ambiguity, preserving member ordering and primary
independently. Export adds Reporting Manager Name as before; XLSX adds the
four informational server audit columns. Current samples therefore have 23
columns, CSV exports 24, and XLSX exports 28.

Legacy 20/21-column files, Dial Country schemas (22 columns), and their previously
accepted audit/manager-label variants remain accepted. An absent multizone column
means a single assignment. An explicitly present but blank/malformed/duplicate
array is rejected, not interpreted as permission to lose memberships.
Review/HMAC/commit bind every resolved member and its version/lifecycle and
revalidate after password work under locks. Import stays atomic and create-only;
inactive/deleted references in a backup still need explicit active replacements.
The existing 2 MiB/1,000-record upload and 5,000-match export budgets remain.
Current XLSX coordinate allowance is 28,028 cells. A transfer cell over 10,000
characters rejects the whole export explicitly; it never truncates a long zone
array. Thus a very large valid API assignment may exceed portable-file bounds.

### Implementation-only handoff

For this change the user explicitly prohibited all tests, manual/browser
scenarios, regression checks, benchmarks, builds and validation wrappers.
Only source/diff inspection, offline OpenAPI/client generation and source
integrity metadata generation were performed. No service restart, migration
execution, real-record modification or production deployment was performed.
The development declaration and generated source metadata target `0051_mr_zones`;
this is **not** evidence that any running database or service has advanced.

Fresh-install catalog/release evidence remains pinned to the previously observed
`0050_opening_stock` catalog. It cannot honestly be advanced without executing
the new schema and collecting a real PostgreSQL catalog, which was excluded here.
The guarded fresh installer therefore remains blocked for this new source head
until separately authorized catalog reproduction and release-metadata refresh.
Do not invent a digest, weaken the installer guard or claim runtime acceptance.
After merge, original development's existing automatic lifecycle owns migration
activation and restart; its runtime state was not observed in this fork.
Historical verification commands below are documentation, not commands run for
the multizone implementation.

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
are created with disabled User/Profile access. Add MR starts with a visible
cryptographically generated candidate in Password and Confirm password. Admins
may hide, explicitly copy, regenerate or replace it (12–128 characters,
whitespace is significant). The candidate is not an account credential until
creation succeeds. Clearing both optional inputs requests server generation with
32 random bytes; unavailable browser cryptography leaves manual entry and that
blank fallback available without insecure randomness. Copy feedback is cleared
when the candidate changes. Passwords remain separate transient form state,
confirmation is never submitted, and only the exact password candidate enters
the protected create request. The server stores
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

The original, still accepted legacy **21-column** business schema is:

`Employee Code, MR Name, Phone No., User ID, Email ID, Contact Requirement, HQ,
Assigned Zone, Date of Joining, Designation, Reporting Manager, Payment Limit,
Doctor Days Limit, Status, Address Line 1, Address Line 2, Landmark, Pincode, City,
State, Country`

Legacy 20-column exports missing only `Contact Requirement` default explicitly to
**required**. Legacy 21-column and 25-column audit schemas remain accepted, as do
the subsequent Dial Country and Reporting Manager Name variants. Current
multi-zone formats are defined above. Genuine XLSX exports append
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
4 MiB/member, one worksheet, at most 28,028 cells and 10,000 characters per XML/cell
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

## Historical verification guidance (not run for multizone)

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
