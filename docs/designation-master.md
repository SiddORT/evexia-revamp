# Shared Designation Master

Designation Master is an empty-on-rollout FastAPI/PostgreSQL catalogue. Only the
protected system Super Admin with `admin.access` may read or change it. Zone
staff grants, portal labels, MR and Doctor identities authorize nothing here.
Every service read, write, import confirmation and export revalidates the live
identity/session under locks. No new permission, tenancy, staff foreign key,
payroll calculation, automatic local import or sample seed is introduced.

## Operator rollout (approval required)

Historical migration `0016_designations` created the empty catalogue.
Forward migration `0026_designation_target` follows `0025_vendor_phone` (the
accepted master-form cleanup ancestry). It permanently drops `level`, `basicDa`,
`hra`, `medicalAllowance`, `travellingAllowance`, `specialAllowance` and
`professionalTax` and their dependent checks, and adds the stored generated
Sales Target annual sum. It preserves all retained rows, indexes, audit/history,
Staff/MR labels and permissions. Startup never creates tables or runs migrations.

Before approval, pause writes, take and verify a complete database/audit backup,
record the current migration head, review runtime privileges and rehearse the
forward migration and recovery on an isolated restored copy. Apply the existing
explicit migration/bootstrap procedure in the backend README only after operator
approval. Column removal permanently discards the seven values, including
inactive/deleted history. Back up those values before upgrading. Stop writes
and roll out the migrated database, API and frontend together; old API nodes
must not serve the reduced schema and new nodes require `annual_target`.
Verify liveness and readiness
separately, then log in with the already-provisioned protected account.

This implementation **does not apply migrations to any managed/shared database,
deploy, bootstrap real accounts or change real data**. A managed readiness 503
until approved migration, or a missing protected account, is a **BLOCKED live
preview prerequisite**, not a failed isolated fixture. This migration's downgrade
refuses any populated designation table (including tombstones) before any DDL.
Only an empty catalogue can regain the historical columns, without defaults or
invented values; downgrade cannot restore discarded values. Use a reviewed forward fix or
verified coordinated restore, not a destructive downgrade. Retain backups and
audit evidence pending operator-approved retention.

## Current business fields

- Name: required, 1–200 characters; short name: required, 1–50 characters.
  Both are trimmed and whitespace-collapsed; unsupported control/surrogate
  characters are rejected.
- Name matching uses PostgreSQL `lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))`
  for both import conflict checking and the database partial unique index.
  All non-deleted rows, including inactive rows, reserve their name.
  Deleted names can be reused by a new row without changing historical evidence.
  There is deliberately **no unique short-name rule**.
- Status: `active` or `inactive`; transfer status is case-insensitive.
- The seven retired fields are forbidden live create/edit inputs and are absent
  from responses, forms, listings, search, validation and new downloads.

## HTTP contract

Bearer-authenticated, no-store endpoints under `/api/v1/admin/designations`:

| Method / suffix | Purpose |
| --- | --- |
| GET (empty) | Server search/status/counts/pagination |
| POST (empty) | Create name, short name, status |
| GET `/{designation_id}` | Non-deleted detail |
| POST `/{designation_id}/edit` | Business fields plus `expected_version` |
| POST `/{designation_id}/status` | `status`, `expected_version` |
| POST `/{designation_id}/delete` | Soft-delete with `expected_version` |
| GET `/sample?format=csv\|xlsx` | Exact reduced three-column sample download |
| POST `/import/review?filename=...` | Inert row review, errors, totals, signed digest |
| POST `/import/commit?filename=...&digest=...&confirm=true` | Identical bytes, explicit atomic create-only confirmation |
| GET `/export?query=...&status=...&format=csv\|xlsx` | Every matching non-deleted record |

Search `query` is at most 200 characters, literal case-insensitive substring
matching across name and short name. Status is
`all|active|inactive`. Filters precede pagination; limit 1–100, offset 0–1000000.
`total` counts all non-deleted rows; `filtered` counts matches. Ordering is
newest-created then UUID descending, stable within each request but not a frozen
multi-request snapshot. More than **5,000 export matches** produces an explicit
`designation_export_limit`, never truncation. Import allows 1,000 rows, so larger
exports must be split before round-trip import.

Client audit/deletion/identity/version properties are forbidden. Creation sets
both create/update timestamps and User actor references on the server. Edits and
status changes preserve creation evidence, advance update evidence/version, and
commit session-bound metadata-only audit events atomically. Safe actors are
`Super Admin` or `Backend user`, never email/PII. Soft deletion sets deletion and
update actor/time together and increments version. Repeat deletion returns 404
without changing original evidence. Normal reads/detail/export exclude tombstones.
All mutations require the observed version; stale and duplicate races return
clear 409s. No restore/trash/hard-delete endpoint exists.

## Exactly supported transfer schemas

Current samples use exactly `Designation Name,Short Name,Status`.
Current exports append `Created By,Created At,Updated By,Updated At` (seven columns).
Both formats accept the exact three/seven-column current and ten/fourteen-column
legacy schemas. Unknown or reordered headers are rejected.

The exact ten-column legacy schema, including spelling/case/order, is:

```csv
Designation Name,Short Name,Level,Status,Basic + DA (%),HRA (%),Medical Allowance (%),Travelling Allowance (%),Special Allowance (%),professional tax (Rs)
```

Legacy fourteen-column audit exports append exactly these four columns:
`Created By,Created At,Updated By,Updated At`. Times are UTC ISO strings.
Retained legacy fields are selected by their known header positions, not zipped
against the reduced contract. The seven retired values are ignored, not validated
or persisted (workbook formula/security checks still apply).
Incoming audit cells are ignored; new rows receive the authenticated importer's
current server attribution. Historical audit restoration is never claimed.
Arbitrary `id`, identity, version, deletion or other columns are rejected.

CSV is strict UTF-8 with optional BOM. Exports include a BOM.
Genuine XLSX uses one worksheet. File limit **2 MiB**, import limit **1,000 data
rows**; actual raw bytes are bounded, including requests without Content-Length.
Multipart allows exactly one `file` part, with at most **64 KiB overhead**.
Both request middleware layers retain unrelated upload limits. Stream reading
has a 15-second deadline.

Workbook bounds: 100 ZIP entries, 8 MiB total decompressed, 4 MiB per entry,
14 columns, 1,001 rows including header, 14,014 cells, and 10,000 characters per
cell/XML text node. The shared bounded parser validates ZIP/XML before openpyxl
and distrusts producer-controlled dimensions. It rejects malformed archives/XML,
formulas, external relationships/links, macros, embedded objects and encrypted
archives. No execution or network fetch occurs. `.xls`, `.xlsm` and arbitrary
formats are unsupported.

Review saves no rows/bytes. Its HMAC binds resource, exact bytes, filename/format,
authenticated user and session. Commit reparses and repeats live identity and
current duplicate checks, including duplicates within the batch; all valid rows
and their audit events commit together, or none do. There are no upserts or
partial imports. A new login/file/format requires a new review.

Current seven-column exports escape formula-like name/short-name text
(`=`, `+`, `-`, `@`, including leading whitespace/control characters) with an
apostrophe and double literal leading apostrophes. Current-schema imports undo
exactly that portable escaping, as do legacy fourteen-column audit files.
Three-column samples and legacy ten-column files use literal text.
XLSX export cells are strings. Filename/MIME are server-owned:
`evexia-designation-master.csv|xlsx` and `evexia-designation-template.csv|xlsx`.
CSV is `text/csv; charset=utf-8`; XLSX uses the standard OpenXML spreadsheet MIME.

Samples and exports require durable Download Logs acceptance before release.
They are `designation` / `template|export`, CSV/XLSX, server-prepared evidence.
`X-Download-Initiation` supports uncertain-ack deduplication;
`X-Download-Log` must be present before a browser download. Logs contain no file
content, filenames, search terms or record references and never claim disk completion.

## UI and Staff selector

The list/form no longer read/write the legacy designation store. Server filtering,
counts, pagination, focus/manual refresh, desktop/mobile actions and explicit
CSV/XLSX choice use the landed shared conventions. The existing shared import
screen handles review/confirm. Date/time preferences apply to safe audit details.
Mounted drafts survive same-identity renewal and retryable outages. Duplicate
submissions are disabled. Stale/uncertain mutations require an explicit
authoritative detail/conflict review; writes are never automatically replayed.
Uncertain imports consume their confirmation and require the read-only server
conflict check before any fresh explicit confirmation. Logout/identity changes
discard private data and invalidate async results/download handoffs.

Staff Management requests at most 100 active server choices in one bounded
request on mount/refresh/editor open. More than 100 fails explicitly rather than
silently accepting an incomplete list. Choice failure provides retry, blocks
save and keeps mounted drafts. Editing loads Staff detail independently to hydrate
the saved UUID/name even outside that batch or when inactive/deleted. Staff now
uses required catalogue UUIDs and derived readable names, with unchanged
unavailable references retainable. New/changed assignments require active live rows.
Staff migration `0028_staff_designation_lifecycle` requires complete reviewed
legacy mapping against all catalogue history; no automatic catalogue creation,
staff identity rewrite, payroll or authorization effect is introduced.
See [Staff mapping and lifecycle](staff-security.md) for operator preflight,
explicit overrides, atomic rollout and populated downgrade refusal.

## Isolated verification and contracts

`pnpm run test:api-foundation` includes designation API/parser/lifecycle,
migration-preservation, independent-connection stale/uniqueness/import races,
authorization/forgery, retired-input rejection, atomic rollback and transfer
compatibility. `pnpm run validate:release` includes its protected transport/form
validation and authenticated desktop/mobile/transfer/draft/staff-choice specs
in the existing temporary PostgreSQL/API/Vite harness. Fixtures never use
managed databases or real account credentials.

FastAPI OpenAPI is authoritative. Regenerate with
`python3 scripts/export-api-contract.py` then
`pnpm --filter @workspace/api-spec run codegen`; generated upload callers select
the supported multipart representation while the portal uses raw bytes.
