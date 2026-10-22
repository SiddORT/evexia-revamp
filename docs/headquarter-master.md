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

Two exact legacy CSV/XLSX header forms remain accepted:

`HQ Name,State Code,Status`

`HQ Name,State Code,Status,Created By,Created At,Updated By,Updated At`

Exact current CSV/XLSX sample headers:

`HQ Name,State Code,Status,Zone ID,Zone Name,Area Name,Area Code`

Exact current CSV/XLSX export headers:

`HQ Name,State Code,Status,Zone ID,Zone Name,Area Name,Area Code,Created By,Created At,Updated By,Updated At`

Status is active/inactive (case-insensitive on import). Current export audit
values are readable actor labels and ISO UTC timestamps. Imports ignore them
and attribute all new HQ/area rows to the authenticated importer/current server time;
this is not historical audit restoration. Arbitrary extra/reordered/ID/version/
deletion columns are rejected except the specified Zone ID reference.
Audit export schemas (both old and current) apostrophe-escape spreadsheet-unsafe
text and literal leading apostrophes; only these exact audit schemas decode that
convention. Basic sample schemas preserve literal apostrophes. XLSX cells are
explicit strings, never executable formulas.

Current files use one row per area with the same normalized HQ name, State Code,
status, Zone ID and Zone Name on every row for that HQ. Grouping uses the same
PostgreSQL name comparison as live uniqueness, including non-adjacent repeated
rows. Inconsistent parent fields are errors. HQ groups retain first-appearance
order; areas retain source-row order. Exactly one row with **both** area cells
empty represents an empty area list. Mixing empty/populated area rows, multiple
empty rows, or a code without a name is invalid, never silently dropped.

Zone ID is a saved UUID, not an imported identity to create. Zone Name is a
readable label only; review displays the current saved name for the authoritative
ID. The import page's read-only, searchable, explicitly paged reference panel
uses the existing Headquarter-authorized active Zone choices endpoint (not Zone
administration grants). Replace sample UUID placeholders using those references.
Current imports require an active, non-deleted saved Zone; review/commit lock
selected Zones in UUID order and recheck availability. Exports preserve historical
Zone IDs, label inactive/deleted links visibly and show “No zone assigned” for
legacy empty links. Such files cannot newly assign unavailable links: select an
active saved ID in the reference panel, update every row for that HQ and review
again. No zone inference, new catalogue row or geography lookup occurs.

Area names/codes reuse live validators and the shared read-only allocation plan:
normalized printable names, uppercase supplied codes, case-insensitive per-HQ
name/code uniqueness and at most 200 areas. A named row with blank Area Code
explicitly requests the existing automatic rule. All supplied codes reserve their
numeric suffixes first; automatic allocations follow file order from sequence 1.
Review shows final allocated codes; commit uses the same plan under the new
parent's transaction. Uploaded codes are never replaced by State Code suggestions.
Export reads each live area's saved code, not a recomputation; removed areas stay
excluded. Retained sequence/removal history and area UUIDs are not restored.

The exact legacy three/seven-column forms deliberately create no zone, no areas
and sequence 1. Their first full edit must select a Zone; status/delete still do
not force backfill. Repeated legacy HQ names remain errors, not grouped additions.

`GET /sample?format=csv|xlsx` supplies inert current templates with two areas on
one HQ (one supplied code, one automatic) and an empty-area HQ.
`POST /import/review?filename=...` returns grouped `rows`, source row numbers,
Zone identity/current label, every area's normalized name and code, `generated`
flags, group errors, `area_count`, validity and a server HMAC.
Review saves no catalogue records, counters, audit events or upload bytes.
`POST /import/commit?filename=...&digest=...&confirm=true` resubmits the exact
reviewed bytes. The HMAC binds resource, filename, bytes, authenticated importer
and session (same-session token renewal remains compatible). Commit rechecks
current identity/conflicts, Zone availability and area validation. Existing live
HQ names reject the entire batch: import never appends areas to an existing HQ,
changes its zone or upserts it. One parent is inserted per valid group; the
parent, Zone link, ordered areas, counter and authenticated audit records commit
together. A new uniqueness conflict or any write error rolls everything back.
Success returns both `imported` HQ count and `imported_areas`.

Files: non-empty UTF-8 CSV or genuine single-sheet `.xlsx`, at most **2 MiB**,
**1,000 total data rows** (including repeated HQ/blank-area rows),
**11 columns**, **10,000 characters per cell**. Grouping cannot bypass these
physical bounds or the 200-area per-HQ limit. Raw
`application/octet-stream` or exactly one multipart `file` part is accepted.
Actual streamed request bytes are bounded to 2 MiB raw or 2 MiB + **64 KiB**
multipart overhead, with an independent 2 MiB extracted-file limit and
15-second stream deadline. Unrelated uploads keep their existing limits.
Shared workbook parser limits archives to 100 entries, 8 MiB total decompressed,
4 MiB per member, bounded cells/coordinates/XML text. It rejects malformed/
encrypted archives, formulas, macros, embedded objects, external links and
unsupported formats without evaluation or network access.

`GET /export?query=...&status=...&format=csv|xlsx` exports all matching live
records, not only the current page. Parent shared locks keep each area's read
consistent with its HQ while live editors use their existing parent lock.
More than **5,000** HQ matches or **10,000 expanded data rows** fails explicitly
without truncating a parent or its areas; narrow filters. Output is independently
bounded to **8 MiB** after date presentation; XLSX also has an **8 MiB**
decompressed/ **4 MiB** per-member limit. Large exports can exceed import's
1,000-row/2-MiB bounds; select narrower HQ filters or split into complete HQ groups
before import. Attachments use
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
keeps its pending trigger focusable for keyboard focus return. Reviewed groups
display the server-normalized/generated State Code, assigned Zone and every
included area with its saved or planned code, not client suggestions.
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

The earlier Zone/area editor extension allowed **manual disposable CRUD only**. Do not run
automated tests, suites, regression/release checks, builds, benchmarks or broad
wrappers. API export, direct Orval generation/formatting and schema metadata
generation are separate narrow implementation steps, not evidence of tests.
See `docs/headquarter-areas-catalog.md` for catalog generation provenance.
Original development and production activation remain unverified from a fork;
do not start an original-target migration simply to obtain fork evidence.

For the subsequent area/Zone **transfer** extension, the user explicitly required
**source inspection only**. No tests (unit, integration, browser or manual
scenarios), builds, validation/release wrappers, migrations, live data writes,
service restarts or deployment were run. Narrow offline OpenAPI export, direct
Orval generation and generated-source formatting only were used to align the
shared contracts; no chained typecheck/codegen wrapper was invoked. This is an
implementation, not runtime acceptance evidence.
