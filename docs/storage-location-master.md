# Shared Storage Location Master

Storage Location is the name/address/status directory, not Zone Master, private
file storage or stock movement. Only the authenticated protected system Super
Admin with `admin.access` may use it. Business Roles and staff labels grant no
access. It has a separate PostgreSQL table and `/api/v1/admin/storage-locations`
endpoints. Browser-data clearing does not remove server records.

## Initialization and scope

The explicit forward Alembic migration `0012_storage_locations` follows the
actual merged `0011_courier_partners` head and creates an empty table. It does
not seed samples, copy local data, modify existing masters, change credentials,
or run at application startup. Follow the backend README's reviewed operator
migration/bootstrap procedure and backups. No production migration or deploy is
performed by this feature. If the live database has not been migrated or the
protected account has not been initialized, live authenticated verification is
**BLOCKED**; never use synthetic test fixtures to initialize a managed database.
Readiness now checks the storage-location schema explicitly.

Legacy `evexia.admin.storage-locations.v1` records are neither read as fallback,
mirrored, overwritten nor silently migrated by this Master. To copy a saved
backup, explicitly review and confirm its CSV. Allergen, Purchase Order and
Purchase Received continue using the separate browser-local directory and IDs;
server edits here do not change their selections, saved relationships, receipts,
or inventory. Their datasets and services are unchanged.

## API and concurrency

| Operation | Method and suffix |
| --- | --- |
| Paginated list | `GET ?query=&status=all&limit=10&offset=0` |
| Detail | `GET /{location_id}` |
| Create | `POST` with `name,address,status` |
| Edit | `POST /{location_id}/edit` with fields and `expected_version` |
| Activate/deactivate | `POST /{location_id}/status` with `status,expected_version` |
| Soft delete | `POST /{location_id}/delete` with `expected_version` |
| Review/confirm import | `POST /import/review`, `POST /import/commit` |
| Filtered export | `GET /export?query=&status=all&format=csv` (or `xlsx`) |

Names are required, normalized to trimmed single-spacing and bounded to 200
characters. Addresses are required, trimmed/single-spaced and bounded to 2,000
characters. Unsupported control characters are rejected. Status is `active` or
`inactive`. PostgreSQL applies the same lower/whitespace-normalized uniqueness
expression in review and the partial unique index, across all non-deleted rows
including inactive records. Deleted names may be reused by a new UUID.

Search is literal case-insensitive name OR address matching, with `%`, `_` and
backslash escaped. Status and search apply before counting/pagination. Responses
contain `items,total,filtered,limit,offset`; sorting is creation time descending
then UUID descending. Query is limited to 200 characters, pages to 1–100 rows,
offset to 1,000,000. Lists/details/exports exclude deleted rows.

The server owns UUIDs, version, UTC creation/update/deletion timestamps and User
actor references. Creation initializes both metadata pairs; edits, status changes
and deletion increment version while preserving the original creator/time.
Deletion sets deleter/time and updater/time atomically. Repeated delete returns
404 without overwriting the tombstone. Stale writes return `location_stale` 409;
concurrent duplicate names return `location_duplicate` 409. Unknown input fields
including audit, ID, version and deletion fields are rejected; callers supply
only the expected mutation version, not a replacement version.

Every operation revalidates live identity/session under the existing User then
session locking convention. Mutation and safe `location_*` audit events commit
together; events contain resource/actor/session IDs and no address, name or
imported contents. Readable responses project safe authenticated actor labels and
UTC times as `createdBy,createdAt,updatedBy,updatedAt`. UI formatting follows
Admin preferences.

## Transfers

`Import data` and the Storage Location master-import tab both open
`/admin/masters/import/storage-location`. The two-card page provides logged CSV
and genuine XLSX samples, a selected-file draft, server review with row details,
and explicit confirmation. File replacement discards the review; every commit
attempt consumes it, even after conflict or uncertain outcome. Inspect shared
records before retrying an uncertain save. Recoverable same-route session renewal
keeps the selected file; a new login requires fresh review.

`Export data` opens a keyboard-accessible CSV/Excel menu without preparing a
download until a format is chosen. Exports include every current name/address/status
match, not just the visible page. Pending releases keep the trigger focusable but
block reopening and duplicate requests. Server export acceptance is not reported
a second time by the browser; samples retain the existing browser-reported
`storage_location` / `template` initiation metadata. Neither ledger proves a file
was saved to disk. See `docs/download-logs.md`.

Imports accept UTF-8 CSV (optional BOM) or genuine single-sheet `.xlsx`. The
exact supported header arrays, including capitalization and order, are:

```text
Storage Location,Address,Status
Storage Location,Address,Status,Created By,Created At,Updated By,Updated At
```

The first schema supports existing three-column backups. Current CSV and XLSX
exports use the second. Audit cells are ignored, not validated as history or
assigned to records; confirmed imports receive the current authenticated importer
and server times. Arbitrary extra ID/version/deletion columns are rejected.
Statuses are case-insensitive during import. Each row reports name/address/status
validation and duplicates within the batch or existing active/inactive records.

Review saves no locations and returns `rows,valid,digest`. Commit must resend
the exact file with `filename`, returned `digest` and `confirm=true` query
parameters. Confirmation is HMAC-bound to the resource, actor, session, filename
and file bytes. Commit reparses and revalidates the complete batch and current
identity, then creates all rows in one transaction. New conflicts roll back all
rows and audit events. No updates/upserts or historical attribution import.
New login or changed file requires a new review.

Both transfer endpoints accept raw `application/octet-stream` bodies or
`multipart/form-data` with exactly one `file` field and no extra fields or
transfer encoding. Limits:

- Extracted file: 2 MiB (2,097,152 actual bytes), non-empty.
- Multipart overhead: at most 64 KiB (65,536 bytes); request bound 2,162,688
  bytes, enforced by both the request middleware/Content-Length check and
  streamed actual-byte processing. Raw extracted bytes still have the 2 MiB bound.
- 15-second upload reading deadline; at most 1,000 data rows.
- Workbook: at most 100 archive entries, 8 MiB total decompressed bytes, 4 MiB
  per entry, seven columns, 1,001 rows including the header, 7,007 cells and
  10,000 characters per cell/XML text. Cell coordinates are independently
  checked rather than trusting producer-provided worksheet dimensions.

Malformed/duplicate-entry/encrypted archives, unsafe XML, formulas, macros,
embedded objects and external workbook links are rejected before workbook
loading; no evaluation or network access. `.xls` and macro-enabled formats are
unsupported. Existing Zone/Courier workbook bounds retain their six-column
default; unrelated JSON and private-file upload limits are unchanged.

Exports download all non-deleted name/address/status matches, not only the
visible page. The 5,000-record bound returns `location_export_limit` 422 rather
than truncating. Narrow filters if necessary; split exports over 1,000 rows before
import. Filenames are `evexia-storage-location-master.csv` or `.xlsx`, with UTF-8
CSV or the genuine XLSX content type and attachment/no-store/nosniff responses.
Text cells beginning with formula-like prefixes or an apostrophe receive an
extra apostrophe; XLSX cells are explicitly string-typed. The seven-column import
schema decodes this documented reversible escaping for name and address. Legacy
three-column imports preserve their literal text because they cannot reliably
distinguish authored apostrophes from old spreadsheet escapes.

## Browser recovery and verification

Credentials remain memory-only in the existing same-origin session layer.
Writes are not automatically replayed after uncertain outcomes or renewal.
Late responses after logout/identity change are rejected. The Master uses
server pagination/filter counts and mount/focus refresh, loading/retry messages
and disabled pending controls. Add/edit drafts stay mounted during same-route
session renewal and recoverable outages. Stale or uncertain mutations block
resubmission until an explicit authoritative review; that review retains input
and shows current details rather than discarding the draft.

Isolated checks (never point fixtures at a managed database):

```sh
sh scripts/test-api-foundation.sh tests/test_locations.py tests/test_migration_locations.py
node --test artifacts/evexia-portal/src/services/serverLocations.test.js
sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/locations-backend.preview.spec.mjs
pnpm run check:api-contract
pnpm run validate:release
```

API/migration tests inspect retained deleter/time directly and cover duplicate and
stale races, preserved Zone/Courier/identity data, forged metadata, atomic import
rollback, parser limits and portable CSV/XLSX round trips. Desktop/mobile browser
checks cover audit preferences, persistence after local clearing, inactive
filtering, draft recovery, delete confirmation, full-filter transfers and session
renewal/logout. These regressions also run in the release gate. Synthetic test
ports/results are isolated from managed services; fixture success is not a live
managed initialization or deployment check.
