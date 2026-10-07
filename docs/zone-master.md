# Shared Zone Master

Zone Master uses authenticated FastAPI/PostgreSQL persistence. Only the protected
system Super Admin with `admin.access` can use it. Demo Roles and staff business
labels grant no access. No tenancy, new credentials, production deployment, or
relationship migration is introduced.

## Operations

Apply explicit Alembic migrations through the existing reviewed initialization
procedure (`sh scripts/initialize-api.sh`); the API never creates tables at
startup. Migration `0010_zones` follows `0009_staff`, creates an empty table and
does not modify accounts, sessions, staff or other master records. Take backups
before operator-approved schema changes. The singleton must already exist or be
bootstrapped using operator-managed initial configuration; never seed a managed
database with synthetic test users. A readiness 503 or unavailable singleton is
a **BLOCKED live-preview prerequisite**, not evidence that synthetic tests failed.
Readiness checks include the Zone schema.

Do not manually downgrade a populated Zone database: dropping the table removes
history. No purging, restore, trash, hard-delete API or retention schedule exists.
Preserve database/audit backups until the operator approves a retention policy.

## API

All endpoints are under `/api/v1/admin/zones`, bearer-authenticated and no-store.
FastAPI OpenAPI is authoritative; regenerate offline libraries with
`python3 scripts/export-api-contract.py` and
`pnpm --filter @workspace/api-spec run codegen`.

| Method / suffix | Purpose |
| --- | --- |
| GET (empty) | Server name/status filters, counts and pagination |
| GET `/{id}` | Non-deleted detail |
| POST (empty) | Create `{name,status}` |
| POST `/{id}/edit` | `{name,status,expected_version}` |
| POST `/{id}/status` | `{status,expected_version}` |
| POST `/{id}/delete` | Soft deletion with `{expected_version}` |
| POST `/import/review?filename=...` | Raw CSV/XLSX body; returns row errors, validity and SHA-256 digest; writes no zones |
| POST `/import/commit?filename=...&digest=...&confirm=true` | Reupload identical bytes; explicit confirmed create-only transaction |
| GET `/export?query=...&status=...&format=csv` | Complete matching export; format is `csv` or `xlsx` |

List/export use `query` (literal case-insensitive name substring, ≤200 characters)
and `status=all|active|inactive`. Filtering precedes pagination. Lists use
`limit=1..100`, `offset=0..1000000` and deterministic newest-created then UUID
ordering; they return `total` (all non-deleted rows) and `filtered` matching rows.
Separate page requests reflect current state, not a frozen historical snapshot.

Names are stripped, 1–200 characters, with unsupported control characters
rejected. PostgreSQL `lower(name)` has a partial unique index for all non-deleted
rows, including inactive zones. Deactivation preserves a visible inactive row.
Soft deletion removes a row from every normal list/detail/export, but retains
its authenticated deleter/time, creator, update metadata and incremented version.
The deleted name may be reused by a distinct new row. Stale expected versions and
concurrent duplicates return explicit 409 errors, never overwrite newer changes.
Actor references are User foreign keys. UTC timestamps and actor identity are
server-owned. Public actor labels derive from the verified backend identity
(`Super Admin`); no email, directory fields, credentials or client actor strings
are projected. Audit events and mutations commit together without record payloads.

## Transfer bounds and compatibility

- File limit: **2 MiB**, enforced by both request middleware layers and streamed
  bytes; upload read deadline 15 seconds. No multipart wrapper.
- Import: **1,000 records**, create-only, all-or-nothing. A review performs no
  writes; commit repeats parser, live identity and duplicate checks. A late
  conflict rolls back every row and its audit events. A digest binds the review
  to file bytes; it is not an authorization credential.
- UTF-8 CSV including BOM; strict quoted-cell syntax.
- Exactly two supported ordered schemas: `Zone Name,Status`, or
  `Zone Name,Status,Created By,Created At,Updated By,Updated At`.
  Status is case-insensitive Active/Inactive. Audit inputs are ignored.
  Correct all row errors before confirmation.
- Genuine `.xlsx` only: exactly one worksheet, at most 1,001 rows including the
  header, six columns and 6,006 cells. Archive bounds: 100 entries, 8 MiB total
  decompressed, 4 MiB per entry, 10,000 characters per cell/XML text node.
  XML is parsed with defusedxml before openpyxl. Formulas, encrypted archives,
  macros, embedded objects, external links, malformed ZIP/XML, binary `.xls`
  and macro-enabled extensions are rejected, never evaluated or fetched.
- Export: complete current name/status matches, up to **1,000 rows** so every
  export can be reviewed/imported into an empty collection under the same bounds.
  More matches return `zone_export_limit` with an explicit request to narrow
  filters, not truncation. Includes readable actor labels and UTC ISO audit times.
  CSV is UTF-8 with BOM; XLSX contains string cells. Correct attachment filenames
  and MIME types are server-generated.
- Portable six-column exports prefix formula-like text (`=`, `+`, `-`, `@`,
  including leading whitespace/control characters) with an apostrophe. Leading
  literal apostrophes are doubled so reimport is lossless. Six-column imports
  undo exactly this portable escaping in the name column; two-column files use
  names literally. Imported records receive new current actor/time metadata.

## Browser-local boundary and failure recovery

The Zone table never reads/writes the legacy `evexia.admin.zones.v1` dataset.
Existing MR, Doctor, Patient and Sales Target demo assignments/snapshots still
refer to those separate browser-local zones. They are not server relationships.
Neither opening Zone Master nor clearing browser data changes backend zones.
Import is the only explicit file-copy path; no local backfill, overwriting,
upsert or synchronization occurs.

Filters/counts/pagination and exports use server predicates. The table refreshes
on mount and focus and has a manual refresh. Add/edit/confirm/import disable
duplicate submissions. Recoverable auth renewal or server failure keeps mounted
drafts. Stale edits require reviewing current server details before an explicit
retry. Ambiguous network saves are never replayed: inspect shared records first.
Deleted or stale confirmation targets require cancelling and refreshing.

## Isolated checks

`pnpm run test:api-foundation` covers migration constraints, independent-connection
races, actor forgery, immutable creation metadata, deletion tombstones, filters,
review/commit rollback, parser bounds and safe export round-trips.
`pnpm run validate:release` runs transport/service checks and authenticated
desktop/mobile Zone browser regressions together with the existing suites.
Fixtures allocate separate local-only databases, listener ports and result
directories; no managed database or real account credentials are changed.
Synthetic success does not prove managed-preview migrations/bootstrap readiness.
