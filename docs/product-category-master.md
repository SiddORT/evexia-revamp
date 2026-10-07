# Product Category Master

## Scope and rollout

This is an empty, shared FastAPI/PostgreSQL directory. The protected system
Super Admin alone has access (`admin.access` plus current protected-identity
checks); MR, Doctor, anonymous and Zone-only staff identities cannot use it.
Business/custom role names do not grant authority.

Migration `0018_product_categories` follows the actual landed head
`0017_headquarters`. It creates only the category table/index; it seeds no
records and changes no users, sessions, headquarters, designations or local
relationships. No managed/shared migration or deployment was performed.
An operator must separately approve rollout, back up the database and review
database roles before running from `artifacts/api-server/backend`:

```sh
alembic upgrade head
PYTHONPATH=. python -m app.bootstrap
```

Bootstrap is the existing idempotent protected-account operation, not a
category seeder. Never use synthetic test fixtures on the managed database.
Apply API/schema together; do not run older application code against a
downgraded schema containing retained data. Downgrade drops this table, so
it is not a data-preserving rollback or restoration procedure.

The existing `services/productCategories.js` and `useProductCategories.js`
remain intact for browser-local Allergen and procurement workflows. Those
local IDs, saved references, inventory and drafts are neither read by the live
screens nor migrated/mirrored to the server. Live category changes do not
affect demo inventory. Clearing browser storage cannot delete live records.

## Data and endpoints

All routes are under `/api/v1/admin/product-categories`, use the memory-only
bearer/session transport, and return no-store responses.

| Method/path | Purpose |
| --- | --- |
| `GET/POST /` | Server-filtered page / create |
| `GET /{product_category_id}` | Independent non-deleted detail lookup |
| `POST /{product_category_id}/edit` | Replace business fields with required `expected_version` |
| `POST /{product_category_id}/status` | Active/inactive with `expected_version` |
| `POST /{product_category_id}/delete` | Soft delete with `expected_version` |
| `POST /import/review` | Row review only; nothing saved |
| `POST /import/commit` | Explicit create-only atomic confirmation |
| `GET /sample?format=csv\|xlsx` | Four-column sample |
| `GET /export?format=csv\|xlsx` | All filtered matches, not just the page |

Create/edit business fields are `name`, optional `description` (default empty),
`unit_price` and `status` (`active`/`inactive`). Text is trimmed and whitespace
normalized; name is 1–200 characters, description 0–2,000, unsafe control/
surrogate characters rejected. Names are case-insensitively live-unique including
inactive rows using the same PostgreSQL lower/btrim/whitespace normalization for
both import duplicate checks and the partial unique index.

Prices are **strings**, never JSON numbers or binary-float calculations.
`"125.5"` and `"0"` are accepted and returned as `"125.500000"` and
`"0.000000"` respectively. Persistence is `NUMERIC(18,6)`: at most twelve
integer and six fractional digits, maximum `999999999999.999999`, minimum zero.
Plain decimal strings only (bounded to 64 input characters); signs, exponents,
commas, non-finite numbers, negatives, overflow and over-precision are rejected
without rounding. Strings preserve the exact value, not the original number
of trailing zeroes. XLSX samples/exports store prices as text. Numeric XLSX
prices are recovered from the validated original XML decimal lexeme, not
openpyxl's binary-float conversion; producer scientific notation is accepted
only when its exact numeric amount fits the same precision/range limits.
Excel may already have rounded a manually entered numeric value: store prices
as text to retain all eighteen significant digits before upload.

Server UTC creation/update times and backend User actor references are
initialized on creation. Updates preserve creation evidence and advance
version/update evidence. The UI displays safe real labels and honors Admin
date/time preferences. All request-owned identity, audit, deletion, ID and
arbitrary version fields are forbidden. Successful writes/import rows and
their safe server audit events commit in the same transaction; uploaded
contents/private identity data are not logged.

Deactivation is an ordinary inactive record. Deletion atomically sets
`deleted_at`/`deleted_by`, advances update evidence/version and retains the row.
Ordinary queries, details, edits, status changes and exports exclude tombstones.
Repeated delete returns not found without changing original evidence. Deleted
names may be reused for new rows. No trash, restore or permanent-delete API/UI.

## Query and failure recovery

List/export share literal case-insensitive `query` (up to 200 characters) across
name, description and decimal price, `status=all|active|inactive`, and inclusive
`min_price`/`max_price`. Either price bound may be omitted or blank; `"0"` is
a real bound. Bounds use the same exact decimal validation; minimum above
maximum returns a useful 422 error. Filters precede counts and pagination.
Ordering is `created_at DESC, id DESC`, limit 1–100, offset 0–1,000,000.
The page includes `total` non-deleted and `filtered` matching counts.
Filter changes reset the page. Export fails explicitly above 5,000 matches;
it never silently truncates.

Stale writes return `409 product_category_stale`; duplicate races return
`409 product_category_duplicate`, with no partial batch. Persistence errors
roll back and never claim success. If a write response is lost/unreadable,
the UI blocks resubmission until authoritative inspection. Edit reconciliation
loads by ID and retains the draft; creation checks current name matches;
import discards its confirmation and requires an authenticated read/new review.
Never replay a possibly committed write. Same-identity token renewal preserves
mounted drafts; identity change/sign-out removes them. Data is refetched on
mount, explicit refresh and window focus.

## Transfer schemas, safety and download evidence

Exact supported legacy header order:

```text
Product Category Name,Description,Unit Price,Status
```

Exact current header order:

```text
Product Category Name,Description,Unit Price,Status,Created By,Created At,Updated By,Updated At
```

No alternate, identity, ID, version or deletion columns. Incoming audit strings
are ignored; imports always assign the authenticated importer/current server
time. Old/current backups round-trip into an empty live collection without
historical author restoration. Spreadsheet-safe exports prefix formula-like
text and leading apostrophes; only current eight-column export imports decode
that documented escaping. Text/formulas are never evaluated or fetched.

Review/commit accept raw `application/octet-stream` or exactly one multipart
`file` part, with required `filename` query parameter. Commit additionally
requires `confirm=true` and the server-issued `digest`. The HMAC binds exact
bytes, filename/format, resource, verified importer and session. Review saves
nothing. Commit rechecks current locked authorization, byte/session binding,
every field and current database/file duplicates; either all valid rows create
or none do. No upsert, partial import, implicit upload save or local migration.

Limits: 2 MiB extracted bytes, 1,000 rows, 64 KiB multipart overhead, actual
request-byte enforcement and a 15-second upload read timeout. Workbook limits
retain the shared single-sheet boundary: at most 100 archive entries, 8 MiB
total decompressed bytes, 4 MiB per member, bounded row/column/cell coordinates
and 10,000-character cells/XML text. Malformed CSV/archives, formulas, macros,
external links, encrypted workbooks, `.xls` and unsupported formats are denied.
Unrelated upload limits are unchanged.

Filenames are `evexia-product-category-master.csv|xlsx` for exports and
`evexia-product-category-template.csv|xlsx` for samples. CSV is UTF-8 BOM
`text/csv`; XLSX is genuine OOXML with its spreadsheet MIME type.
Both require the mandatory server download ledger before release and return
`X-Download-Log`; the client uses `X-Download-Initiation` for safe initiation
deduplication. Evidence means server preparation/browser handoff, not disk
completion. Ledger failures release no file; ordinary staff cannot view global
logs.

## Verification and contracts

FastAPI OpenAPI is authoritative. Run `python3 scripts/export-api-contract.py`,
then `pnpm --filter @workspace/api-spec run codegen` and
`sh scripts/check-api-contract.sh`. The established codegen-only transformer
selects multipart for generated helpers while preserving both accepted formats
in the authoritative contract.

Focused isolated checks:

```sh
sh scripts/test-api-foundation.sh tests/test_product_categories.py tests/test_product_category_files.py tests/test_migration_product_categories.py
node --test artifacts/evexia-portal/src/services/serverProductCategories.test.js artifacts/evexia-portal/src/services/productCategories.test.js
sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/product-categories-backend.preview.spec.mjs
```

These run against disposable synthetic databases/listeners/browser contexts,
never configured credentials/data. Included in the release gate. A live preview
requiring the approved migration/protected bootstrap is **BLOCKED** until an
operator supplies those prerequisites; isolated success does not mean a shared
database was migrated or production deployed.
