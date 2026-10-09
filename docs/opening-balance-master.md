# Opening Balance Master: persistence and approved rollout

## Scope and authorization

The Portal and existing FastAPI API use a shared PostgreSQL catalogue. Every
endpoint, including minimal Doctor choices, samples, reviews and exports,
revalidates the active protected system Super Admin inside the transaction.
Opening Balance is **not** a ninth staff permission domain. `admin.access` alone,
a custom role name, MR login or any of the eight master grants cannot grant
access to it. No identity provisioning or role changes are introduced.

This register stores financial-year starting positions only. It does not post
ledger entries, process payments, settle accounts, create Doctor logins, or
derive balances from orders. It has no phone field; Doctor Master keeps its
existing PhoneInput and India/+91 default.

## Record and money contract

- Start year is an integer from **1900 through 9998**. End year is exactly start
  year + 1 (1901 through 9999). Defaults are the calendar year and next year.
  Both selectors support numeric search, keyboard selection, Escape/outside
  dismissal and at most 100 visible search matches in a scrollable menu. Their
  normal rolling window includes valid saved selections outside that window.
  Changing start follows through to end; independently selected mismatches
  must be corrected before save.
- Doctor ID references the existing shared Doctor directory. At most one
  **nondeleted** balance exists per Doctor/start-year pair, across both statuses.
- Amount is **NUMERIC(15,2)**: **−9999999999999.99 through +9999999999999.99**.
  Positive, negative and zero values are accepted. API JSON amounts must be
  strings; plain decimal notation permits at most two fractional digits.
  Excess scale (even trailing third-place zero), scientific notation in JSON,
  overflow, booleans, nonfinite values and binary-float JSON numbers are rejected.
  No application rounding is performed. PostgreSQL numeric storage alone
  normally coerces scale, so all writes must use these validated APIs rather
  than relying on direct SQL to reject excessive fractional precision.
- Responses/export amounts are canonical two-decimal strings. UI grouping is
  string-based, never `Number`/binary floating-point arithmetic. Negative zero
  is canonicalized to `0.00`.
- Created/updated actor and time are assigned by the verified server identity.
  Version starts at 1 and increments for edits, status actions and deletion.
  Soft deletion preserves the row, actor, version and audit event; no restore
  or hard-delete endpoint is provided.

New Doctor references must be active and eligible. Editing may retain the
**unchanged saved** inactive reference, identified by name and registration
number. Inactive references cannot be newly selected. Doctor currently supports
inactivation, not directory soft deletion; the FK preserves saved references
against physical removal. No fictitious Doctor deletion workflow is claimed.
All reference checks and imported registration resolution are repeated under
the same graph lock used by Doctor mutations. Registration resolution is
case-insensitive, unambiguous and never falls back to browser-local IDs.

## API and UI

Base: `/api/v1/admin/opening-balances`.

| Method | Route | Behavior |
|---|---|---|
| GET | base | literal `query`, `status=all/active/inactive`, `limit` 1–100, `offset`; matching and total counts |
| GET | `/references` | minimal name/registration/ID/usable choices; 50 default, max 100; `query`, `offset`, optional saved `balance_id` |
| GET | `/{id}` | live detail with saved-reference identity |
| POST | base | create validated fields |
| POST | `/{id}/edit` | all editable fields plus `expected_version` |
| POST | `/{id}/status` | status and `expected_version` |
| POST | `/{id}/delete` | `expected_version`; soft deletion only |
| GET | `/sample`, `/export` | `format=csv/xlsx`; exports honor identical `query`/`status` predicates |
| POST | `/import/review` | bounded raw bytes or multipart; `filename`; no catalogue writes |
| POST | `/import/commit` | identical file/name, review digest and `confirm=true`; atomic create-only batch |

Literal search covers displayed hyphen/en-dash year pairs, Doctor names,
registration numbers, canonical and grouped amounts; `%`/`_` are literals.
Pages use deterministic created-time/ID order, with independent accurate total
and matching counts. Browser debounce/abort/identity guards reject old responses.
CSV/Excel menu choices export **all matching rows**, not only the current page,
with a **5,000 matching-record cap**; narrow filters if exceeded.

Stale edits/status/deletes receive version conflicts instead of overwrite.
Failed saves retain in-memory drafts. Conflict reload explicitly confirms
discard; uncertain writes require inspecting shared records before new writes.
Same-identity renewal preserves the mounted draft and requires explicit save
retry; logout or identity change removes protected state and rejects late results.

## Import/export compatibility and safety

The shared route is `/admin/masters/import/opening-balance`, with existing
permission-aware tabs, back link, CSV/genuine-XLSX samples, upload/review,
row errors and explicit confirmation. Replacement files and failed commits
invalidate the previous UI review. The server permits one current review per
verified session, expires it after 15 minutes, binds it to actor/session/file/name
using a keyed digest, and consumes it **before** attempting a commit. Failed,
conflicting or uncertain commits need a new review. No uploaded file bytes are
persisted; only short-lived review metadata is stored.
Expiry denies commit; unused expired metadata is currently retained until
replaced in that session. No scheduled purge is introduced in this rollout.

Limits: **2 MiB**, **1,000 records**, one genuine worksheet. No `.xls`, macros,
formulas, external links, ZIP bombs or oversized cells. Review performs no
balance/audit mutations. Explicit commit rechecks duplicate/reference changes
and creates the entire valid batch or nothing. Returned counts reflect actual
insertions. An inactive imported balance still requires an active Doctor.

Supported schemas, exact ordered headers:

1. Legacy five-column local CSV:
   `Financial Start Year,Financial End Year,Doctor Registration Number,Opening Balance,Status`
2. Current nine-column CSV/XLSX: the five fields above followed by
   `Created By,Created At,Updated By,Updated At`.

Incoming audit cells are ignored, not restored or trusted. IDs, versions and
deletion fields are never accepted. Exports can round-trip **as new records**
after eligible old balances have been explicitly soft-deleted; new IDs/actors/
times are assigned. Missing/inactive/ambiguous shared registrations cause row
errors, never local fallback. Existing local files are not read or modified
automatically.

Numeric workbook amount cells are checked against their **original XML decimal
lexemes**, not parser floats. Scientific workbook lexemes are accepted only
when their exact value has at most two fractional digits and fits the bound.
Exports store monetary cells as **text**, preserving long signed values.
Spreadsheet-safe leading apostrophe escaping is explicitly reversed on import
only for the documented escaped patterns. A literal registration apostrophe
without such an escaped pattern is retained. Treat identifiers and long amounts
as text in manually prepared workbooks.

Samples and exports require durable authenticated download-log acceptance
before bytes are released. Failed logging means no download. The Portal
checks the receipt and identity again before handing off the file and blocks
duplicate pending actions. Files contain no credentials/private session
references and cannot restore historical audit identity.

## Rollout: operator approval required

No managed migration, production deployment, live account change or automatic
legacy migration has been performed by this task. The initial catalogue is
**empty**, including for browsers containing old demonstration data.

1. Obtain explicit operator approval, back up the target database and legacy
   browser CSVs, and verify the actual installed Alembic head. This forward
   `0024_opening_balances` migration follows `0023_sales_targets` (after
   `0022_allergen_catalogue` and `0022_vendors`). If further concurrent
   master migrations have landed, reconcile revision ancestry before executing;
   never run competing heads or delete/reset another master's migration.
2. With approval only, apply the reconciled Alembic upgrade through the existing
   operational process. Recheck readiness and restarted API/Portal separately.
   Before approval/the schema upgrade, balance requests may fail closed as
   unavailable; a healthy generic API alone does not prove this schema installed.
3. Ensure the protected Super Admin can log in and desired shared Doctors are
   active with unambiguous matching registration numbers. Resolve mismatches
   in Doctor Master with a separate approved operation; do not create sample
   doctors or automatically promote identity records.
4. Operator reviews a backed-up five-column CSV or prepared current template,
   reconciles row errors and duplicate year pairs, and explicitly confirms the
   valid batch. Compare amounts/counts after import and retain the source backup.
   Do not migrate local payment previews or initialize shared records on page load.
5. Check CRUD across authenticated tabs, current-filter CSV/XLSX downloads and
   download history. Revert software/schema only through approved operational
   procedures; downgrading drops the new catalogue and needs a separate backup/
   destructive-change approval.

## Verification

Disposable fixtures only:

```sh
sh scripts/test-api-foundation.sh tests/test_opening_balances.py tests/test_migration_opening_balances.py tests/test_doctors.py tests/test_product_categories.py tests/test_downloads.py
node --test artifacts/evexia-portal/src/services/serverOpeningBalances.test.js
sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/opening-balances-backend.preview.spec.mjs
pnpm run check:api-contract
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/evexia-portal run build
```

Backend tests use isolated local-socket PostgreSQL; browser checks use separate
API/Portal listeners and results, synthetic credentials and frozen source.
Combined release runs give Opening Balance its own disposable fixture so its
MR-backed Doctor setup does not consume the Doctor/Patient actor's credential
budget. Production rate limits and credential history remain intact.
No configured users or managed database are seeded by these commands. The
browser suite is also included in the existing release entry point.
