# Shared Sales Target Master

## Scope and identity boundary

Sales Target Master uses authenticated FastAPI/PostgreSQL records, not the
browser-local Sales Target/MR/Zone demonstration stores. Nothing automatically
migrates, seeds, mirrors or rewrites those old stores. Their IDs cannot identify
shared targets. Explicit seven-column CSV backups can be reviewed and imported
only when Employee Code resolves to a saved server MR.

Only the protected system Super Admin may use these APIs. `admin.access` alone
is insufficient for a non-protected identity. Sales Target is deliberately not
an assignable domain in the eight-master staff catalogue. MR self-service,
achievements, commissions, payroll and broader reports are outside this feature.

## Financial-period and monetary contract

- One live target per server MR and financial start year, including inactive
  targets. A partial unique PostgreSQL index enforces this atomically.
- `startYear`: integer 1–9998; `endYear`: integer exactly `startYear + 1`.
  Default is the current April–March financial year. These are the only period
  fields/filters; there are no creation/update-date filters or target dates.
- `q1`–`q4`: exact decimal **strings**, each 0–999,999,999,999.99 inclusive,
  with at most two fractional digits. Float JSON values, exponents, negative
  values and excess precision are rejected rather than rounded.
- Amounts are stored as unconstrained PostgreSQL `NUMERIC` with explicit
  nonnegative, maximum and `amount = trunc(amount, 2)` checks. Fixed-scale
  `NUMERIC(p,2)` would round excess input before the check could reject it.
  Server sums use Decimal/SQL numeric arithmetic; browser previews use BigInt
  cents. Annual totals can exceed the per-quarter maximum without float loss.
- Status is `active` or `inactive`. Zone and headquarter are derived from the
  saved server MR, never accepted as editable target input.
- Add/edit requires a live MR with live zone/headquarter references. Reference
  status may be inactive; deleted/missing references cannot create new targets.
  Already-saved target history remains readable if a linked reference is later
  soft-deleted. Derived reference labels reflect the current saved directory.
- Create/update actor labels and timestamps are server-owned. Version starts
  at one; edits/status/delete require the expected version. Soft deletion retains
  target fields, actor/session audit events and deletion evidence, but removes
  the target from normal lists, summaries and exports.

## API

All routes are under `/api/v1/admin/sales-targets`:

| Method/route | Contract |
| --- | --- |
| `GET /` | `query` (literal MR name, ≤100 chars), `status`, `zoneId`, `mrId`, financial `startYear`, financial `endYear`; `limit` 1–100 and nonnegative `offset` |
| `GET /choices` | Bounded live MR/zone choices: MR `query`, optional `zoneId`, `limit`, `offset`; separate `zoneQuery`, `zoneOffset`. Saved historical and rolling default financial years are included. |
| `GET /{id}` | Current target detail with derived references, version and server audit |
| `POST /` | `mrId`, consecutive integer years, four decimal strings and status |
| `POST /{id}/edit` | Full editable fields plus `expected_version` |
| `POST /{id}/status` | `status`, `expected_version` |
| `POST /{id}/delete` | `expected_version`; confirmed client action, soft deletion |
| `GET /sample?format=csv\|xlsx` | Authenticated downloadable template |
| `POST /import/review?filename=...` | Bounded raw file bytes or one multipart `file`; review writes no targets |
| `POST /import/commit?filename=...&digest=...&confirm=true` | Explicit create-only, fully revalidated, atomic batch |
| `GET /export?format=csv\|xlsx` | Same filters as listing, all matches, maximum 5,000 targets |

Listing returns `items`, `total` (all live records), `filtered`, `limit`,
`offset` and `totals` with exact `q1`–`q4` and `total` decimal strings covering
**all matches**, not just the page. Zero matches return zero totals. MR/zone
choices are independently searched/paged; the form never downloads an entire
directory. Year controls merge server historical years with the saved/draft
period so labels are retained.

The browser uses explicit Apply/Reset for status/zone/MR/year filters and
live debounced MR-name search; changes reset pagination. Changing the draft zone
clears the selected MR. Aborted/obsolete results cannot replace newer filters.
Mutation buttons have pending guards. A stale editor preserves its draft and
requires an explicit discard/reload before adopting newer server values; it
never silently rebases old fields onto a new version.

## Transfers and download evidence

Current template order:

```text
Employee Code,Start Year,End Year,Q1,Q2,Q3,Q4,Status
```

Current exports append:

```text
Created By,Created At,Updated By,Updated At
```

These exact eight-/twelve-column schemas round-trip through CSV and genuine
`.xlsx`. The previous exact seven-column schema (without Status) is explicitly
accepted with status defaulting to `active`. Imported audit text is ignored;
it never becomes authoritative actor history. Template Employee Code is a
placeholder that must be replaced with an existing server MR code.

Imports are limited to 2 MiB and 1,000 rows. UTF-8 CSV and a single inert
worksheet are supported; malformed/oversized archives, encryption, macros,
formulas, external links and unsupported workbook features fail closed.
Workbook monetary cells are validated against raw XML numeric lexemes, not
parser floats. Human-visible row errors identify missing/deleted MR references,
invalid years/amounts/status and duplicate MR/financial-year pairs, including
duplicates within a file and inactive server targets.

Review is digest-bound to the exact file bytes, filename and authenticated
identity/session. Commit rechecks references and live uniqueness within one
transaction; no upsert, partial import or implicit confirmation exists. File
replacement or any failed/conflicting commit consumes the previous review.
Late review/identity responses are ignored. Safe same-route session verification
keeps selected-file/editor drafts; a new login requires fresh review.

Both samples and exports require durable download acceptance under
`sales_target`/`template` or `sales_target`/`export` before bytes are handed off.
CSV is UTF-8 with BOM and escaped text; XLSX cells preserve exact decimal text.
The UI records browser handoff evidence separately and does not claim a file
was saved to disk. Export data opens a keyboard-accessible CSV/Excel menu, with
Escape/outside dismissal and trigger focus return; there is no separate format
selector.

The prepared import route is `/admin/masters/import/sales-target`, with back
navigation, master tabs, sample/upload cards and a row report. It is backend-owned
navigation metadata, not a mock template. Other import routes retain their
permission boundaries.

## Explicit rollout

`0023_sales_targets` follows `0022_allergen_catalogue` and creates an **empty**
table, constraints and indexes. It does not alter or provision identities, staff
permissions, existing master data or local browser records. Downgrade refuses
to drop the table when any target/audit-bearing target history remains.

**No managed migration or production deployment is authorized by this change.**
The operator must first approve the environment, backup/recovery procedure and
the complete prerequisite migration chain, then apply the usual reviewed
Alembic upgrade procedure. Startup never creates tables. Existing protected
account/bootstrap and shared MR/zone/headquarter prerequisites must be ready.
After the approved rollout, separately verify `/api/v1/health/readiness`, protected
login, empty/new Sales Target listing and the authenticated transfer routes.
Until the schema and identity prerequisites are ready, managed readiness is
**BLOCKED**, not proof of production readiness. Reverting frontend code alone
must never drop retained target/audit history.

## Isolated verification

These commands use disposable PostgreSQL/API/browser fixtures, not configured
managed account credentials or databases:

```sh
sh scripts/test-api-foundation.sh tests/test_sales_targets.py tests/test_migration_sales_targets.py tests/test_vendors.py tests/test_migration_vendors.py
node --test artifacts/evexia-portal/src/services/serverSalesTargets.test.js artifacts/evexia-portal/src/services/salesTargets.test.js
sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/sales-targets-backend.preview.spec.mjs artifacts/evexia-portal/tests/vendors-backend.preview.spec.mjs artifacts/evexia-portal/tests/zones-backend.preview.spec.mjs
python3 scripts/export-api-contract.py
pnpm --filter @workspace/api-spec run codegen
sh scripts/check-api-contract.sh
pnpm --filter @workspace/evexia-portal run build
```

Backend tests exercise database constraints, concurrent duplicate creates,
version races and concurrent atomic imports; authorization denial; exact money;
reference changes/deletion; aggregate/export agreement; transfer bounds;
legacy/current CSV/XLSX and raw monetary workbook precision. Browser tests cover
authenticated persistence, searchable historical years, quarter drafts, stale
edits, status/delete confirmations, all-match pagination/summary/exports, prepared
import review/commit and file/session ownership in desktop/light and mobile/dark.
The release scripts include these suites alongside existing master regressions.
