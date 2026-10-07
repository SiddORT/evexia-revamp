# Courier Partner Master: shared persistence and operations

Courier Partner Master uses authenticated FastAPI/PostgreSQL data, not browser
storage. Clearing browser data does not delete these records. No local samples
are seeded, migrated, mirrored, overwritten or used as fallback. Old local
records remain untouched. To bring an old CSV backup into the new master,
explicitly upload, review and confirm it. Zone and unrelated demo masters retain
their own behavior and datasets. Roles and staff business labels grant no access.

## Initialization and authorization

Apply Alembic `0011_courier_partners` after the actual preceding head
`0010_custom_roles` (following `0010_zones`). It creates an empty courier table, with no existing identity,
session, audit, Zone or Roles data changes. Never create tables at startup.
The operator must apply the migration and ensure the protected system Super
Admin is already bootstrapped before using the live page. See the backend
README's reviewed migration/bootstrap procedure; no live migration or credential
changes are performed by this feature or its tests.

Every endpoint requires the current, active protected system Super Admin with
`admin.access`. Revalidation locks User then AuthSession before courier rows.
Safe audit labels show `Super Admin` (or `Backend user` for non-protected historic
references), not email, actor IDs, staff details, or credentials. UTC times and
actor foreign keys are supplied only by the server. Creation metadata is
immutable through this API. Mutations increment the version and update metadata.
Deletion atomically records deletion time/deleter and retains the database row.
Deleted rows cannot be listed, looked up, exported, edited or reactivated.
There is no restore, hard delete or purge endpoint.

## API

All routes begin `/api/v1/admin/courier-partners`.

| Method / suffix | Contract |
| --- | --- |
| GET (no suffix) | `query` (literal name, at most 200 characters), `status=all/active/inactive`, `limit=1..100`, `offset=0..1000000`. Counts and filters run before stable creation-time/ID pagination. |
| POST (no suffix) | `{name, status}`; returns created record, 201. |
| GET `/{id}` | Non-deleted detail only. |
| POST `/{id}/edit` | `{name, status, expected_version}`. |
| POST `/{id}/status` | `{status, expected_version}`. |
| POST `/{id}/delete` | `{expected_version}`; soft deletion. |
| POST `/import/review` | File body plus `filename` query; returns row validation, validity and identity-bound confirmation digest. Saves nothing. |
| POST `/import/commit` | Same file/name, review `digest`, `confirm=true`; full revalidation and all-or-nothing create transaction. |
| GET `/export` | Same `query`/`status` filters, `format=csv/xlsx`; all non-deleted matches, not the visible page. |

Names are required and bounded to 200 characters after whitespace normalization.
Whitespace sequences are collapsed and ends trimmed; PostgreSQL enforces
case/whitespace-insensitive uniqueness across all non-deleted rows, including
inactive partners. Deleted names can be reused without altering historical rows.
Audit fields, versions and deletion fields are forbidden in create/edit input.
Every edit/status/delete requires a strict positive integer expected version.
Stale attempts return 409 without changing the record. Review current server
details before retrying; a form's draft remains unchanged.

## File contract and limits

- UTF-8 CSV with optional BOM, or genuine `.xlsx`, exactly one worksheet.
- Exact ordered headers: `Courier Partner Name,Status`, or
  `Courier Partner Name,Status,Created By,Created At,Updated By,Updated At`.
- Two-column CSV/Excel templates and six-column CSV/Excel exports are supported.
  Import is create-only. Incoming audit strings are ignored; importer/server time
  establish new metadata. No actor IDs, deletion fields or versions are accepted.
- Maximum file **2 MiB (2,097,152 bytes)** and **1,000 data records** per review
  or commit. Raw requests use `application/octet-stream`. Multipart requests
  allow exactly one `file` field, plus **64 KiB (65,536 bytes)** framing/header
  overhead; no encoded/nested parts or other fields. Filename is a query parameter,
  never a path. The outer request middleware counts actual bytes and limits
  these two exact routes to **2,162,688 bytes**, without raising other request
  or file-upload limits. The endpoint counts actual bytes again, applies a
  15-second read deadline and bounds the extracted file to 2 MiB. Raw bytes
  have no multipart allowance. Generated shared clients select multipart;
  the portal's session-aware transport sends raw bytes. No file bytes are stored.
- Workbook ZIP: at most **100 entries**, **8 MiB total decompressed size**,
  **4 MiB per entry**, **6,006 cells**, **six columns**, **1,001 rows including
  header**, and **10,000 characters per cell/XML text**. Cells and row
  coordinates are independently bounded; understated dimensions cannot hide rows.
  The landed Zone inert workbook validator is reused without changing Zone rules.
- Reject malformed archives/XML, encrypted ZIPs, duplicate entries, formulas,
  macros, embedded objects, external spreadsheet relationships, `.xls`, `.xlsm`
  and unsupported files. XML is parsed with defusedxml, never entity resolution.
  No formula evaluation, remote fetch, or provider connection occurs.
- Review is explicit and inert. The digest is HMAC-bound to file bytes, filename,
  courier resource, authenticated actor and session. On commit, parse and current
  identity/conflict checks run again. Duplicate normalized names in the file or
  database reject the entire batch. Constraint or audit failure rolls back all
  inserted rows and audit events. Re-login requires a new review.
- Export allows **5,000 matching records**. Larger results return an explicit
  `courier_export_limit` error, never truncation. Narrow filters to export.
  Exports above 1,000 rows must be split into supported import batches.
- Exports are attachment-only, no-store, nosniff, with
  `evexia-courier-partner-master.csv` (`text/csv; charset=utf-8`) or `.xlsx`
  (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
  Text that can trigger spreadsheet formulas, including leading whitespace and
  leading apostrophes, is escaped. XLSX cells are explicitly text, never formulas.
  Six-column reimports decode only this documented export escaping convention.

## Failure recovery and verification

The existing `/admin/masters/import/courier-partner` URL and Import data action
open the prepared master-import screen, with Courier Partner selected in the
shared master tabs. Two numbered cards provide CSV/XLSX samples and authenticated
upload/review; the report separates valid and invalid rows. Review saves nothing.
Only an explicit fully-valid confirmation creates records, then clears the file
picker and reports the actual server count. Switching files discards the old
review. Same-route session renewal preserves the selected-file draft; navigation
or a new login cannot reuse an old review.

Export data opens a keyboard-accessible CSV / Excel (.xlsx) menu, not a separate
format selector. Opening or dismissing the menu never downloads. It exports all
current name/status matches, not just the visible page. During a pending download
the trigger remains focusable for menu focus return but cannot reopen or submit
another download. Failures identify the attempted format.

No automatic replay of mutations. On unknown network/save outcomes, inspect the
current record/list before retrying. Stale confirmations are blocked until closed
and refreshed; stale editor drafts can inspect current details before explicit
save. Import failures invalidate review and require review again. Recoverable
failures and same-route session renewal preserve editor inputs; logout or a
definitive identity change removes protected content. Requests verify identity
generation before and after body decoding so late data cannot repopulate it.

Run `pnpm run test:api-foundation` for isolated PostgreSQL migration, API,
parser, database-constraint race and rollback checks. The release gate runs
session-aware service tests and authenticated desktop/mobile Playwright courier
coverage with the existing isolated synthetic harness. Fixture ports and result
directories are isolated; no real credentials or managed databases are used.
Passing these tests does not prove live migration/bootstrap readiness. Check
managed-service readiness separately; report missing live prerequisites as
**BLOCKED**, not passed, and never seed a managed database with test fixtures.

Focused transfer/browser checks:
`sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/couriers-backend.preview.spec.mjs artifacts/evexia-portal/tests/courier-transfers.preview.spec.mjs artifacts/evexia-portal/tests/zones-backend.preview.spec.mjs`.
The transfer checks are also included in the release gate.

### Managed-preview prerequisite check (2026-10-07)

The API and portal workflows started cleanly. A read-only development check
found Alembic at `0009_staff`, with one protected Admin account but neither
`zones` nor `courier_partners` present. The managed readiness probe returned
503. Live authenticated courier verification is therefore **BLOCKED** until an
operator applies the pending ordered migrations through the initialization
procedure. No managed data was seeded, migrated, or changed by this work.
