# Headquarter Master: shared records and operator rollout

Headquarter Master alone now uses FastAPI/SQLAlchemy/PostgreSQL, not the unused
TypeScript database template. No tenant model or relationship migration is
introduced. Browser-local headquarters and legacy session-storage drafts are
untouched and unused, never seeded, mirrored, restored automatically or used as
fallback. An operator/user can explicitly import a previously exported CSV.

## Identity, records and mutations

Every `/api/v1/admin/headquarters` endpoint requires the protected system
Super Admin with `admin.access`, or the existing explicit Headquarter staff
capability for its action. Any existing Headquarter grant permits list/detail
and minimal zone choices, not Zone administration. Service transactions
lock/revalidate the live identity/session before CRUD, choices, transfer
confirmation and export. Business role labels and Zone-only grants give no
Headquarter access; MR/Doctor/anonymous requests cannot use this master.
Requests forbid unknown fields, including
server audit fields, identifiers, deletion evidence and arbitrary versions.

The catalogue begins empty. Names normalize Python Unicode whitespace to a
single space, trim and require 1–200 printable Unicode code points. Names reject
Unicode control/format/surrogate/unassigned/private-use categories and U+FFFE/
U+FFFF after normalization. Codes trim the same whitespace, uppercase and
require 1–16 printable code points after expansion (e.g. ß becomes SS).
Codes need not be unique. Non-deleted names, including inactive rows, are unique
under PostgreSQL lower/trim/whitespace normalization; a deleted name can be reused.

`POST ""` creates; `GET ""` lists; `GET /{id}` reads;
`POST /{id}/edit`, `/status`, `/delete` require a positive integer
`expected_version`. A stale write fails 409, not last-writer-wins.
Server-owned UTC creation/update timestamps and User references initialize
together. Mutations retain creation evidence and advance update evidence/version.
Soft deletion atomically sets `deleted_at/deleted_by` and update metadata/version.
Tombstones are retained and excluded from ordinary reads, edits, statuses and
exports. Repeat delete is 404 and cannot replace original deletion evidence.
There is no trash, restore, hard-delete or retention job.

Creation/import/edit/status/delete audit events are transactional, contain
resource/actor/session/request references and safe action/outcome only, never
record names, uploaded contents or private identity fields. Actor labels use
the existing safe authenticated projection. UI timestamps honor Admin preferences.

## Automatic State Code (not a geographic lookup)

Deterministic generation first NFC-normalizes the HQ name and extracts runs
of Unicode letters (general category L). Combining marks (M) within a run do
not separate words and are not initial letters. Every other character is a
separator. A single word contributes its first two letters; multiple words
contribute their first letters. Uppercase the assembled string, then cap at
16 Unicode code points. Mumbai → MU; North Mumbai/North-Mumbai → NM;
École/e + combining acute + cole → ÉC; ßeta → SSE. Names with no letters
require a manual code. Python and JavaScript parity is checked against Unicode,
combining marks, non-BMP letters, expansion, separators and truncation fixtures.
Use the supported Python/JS Unicode runtimes; runtime upgrades must preserve
these parity checks. This does not identify an Indian state.

Add follows the suggestion until a manual code edit. Later name edits preserve
that override; **Regenerate from HQ name** explicitly resumes automatic mode.
Edit starts with the saved code and preserves it on rename. API creation
generates only when `state_code` is omitted; explicit blank/null is invalid.
API edit omission preserves the saved code. Import generates only for a blank
State Code cell; supplied values are never replaced by a suggestion.

## Zones and named areas

`0051_headquarter_areas` follows the actual `0050_opening_stock` source head,
under the current automatic-migration policy. It adds a nullable Zone UUID,
per-HQ `next_area_sequence` (initially 1), and ordered child areas with stable
UUIDs, creator/updater timestamps and User references, plus retained
`deleted_at/deleted_by` evidence. Existing HQs are not assigned zones or areas.
Names, existing audits, HQ IDs and linked MR references are not rewritten.
No State Master or MR relationship/permission changes are introduced.

Add/Edit field order is Zone, HQ Name, State Code, Status. New creates and
explicit full edits require `zone_id`; existing status/delete requests still
require only their original fields and version, with no forced backfill.
`GET /zone-choices?query=&limit=100&offset=0` is a Headquarter-authorized,
literal-search, active/non-deleted minimal `{id,name}` picker, not the Zone
administration API. Responses include `total`, `limit`, `offset`; search and
explicit paging avoid silently truncating choices. A saved inactive/deleted
association is projected with its name, status and deletion flag, and can be
retained unchanged. New selections lock and require a live active Zone.
Zone metadata is not a historical name snapshot: current names are displayed.

Create accepts an `areas` collection (default empty); edit requires the entire
collection, including `[]` to explicitly remove every area. At most 200 rows
are accepted. Each input has `name`, optional saved `id`, and `code`. Names
normalize whitespace and require 1–200 printable Unicode code points; codes
trim, uppercase and require 1–32 printable code points after expansion. Explicit
blank/null codes are invalid. Omit a new row's code to allocate automatically.
Partial rows are errors, not silently dropped. Live names and codes must each
be unique within the HQ under PostgreSQL lower/whitespace normalization;
different HQs can share both area codes and State Codes.

Automatic new codes concatenate the editable State Code and a positive decimal
sequence: MU1, MU2, MU3. The parent HQ row is locked and its version checked
before saving Zone, HQ fields and the full area collection in one transaction.
All explicit codes are reserved first; a matching prefix/numeric suffix
advances the high-water mark (through 2,147,483,646). Allocation also skips
retained historical codes. Manual codes of other shapes remain valid.
Counter exhaustion requires a manual code, not wraparound or reuse.

The browser displays suggestions but omits automatic codes from the write so
the server allocates authoritatively. New automatic suggestions follow State
Code edits; explicit overrides and every saved code do not. Prefix edits and
HQ renames never silently regenerate saved area codes. Removing saved rows
retains their identities and deletion evidence, without decrementing the
counter or renumbering survivors. Unsaved removal may free an unreserved
suggestion. A server adjustment can skip historical collisions not present
in the mounted draft. No number is reserved merely by opening a form.

Reads return full `zone`, `areas`, `area_count`, and `next_area_sequence`.
List/mobile views show Zone and count; Edit shows every area. HQ soft deletion
hides the parent and its child data from ordinary access, without cascading a
hard deletion. Removed area identities cannot be resurrected by passing a stale
ID; explicit re-add creates a new identity.

Stale or uncertain saves block retry and preserve the same-identity draft.
Authoritative review displays the current Zone, HQ fields and every saved
area/code; a themed confirmation is required before saving the entire retained
draft against the reviewed parent version. Saved rows removed by another
editor must explicitly be discarded or re-added as new. A matching HQ found
after uncertain creation stays blocked and directs the user to inspect it.
No records or drafts are persisted to browser storage.

## Filtering, pagination, transfer schemas and bounds

List/export apply the same literal, case-insensitive name OR code search
(`query`, at most 200 characters) and `status=all|active|inactive` before
pagination. `%`, `_` and backslash are literals, not wildcard syntax.
Ordering is creation time descending then UUID descending. Lists accept
`limit=1..100`, `offset=0..1000000`; `total` counts non-deleted records,
`filtered` counts matching records. UI debounces queries, reloads on mount/
focus, and offers explicit refresh. Offset pagination is stable for unchanged
data; concurrent catalogue changes can change page composition.

Exact legacy CSV/XLSX headers:

`HQ Name,State Code,Status`

Exact current CSV/XLSX export headers:

`HQ Name,State Code,Status,Created By,Created At,Updated By,Updated At`

Status is active/inactive (case-insensitive on import). Current export audit
values are readable actor labels and ISO UTC timestamps. Imports ignore them
and attribute all new rows to the authenticated importer/current server time;
this is not historical audit restoration. Arbitrary extra/reordered/ID/version/
deletion columns are rejected. Current exports apostrophe-escape spreadsheet
unsafe name/code/actor cells; decoding this convention is limited to the exact
current schema so legacy literal apostrophes are preserved. XLSX cells are
explicit string cells. New exports and old backups round-trip into an empty
collection without restoring IDs, versions or audit history.

These transfer schemas intentionally remain unchanged. They do **not** include
Zone or areas and are not a backup/restore format for those additions. Every
legacy/current import creates an HQ with explicit no-zone/no-area defaults and
sequence 1. Its first subsequent full edit must select a Zone. Status/delete
remain available without selecting one. No zone inference or seeding occurs.

`GET /sample?format=csv|xlsx` supplies compatible inert templates.
`POST /import/review?filename=...` returns row errors, normalized/generated codes,
validity and a server HMAC. Review saves no catalogue records or upload bytes.
`POST /import/commit?filename=...&digest=...&confirm=true` resubmits the exact
reviewed bytes. The HMAC binds resource, filename, bytes, authenticated importer
and session (same-session token renewal remains compatible). Commit rechecks
current identity/conflicts; duplicate names within the file or existing live
names reject the entire batch. Database uniqueness resolves concurrent races
and rolls back records and audit events together.

Files: non-empty UTF-8 CSV or genuine single-sheet `.xlsx`, at most **2 MiB**,
**1,000 rows**, **7 columns**, **10,000 characters per cell**. Raw
`application/octet-stream` or exactly one multipart `file` part is accepted.
Actual streamed request bytes are bounded to 2 MiB raw or 2 MiB + **64 KiB**
multipart overhead, with an independent 2 MiB extracted-file limit and
15-second stream deadline. Unrelated uploads keep their existing limits.
Shared workbook parser limits archives to 100 entries, 8 MiB total decompressed,
4 MiB per member, bounded cells/coordinates/XML text. It rejects malformed/
encrypted archives, formulas, macros, embedded objects, external links and
unsupported formats without evaluation or network access.

`GET /export?query=...&status=...&format=csv|xlsx` exports all matching live
records, not only the current page. More than **5,000** matches fails explicitly
without truncation; narrow filters. Attachments use
`evexia-headquarter-master.csv|xlsx` and sample `evexia-headquarter-template.*`.
All actual downloads use mandatory durable ledger acceptance
(`headquarter`, `export|template`, `CSV|XLSX`), initiation keys and
`X-Download-Log`; failure releases no bytes. Logging means preparation/issuance,
not proof of completed disk writes.

## Browser recovery and rollout

The existing `/admin/masters/import/headquarter` route uses the prepared master
import layout: top back link, selected Headquarter tab, numbered sample/upload
cards and separate valid/invalid upload-summary sections. CSV and genuine Excel
sample buttons call the authenticated sample endpoints separately; neither
sample nor export has a standalone format selector. The list's Export data
menu offers CSV/Excel only after selection, uses the current Admin palette and
keeps its pending trigger focusable for keyboard focus return. Reviewed rows
display the server-normalized/generated State Code, not a client suggestion.
Replacing a file invalidates pending review/sample results and the prior
summary, but cannot remove an unresolved commit's reconciliation requirement.

Authenticated transport uses memory-only bearer credentials and never caches
protected records/drafts in browser storage. Same-identity recoverable renewal
preserves mounted drafts; logout/identity changes clear them and response/decode
guards prevent stale completions. Duplicate submissions are blocked. Writes
are not automatically replayed on uncertain outcomes; stale/uncertain forms
require authoritative read/compare before retry. Import consumes every attempted
confirmation; uncertain commits require an authenticated authoritative refresh
and inspection, then a fresh review, never replaying the old confirmation.

The original `0017_headquarters` migration created the empty catalogue after
`0016_designations`. New forward `0051_headquarter_areas` follows the current
head, without editing applied history. The current automatic migration policy
in `replit.md` supersedes historical per-revision approval language.
The independently merged MR zones branch is reconciled with this branch by
no-op `0052_hq_mr_zones_merge`, the final coordinated schema. Both original
forward migrations remain unchanged; MR relationships are still independent
of an HQ's Zone selection.
Downgrade refuses any populated zone/area/counter history; use a reviewed
forward fix rather than discard retained data.

For this extension, verification is **manual disposable CRUD only**. Do not run
automated tests, suites, regression/release checks, builds, benchmarks or broad
wrappers. API export, direct Orval generation/formatting and schema metadata
generation are separate narrow implementation steps, not evidence of tests.
See `docs/headquarter-areas-catalog.md` for catalog generation provenance.
Original development and production activation remain unverified from a fork;
do not start an original-target migration simply to obtain fork evidence.
