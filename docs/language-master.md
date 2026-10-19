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
