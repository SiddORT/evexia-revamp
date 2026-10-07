# Headquarter Master: shared records and operator rollout

Headquarter Master alone now uses FastAPI/SQLAlchemy/PostgreSQL, not the unused
TypeScript database template. No tenant model or relationship migration is
introduced. Browser-local headquarters and legacy session-storage drafts are
untouched and unused, never seeded, mirrored, restored automatically or used as
fallback. An operator/user can explicitly import a previously exported CSV.

## Identity, records and mutations

Every `/api/v1/admin/headquarters` endpoint requires the protected system
Super Admin and current `admin.access`. Service transactions lock/revalidate
the live identity/session before CRUD, transfer confirmation and export.
Business role labels and Zone grants give no access; MR/Doctor/anonymous
requests cannot use this master. Requests forbid unknown fields, including
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

Authenticated transport uses memory-only bearer credentials and never caches
protected records/drafts in browser storage. Same-identity recoverable renewal
preserves mounted drafts; logout/identity changes clear them and response/decode
guards prevent stale completions. Duplicate submissions are blocked. Writes
are not automatically replayed on uncertain outcomes; stale/uncertain forms
require authoritative read/compare before retry. Import consumes every attempted
confirmation; uncertain commits require an authenticated authoritative refresh
and inspection, then a fresh review, never replaying the old confirmation.

Migration **0017_headquarters** follows the actual **0016_designations** head,
creates only the empty constrained table/index and preserves shared foundations.
Do not apply it to a managed/shared database without separate operator approval,
backup and migration-role review. Roll out migrated schema with the new API,
then verify readiness and the protected singleton through the documented
initialization sequence. No migrations/bootstrap or real account changes ran
as part of feature implementation. Old API rollback is not a tombstone recovery
procedure; use a reviewed forward fix or coordinated verified backup.

Checks: `sh scripts/test-api-foundation.sh tests/test_headquarters.py
tests/test_migration_headquarters.py`, Node `serverHeadquarters.test.js`,
`sh scripts/run-authenticated-previews.sh
artifacts/evexia-portal/tests/headquarters-backend.preview.spec.mjs`,
`pnpm run check:api-contract`, `pnpm run validate:release`.
All fixture databases/listeners/results are isolated from managed data.
