# Sales Target scale budget

## Safe reproduction

Run from the workspace root:

```sh
sh scripts/test-api-foundation.sh tests/test_sales_target_performance.py -s
```

The runner creates a private, disposable PostgreSQL cluster with no network
listener and overrides configured database credentials. The scale fixture also
requires `APP_ENV=test`, the test database name, and the runner's private `/tmp`
socket prefix. It never seeds or queries real application records.

The fixture uses 5,000 distinct MRs, zones, headquarters and audit users. It
includes a soft-deleted MR/zone/HQ, both actor label variants, maximum exact
quarter amounts, inactive targets, two financial years, and tied timestamps
requiring the ID ordering tie-breaker. Every measurement expunges the session
identity map so cached references cannot hide round trips.

## Measurements

Observed on the same workspace's disposable PostgreSQL (seconds, including
authorization and encoding but excluding fixture creation and file decoding):

| Scenario | Before SELECTs | After SELECTs | Before seconds | After seconds |
| --- | ---: | ---: | ---: | ---: |
| All-match summary, first 100 | 506 | 6 | 1.798 | 0.086 |
| All-match CSV, 5,000 | 25,003 | 3 | 30.990 | 0.329 |
| All-match XLSX, 5,000 | 25,003 | 3 | 36.304 | 4.700 |
| Broad-name CSV, 5,000 | 25,003 | 3 | 27.767 | 1.233 |
| Broad-name XLSX, 5,000 | 25,003 | 3 | 30.854 | 2.714 |
| Year/status summary, 100 of 834 | 506 | 6 | 0.432 | 0.406 |
| Year/status CSV, 834 | 4,173 | 3 | 4.195 | 0.155 |
| Year/status XLSX, 834 | 4,173 | 3 | 9.384 | 0.459 |
| Name/year/status/zone CSV, 1 | 8 | 3 | 0.029 | 0.070 |
| Empty CSV | 3 | 3 | 0.019 | 0.091 |

Timing varies with runner contention; these observations are not a production
latency guarantee. The regression gates are at most **6 SELECTs per summary**,
**3 per service export**, and **15 seconds per operation** on this isolated
fixture. HTTP download logging is checked separately and is not included in
the service query-count ceiling.

## Preserved contracts

- Aggregates/counts cover every match, not just the page or export slice.
- Name, financial-year, status, zone and MR predicates are unchanged, as is
  descending creation-time/ID order.
- Display references are joined without live-only conditions, preserving
  soft-deleted history. Fresh protected singleton authorization still runs
  before queries; detail and mutation locks are unchanged.
- CSV bytes match independently constructed expected UTF-8 BOM/CRLF rows.
  XLSX decoded cells must match those same strings and be text-typed. ZIP
  timestamps make whole-workbook binary identity unsuitable as a regression.
- Decimal strings stay exact, including aggregates beyond individual input limits.
- The real 5,000/5,001 boundary and HTTP durable/idempotent download acceptance
  are exercised. A failed over-cap request must not write download evidence.
- XLSX uses write-only text cells to avoid repeated worksheet scanning.

## Index and migration boundary

No indexes, schema, or migrations changed: the measured overhead was per-record
reference resolution and worksheet construction, not a demonstrated missing
index. Any future index proposal needs separate query-plan review and operator
approval before a managed migration. Do not load-test a live database or import
real records into the benchmark.
