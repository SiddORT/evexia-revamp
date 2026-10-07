# Download initiation history

Download Logs is protected, read-only system reporting at `/admin/download-logs`.
Apply forward Alembic migrations through `0014_download_reporting_index` through the existing operator
procedure before rollout. No production migration, bootstrap or backfill is run by
this feature. History begins at rollout and is unrelated to older activity exports.
The database ledger is append-only, with no clear/delete/export/re-download API.

## Meaning and privacy

`server_prepared` means export bytes were successfully prepared, or a private PDF
was verified and authorized, before response/stream release. Private S3 link issuance
is labeled **Private PDF issuance**: it records authorized capability issuance, not
stream delivery. Local grants are not initiation evidence until redemption.
`browser_reported` means a verified browser requested durable acceptance of safe
metadata before handoff to its download manager. Neither is proof of saving to disk.
Network/stream or browser handoff failure after acceptance does not remove or
upgrade an entry. A preparation failure or denial produces no ledger row.

Only catalog source, kind, actual PDF/CSV/XLSX format, provenance, server UTC time,
authenticated actor/session and random initiation key are persisted. Queries expose
safe labels, the normal protected user projection and a public ledger ID; no session,
request, domain-record or file references, original filenames, file contents,
filters/search values, URLs, grants or credentials are returned. No private history
or pending report is persisted in browser storage. Local domain data/rendering stays
on-device. General audit/activity remains independent.

## Release coverage

| Release action | Format | Recorded by |
|---|---|---|
| Zone / Courier / Storage Location filtered export | CSV, XLSX | Server |
| MR / Doctor / Patient master export | CSV | Browser |
| Designation / Vendor / Allergen / Opening Balance / Headquarter / Product Category / Sales Target export and import template | CSV | Browser |
| Staff loaded-record export / Stock Status sample export / PR list export | CSV | Browser |
| Zone / Courier import sample | CSV, XLSX | Browser |
| Storage Location import template | CSV, XLSX | Browser |
| MR / Doctor sample workbook | XLSX | Browser |
| Patient import template | CSV | Browser |
| Sessions / Activity whole-result report download | CSV | Browser (the JSON snapshot builder is not a release) |
| PO invoice, all three layouts, list and preview | PDF | Browser |
| PR receipt, all three layouts, searchable and image-only, list/form/preview | PDF | Browser |
| Authorized private PDF direct download / local grant redemption | PDF | Server |
| Authorized private PDF S3 capability issuance | PDF | Server |

Settings template galleries are **Preview only**, without a standalone
download action. Neither galleries, document previews, export/PDF builders, imports
nor cancelled format choices create initiation rows.

All controlled file release uses `downloadRelease.js`. Its coverage regression
rejects new direct anchor download assignments outside that primitive. New release
actions must add catalog metadata, acceptance and tests before enabling downloads.

## Retries and reporting

Browser releases reuse a memory-only UUID after uncertain acceptance; one accepted
initiation uses one row per authenticated session, and subsequent deliberate
downloads get new UUIDs. Server callers should preserve `X-Download-Initiation`
across retries; response `X-Download-Log` is acceptance evidence, not a save receipt.
An omitted header is a distinct server request, not an automatically deduplicated
client retry. Server master adapters require evidence and never report another row.
Identity generation checks prohibit replay or late handoff under another login,
including another login for the same account. Concurrent duplicate PDF preparations
and local release requests are blocked. Ingestion is limited to 120 new initiations
per session per minute; an identical retry is exempt.

History filters apply in SQL before newest timestamp/UUID ordering and pagination.
The count and page use one SQL statement/snapshot. UTC timestamp ranges are half-open;
UI end days are inclusive by using next midnight. Dates display through existing
Admin preferences. User filtering searches/pages the full protected account directory.

## Verification

Run `sh scripts/test-api-foundation.sh tests/test_downloads.py tests/test_download_queries.py tests/test_download_files.py`
against the disposable local-only PostgreSQL harness. Service privacy/failure and
release coverage tests: `node --test artifacts/evexia-portal/src/services/downloads.test.js`.
The normal release gate includes these new ledger/service and authenticated page
checks, without using managed databases or real accounts.

Large-history plans and timings use `sh scripts/profile-download-search.sh`;
see [download-search-performance.md](download-search-performance.md) for the
synthetic dataset, measured decisions and remaining scaling limits.
