# Language Master

Language Master is a shared, protected singleton-only catalogue at
`/admin/languages`, under Masters / Geography & Logistics. It has one editable
business field: **Language name**. Patient instructions-language values and all
other workflows remain independent.

## Contract and storage

The API is `/api/v1/admin/languages`: bounded searchable GET listing (`query`,
`limit` 1–100, `offset` 0–1,000,000), GET `/{id}`, POST create `{name}`,
POST `/{id}/edit` `{name, expected_version}` and POST `/{id}/delete`
`{expected_version}`. Unknown body fields are rejected. Names are trimmed,
required, Unicode strings of 1–200 code points, without control characters.
PostgreSQL's `lower(name COLLATE "pg_c_utf8")` partial unique index enforces case-insensitive
uniqueness among non-deleted records, including concurrent writes. It uses the
PostgreSQL 17 builtin Unicode lowercasing, independent of the operating-system
locale (including private test clusters initialized with `--no-locale`), not a
different browser casefold rule. Search uses that same Unicode collation.

The API repeats live identity/session authorization after the shared policy lock
and before record locks. Only the protected system Super Admin is allowed; no
Staff permission domain, MR access, identity promotion or implicit grants exist.

Language names and the retained before/after name snapshots are non-personal
catalogue labels stored as text, following Zone's catalogue policy, not directory
contact/credential encryption. No other business data or request body is copied
to history or audit logs. Server User references, UTC times, optimistic versions
and deletion metadata cannot be supplied by clients. Deletion retains the row.
History is append-only at the database level, with a unique record/version and
a retained reference to its success audit. Business changes, history and
metadata-only success audits commit in the same transaction. Failure rolls them
back together. Existing middleware supplies safe request correlation and
operational failure/denial logging.

## Actions drawer and failure recovery

Each row's own Actions column opens its right drawer; Move Stocks is unchanged.
GET `/{id}/history` returns chronological committed changes, bounded paging,
the current/tombstoned record, and whole-record create/edit/delete totals plus
latest change. Totals are calculated independently of the current history page.
Browser-reported activity never contributes to them. Successful deletion offers
an immediate “View deleted language history” action without introducing a trash
browser. A known deleted ID remains readable at the history endpoint only.

Forms remain mounted with their draft on failed writes and session renewal.
Stale edits require explicit current-record review before another save. An
uncertain create is never automatically retried and remains blocked; a read-only
matching-record review is available without discarding the draft. Absence from
that bounded read is explicitly not proof that a delayed create did not commit.
Users must deliberately resolve an uncertain outcome; there is no create retry
key or invented “not saved” evidence. Deletion conflicts block reconfirmation
until cancellation and a refreshed directory.

Drawer close/Escape/focus return use the existing native modal pattern. Dates
use reactive shared date preferences. Loading, errors and retry are explicit.

## Migration and verification boundary

The Language transfer extension below is **implementation-only**. The user's
current instruction forbids all tests, browser verification, builds, broad
validation and wrappers that invoke tests. The CRUD evidence later in this
document is historical and does **not** verify import/export. No new migration,
managed restart, original-database access, key change, deployment or push is
part of this extension.

`0047_languages` follows the actual single head in this checkout,
`0046_live_inventory`. `0048_language_unicode` is its forward Unicode index
correction. A narrow runtime observation discovered that the managed lifecycle
had already applied the initial `0047` definition while authoring was in
progress, so that original migration is preserved rather than rewritten.
No Product Master successor was present when authored.
Concurrent schema work must be reconciled to the merged single head before
automatic activation; do not edit applied predecessors, stamp a database or
bypass historical guards. Coordinated declarations and source integrity metadata
are generated through the existing development/release metadata authoring tools.
Account/receipt/inventory readiness retains explicit successor coverage.

Only run `sh scripts/test-language-crud.sh` for this feature's focused API CRUD
checks. It names only `tests/test_languages_crud.py` plus the Language CRUD
transport test, and uses a private disposable PostgreSQL cluster, synthetic
identities/keys, no shared database or network
listener. It exercises create/read/list/edit/delete, validation and Unicode,
database live uniqueness, independent-connection create/edit races, stale
versions, forbidden identities, transaction-time revocation, retained history,
atomic failure and totals unaffected by browser reports.

The focused CRUD fixture also made a narrow read-only catalog observation after
the original migrations completed and before business writes: revision
`0048_language_unicode`, catalog SHA-256
`1ed84dbdce77c729601f0ffd249c8dce0fe96705a2cd279b744ee5a70d4e6c7b`.
That observation supplies the new catalog entry for normal metadata generation;
it is not a release/regression check, restoration rehearsal, CI result, managed
activation or live alignment evidence. Existing historical catalog entries and
their provenance have not been relabelled.

**Post-merge acceptance:** the original development workspace must use its normal
automatic lifecycle to synchronize and restart. Then make narrow read-only
observations of the actual database revision, `/api/v1/version`,
`/api/v1/health/readiness` and `/release-runtime.json`. The database revision and
loaded API/frontend schema declarations must agree. A fork's disposable results
or generated declarations do not establish that agreement. Do not migrate the
original database from the task fork, access production/VPS, deploy or push.

### Observed delivery evidence

- `sh scripts/test-language-crud.sh`: **18 focused synthetic PostgreSQL CRUD
  tests passed**, plus **1 focused JavaScript CRUD transport test passed**.
  The latter covers exact request bodies, version propagation, history paging
  and totals, malformed responses, stale/duplicate responses and no automatic
  retry of uncertain creates. Only a pre-existing Starlette/httpx deprecation
  warning was emitted.
- OpenAPI and generated clients were regenerated without invoking the broad
  package codegen wrapper's typecheck, a build or a release/regression harness.
  Development/release schema metadata was regenerated as authoring work, not
  represented as passing CI.
- Narrow read-only task-environment observations after source completion:
  source target **0048_language_unicode**, actual database **0047_languages**,
  loaded API declaration **0047_languages**, served frontend declaration
  **0047_languages**, readiness **ready** for that still-loaded predecessor.
  The observed unique index is still the initial `lower(name)` definition, not
  the final Unicode index. Thus **final live activation/alignment is BLOCKED /
  not verified**, despite the predecessor runtime agreeing with itself.
- No original-database sync or managed restart was manually invoked from this
  task environment: the bound database matched the original-development binding,
  so restarting the API's automatic migration entry point could write the
  prohibited target. Normal automatic post-merge synchronization/restart in
  the original workspace remains the concrete next step, followed by the narrow
  observations above. No stamps, key changes, identity overrides, production
  access, deployment or pushes were used.
- The unauthenticated app screenshot rendered the normal Admin login page with
  no module-loading error. It does **not** verify the protected Language screen,
  modal/drawer interactions or authenticated layout. No broad/browser matrix
  or browser regression suite was run.

## Authenticated Language import/export

Language Master offers **Import data** and an **Export data** menu with CSV and
Excel choices. The shared `/admin/masters/import/language` route mounts a
dedicated server-backed page and Language tab, not a mock template or local
store. All operations retain the protected Super Admin gate, including
transaction-time identity/session revalidation. Staff permissions and the
patient-authorized language-choice endpoint are unchanged.

### Portable formats and limits

- The only column is the exact header **`Language name`**. Templates contain
  one fictional example, `Example language`; nothing is seeded automatically.
  Status, code, locale, IDs, versions and incoming attribution are not accepted.
- Accept UTF-8 CSV (optional BOM) or a genuine single-sheet `.xlsx`; reject
  `.xls`, macro-enabled files, formulas, external relationships, embedded
  objects and encrypted archives. The existing bounded workbook reader also
  restricts archive entries, decompressed/XML size, cell coordinates, rows,
  columns and cell text before opening the workbook.
- Imports permit **2 MiB of file bytes and 1,000 records**, plus one header.
  Raw `application/octet-stream` and multipart with exactly one `file` part
  are supported. Multipart receives an additional **64 KiB envelope allowance**;
  the extracted file still cannot exceed 2 MiB. Upload streaming times out
  after 15 seconds. Both request-size enforcement layers allow these paths.
- Names use the manual-save validator: trim surrounding whitespace, retain
  Unicode, require 1–200 code points and reject unsupported controls. Extra
  columns and invalid files receive explicit errors; review reports per-row
  field errors and duplicate conflicts. Duplicate checks for both the file and
  live catalogue run through PostgreSQL
  `lower(value COLLATE "pg_c_utf8")`, exactly like the live unique index, never
  JavaScript lowercasing or Python casefold. Deleted names do not conflict.
- Exports contain **all non-deleted name-search matches across all pages**, up
  to **1,000 matches**. A larger match set is explicitly rejected before file
  release; it is never silently truncated. This deliberately uses the import
  record bound so a nonempty exported file is reviewable in an empty catalogue
  without splitting. A zero-match export contains the header only; import
  review still requires at least one record.

### Literal text and spreadsheet escaping

CSV and XLSX use the **same documented escaping convention**. CSV includes a
UTF-8 BOM and normal CSV quoting; XLSX cells are explicitly text, never formulas.
For every name in either format:

1. Prefix a name starting with `=`, `+`, `-` or `@` with one apostrophe.
2. Double any literal leading apostrophe.
3. On import, remove exactly one leading apostrophe only when it precedes
   another apostrophe or a formula-like prefix. Otherwise preserve the text.

For example, stored `=Example` exports as `'=Example`, stored `'Example`
exports as `''Example`, and stored `'=Example` exports as `''=Example`.
Review displays the decoded literal name. **Authors of hand-written import files
must use this convention too**, including doubling a literal leading apostrophe;
do not strip export escapes, open/re-save them through a tool that changes cell
text, or treat apostrophes as optional formatting. This removes ambiguity without
adding metadata columns or altering literal saved names. Raw formula-like CSV
text is accepted as a literal catalogue name and is escaped on export; real
workbook formula cells are rejected. Importing an export into its source
catalogue correctly reports existing-name conflicts instead of overwriting rows.

### API and atomic confirmation

Under `/api/v1/admin/languages`, static transfer paths precede `/{language_id}`:

| Method / path | Contract |
| --- | --- |
| GET `/sample?format=csv\|xlsx` | Authenticated single-name template |
| GET `/export?query=…&format=csv\|xlsx` | All live search matches or explicit finite-limit error |
| POST `/import/review?filename=…` | Raw/multipart file; returns rows, errors, valid/invalid counts, valid flag and signed digest; saves no languages |
| POST `/import/commit?filename=…&digest=…&confirm=true` | Same file and explicit confirmation; returns `{imported}` only after the whole transaction commits |

The digest is an HMAC over the Language domain, initiating user, server login
session, exact filename and SHA-256 of file bytes. It cannot be substituted
between users, login sessions or changed files. Same-user token renewal within
the same login retains the draft; a new login requires review again.
Confirmation revalidates authorization and current conflicts under the policy
lock. The database unique index remains the final concurrent-write guard.
All rows are create-only; every inserted language receives server-owned UUID,
version, actor/time attribution, a retained create history and its success audit
in the **same transaction**. Any row/history/audit failure rolls back the batch.
The existing Actions drawer counts these entries exactly as manual creates.
Successful imports return an explicit count; returning to Language Master mounts
a fresh server listing, and history reads remain server-backed.

Templates and exports require the standard durable server download-initiation
ledger before any browser handoff. Missing acceptance evidence blocks release.
Files carry no audit identities, dates, session references or record IDs. The
ledger is initiation evidence, not proof that the browser saved a file to disk.
Responses are `no-store`; file bytes are never persisted by this feature.

### Ownership, failed requests and uncertain outcomes

The page keeps the selected `File` and review only in memory. File replacement
invalidates the review and discards late responses; every confirmation attempt
consumes the displayed review. Duplicate confirmation clicks are blocked.
Changed identities clear private operation state, and guards discard stale
review/download results before rendering or releasing files. Same-user session
renewal preserves the mounted draft and never automatically replays a write.
The export menu uses the shared keyboard/focus behavior; review and outcome
notices receive focus after asynchronous completion.

A lost/unreadable/malformed confirmation response, transport failure or server
5xx may follow a committed transaction. The client **never automatically retries**
and preserves the selected file with an explicit uncertain-outcome warning.
Read-only conflict checks remain possible, but **cannot clear the warning or
enable resubmission, even when no conflicts are found**. Reopening the route in
the same loaded app also retains the in-memory block. No durable import receipt,
cancellation or reconciliation endpoint exists; the signed review digest is
file/session binding, **not a durable retry or single-use receipt**.

Inspect the shared directory and retained create histories and obtain
authoritative confirmation of the original outcome before any new attempt.
Absence from a search does not establish non-commit; a delayed request can still
finish. Reloading, closing the app or logging out destroys in-memory operation
state, not the server request. These actions are **not recovery** and must not be
used to retry an unresolved batch. There is deliberately no “retry anyway”
control or browser-local persistence of uploaded files.

### Implementation-only delivery evidence

The FastAPI contract was exported and Orval client/Zod artifacts regenerated
through direct generation commands, followed only by generated-file formatting
and the existing generated-constant ordering transform. Source contract diff
inspection found no semantic changes to pre-existing paths or schemas,
including Language CRUD/history and patient language choices.

**Tests were not run at the user's request.** No new tests were written; no CRUD,
transfer, browser, regression, release, build, typecheck, runtime request or
managed restart was run for this extension. The protected screens, database
behavior, concurrency and runtime alignment therefore remain unverified by
execution in this implementation-only delivery.
