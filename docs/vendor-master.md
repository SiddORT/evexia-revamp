# Shared Vendor Master

Vendor administration uses `/api/v1/admin/vendors` in the existing FastAPI API
artifact and `/admin/masters/vendors` in the Portal. Add/Edit remains a modal.
Only the protected system Super Admin with `admin.access` can use any operation.
Vendor is **not** part of the eight-master staff catalogue; even every staff
master grant does not authorize Vendor. MR and anonymous callers are denied.

## Persistence and separation

Explicit Alembic revision `0022_vendors`, following `0021_master_permissions`,
creates an empty `vendors` table. There are no startup schema writes, sample
seeds, local migration, mirroring, ID remapping, or procurement rewrites.
The old `evexia.admin.vendors.v1` collection and local PO/receipt snapshots,
samples and vendor references remain owned by the legacy services. New server
vendors do not populate demonstration procurement selectors. Explicitly
importing a local backup creates **new** server IDs, not procurement links.

Required business fields: Vendor Name and Contact Person Name (1–200
characters), GST No. (15-character GST format), Registered Address (1–2,000),
Email ID (the established email format, up to 320), and Phone No. Names normalize
whitespace and are case-insensitive live-unique. GST is uppercase and live-unique
across active and inactive vendors. Tombstones do not reserve either value.
Country and status persist; new records default to IN and Active.
IN phones use 10 digits starting 6–9 and accept optional +91 and normal
spacing/dashes/parentheses; US/GB require 10 digits and AE requires 9.
Unknown countries are rejected, never defaulted.

Lists and exports share the same literal, case-insensitive six-field search and
All/Active/Inactive predicates. Pages accept limit 1–100 and offset 0–1,000,000;
query length is bounded to 200. `total` counts all live records and `filtered`
counts all current matches. Every edit/status/delete supplies a strict positive
`expected_version`. Writes revalidate and lock the actor/session and row before
committing. Stale versions fail with `vendor_stale`; live duplicate name/GST
fails with `vendor_duplicate`; deleted/missing details return `not_found`.
Errors never echo submitted values or private actor/session identifiers.

Deletion requires the shared explicit confirmation UI and writes a tombstone,
updated attribution, version and atomic `vendor_delete` audit evidence.
No hard-delete or trash/restore endpoint exists. Authoritative attribution comes
from server account labels, not upload values or browser actor names.

## CSV and genuine XLSX

Import route: `/admin/masters/import/vendor`, selected in the shared import tabs.
Authenticated API endpoints:

| Method | Path (relative to `/api/v1/admin/vendors`) | Purpose |
| --- | --- | --- |
| GET/POST | empty | Paginated listing / create |
| GET | `/{id}` | Detail |
| POST | `/{id}/edit`, `/{id}/status`, `/{id}/delete` | Versioned mutation |
| GET | `/sample?format=csv\|xlsx` | Sample with durable download evidence |
| GET | `/export?query=...&status=...&format=csv\|xlsx` | All filtered matches |
| POST | `/import/review?filename=...` | Inert file review |
| POST | `/import/commit?filename=...&digest=...&confirm=true` | Explicit atomic create |

Upload bodies are bounded raw `application/octet-stream` or one multipart `file`
field. Maximum 2 MiB/1,000 records, with at most 64 KiB multipart overhead and a
15-second read deadline. XLSX must be genuine OOXML, exactly one worksheet;
shared parser limits reject formulas, macros, external links, hostile XML,
encrypted/unbounded archives and understated dimensions. CSV is UTF-8/BOM-aware.
File bytes are never persisted on the app filesystem or in the database.

Accepted exact headers, in order:

1. Six legacy columns: `Vendor Name,GST No.,Registered Address,Contact Person Name,Email ID,Phone No.`
   Explicit defaults: IN and Active; optional +91 is normalized.
2. Current business sample: the six columns plus `Dial Country,Status`.
3. Current full export: those eight columns plus
   `Created By,Created At,Updated By,Updated At`.

Current audit values are ignored on import. IDs, versions, deletion fields,
credentials and private identifiers are not accepted or exported. Spreadsheet
formula-prefix escaping and leading-apostrophe escaping round-trip as inert
ordinary text; XLSX output cells are strings, including phones.

Review returns normalized row values, row errors, valid/invalid counts and an
HMAC bound to resource, actor, logical session, exact bytes and filename. It
saves no vendors. Confirmation reparses, reauthorizes, rechecks duplicates and
commits all records plus audits atomically. A changed file/session or failed
commit consumes the UI review; re-review is mandatory. Lost outcomes require
inspection/current conflict checks before another explicit attempt.

Exports include **all** search/status matches, not the displayed page, capped at
5,000. Larger exports require narrower filters; imports above 1,000 rows require
splitting. CSV/Excel menu opening alone never downloads. Both samples and exports
require a durable server download-ledger acceptance before release and a
single-use browser handoff guard. `X-Download-Initiation` supports retry
deduplication; `X-Download-Log` proves initiation evidence, **not** disk completion.

Recoverable same-route renewal preserves mounted modal/import drafts. Definitive
logout/denial/identity change clears protected data. Failed saves preserve values;
stale conflicts require an explicit reviewed-version/discard decision.

## Operator rollout (separate approval required)

**No managed database migration or deployment was performed by this change.**

1. Obtain operator approval, take the operator-managed backup and confirm the
   target database/settings using the project's normal secrets flow. Do not use
   synthetic fixtures in a managed/shared database.
2. From `artifacts/api-server/backend`, inspect `python -m alembic heads` and
   `python -m alembic current`. Reconcile any concurrently landed Allergen/other
   migration into the real linear head; do not remove its resources or stamp
   migrations without applying them.
3. Apply approved migrations with `python -m alembic upgrade head`. Confirm the
   new catalogue is empty and existing accounts/roles/audit/procurement data
   remain unchanged. Startup does not auto-migrate.
4. Restart the managed API workflow and verify health/readiness. Use an existing
   protected account (bootstrap only under the backend README's approved
   procedure); verify the catalogue from two authenticated tabs and perform a
   small operator-approved synthetic transfer. Deploy only with separate approval.
5. Rollback of a populated catalogue is deliberately refused to preserve live
   and deleted history. Use reviewed backup/recovery, not table removal.

## Verification

Only disposable schemas/databases and synthetic credentials:

```sh
sh scripts/test-api-foundation.sh tests/test_vendors.py tests/test_migration_vendors.py
node --test artifacts/evexia-portal/src/services/serverVendors.test.js artifacts/evexia-portal/src/services/vendors.test.js
sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/vendors-backend.preview.spec.mjs
python3 scripts/export-api-contract.py
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck:libs
```

Browser harness listeners and result paths are isolated; never run a second
fixture on the same ports or edit frontend source during its pass. These checks
are synthetic regression evidence, not proof of a live managed migration or
production readiness. The release gate includes the Vendor checks.
