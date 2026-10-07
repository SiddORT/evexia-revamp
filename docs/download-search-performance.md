# Download Logs large-history profiling

## Reproduce safely

```sh
sh scripts/profile-download-search.sh --rows 500000 --runs 3 \
  --output /tmp/download-search-500k.json
sh scripts/profile-download-search.sh --rows 1000000 --runs 3 \
  --without-format-index --trial-format-index --output /tmp/download-search-1m.json
sh scripts/test-api-foundation.sh \
  tests/test_downloads.py tests/test_download_queries.py tests/test_download_files.py
```

The shell harness creates its own PostgreSQL cluster under a private random
`/tmp/evexia-download-profile.*` directory, with **no TCP listener**. It replaces,
rather than inherits, the database URL. The Python harness additionally refuses
any environment, database name or socket prefix other than this disposable
test setup. A shell trap stops and deletes the entire cluster on exit.
It never queries managed, development application or live history databases.
Only existing workspace Python dependencies and PostgreSQL tools are needed.

The synthetic dataset contains 1,000 users and expired sessions, every supported
browser/server source-kind-format combination, email fallback identities, a rare
actor, a literal `%_` actor, invalid legacy source/kind strings, both provenances,
and groups of four rows sharing each timestamp. All accounts and records are
synthetic; no actual credentials, patient details or download contents are used.

The retained baseline is the original wide, multiply referenced CTE query.
Every scenario runs three `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` measurements
per query, followed by equality of **all public projection columns, total and
ordered IDs**, not just counts. An empty sentinel row is compared by its total;
it is never a returned item. The profiler emits complete SQL/plans/timings.
It covers broad/rare/absent searches, ASCII and Unicode, escaped literals,
fallback labels and hidden metadata, all formats, user and exclusive UTC
filters, combinations, deep pages and offsets beyond the result set.
Recorded timings, index sizes, settings and representative full plans are in
[download-search-measurements.json](download-search-measurements.json); the CLI
output contains the complete plans and SQL for every scenario.

## Recorded measurements

Recorded 2026-10-07 on PostgreSQL 17.5, x86_64 Linux, UTF-8/C locale,
`work_mem=4MB`, `shared_buffers=128MB`, two parallel workers per gather.
Times below are median database execution milliseconds, not HTTP latency.
These are local, warmed synthetic measurements, **not production SLAs**.
The fixture is analyzed after bulk insertion, without a forced vacuum, so it
also measures heap access before the visibility map is fully populated.
The first table isolates the query change **before** the new format index.

| Scenario | 500k original | 500k optimized |
| --- | ---: | ---: |
| First page, all history | 924.9 | 45.0 |
| Offset 499,925, all history | 1,427.0 | 161.1 |
| Offset beyond history | 1,545.8 | 157.2 |
| Broad public label: Master | 603.6 | 70.9 |
| Master, offset 100,000 | 867.5 | 125.4 |
| Rare public label: issuance | 250.8 | 60.0 |
| Rare actor | 262.0 | 62.3 |
| Broad actor | 1,023.3 | 77.8 |
| Email fallback actor | 248.7 | 72.8 |
| No match | 245.1 | 164.7 |
| Literal `%_` | 665.1 | 63.3 |
| One-character search | 1,133.5 | 77.5 |
| Legacy fallback: Download | 248.9 | 251.5 |
| PDF filter | 173.6 | 28.2 |
| CSV filter, offset 100,000 | 920.0 | 72.1 |
| XLSX filter | 212.9 | 28.9 |
| User filter, offset 100 | 1.7 | 0.8 |
| Exclusive UTC window | 7.0 | 1.2 |
| Search + user + UTC + CSV | 1.2 | 1.2 |
| Server-prepared provenance | 381.2 | 55.8 |

## Query decisions and guarantees

- Count only narrow ledger data. Do not compute account eligibility or every
  friendly display label for all matches. Load user display/state and labels
  only after the ordered page has been selected.
- Use `NOT MATERIALIZED` on the shared filtered CTE. PostgreSQL can choose a
  parallel count path and a separate backward chronological index scan for
  the page, without writing the whole matched public projection to temporary
  storage. The global chronological index remains useful at deep offsets.
- Search the small live alias catalog once using PostgreSQL literal matching,
  then match its keys. Search the user directory once and test actor membership,
  rather than joining all ledger rows just to evaluate identity text. This
  preserves PostgreSQL case/collation semantics, including Unicode, and avoids
  duplicating labels in persisted index text.
- Catalog keys are not new searchable public fields. Unknown source/kind values
  still match only their safe `Download` / `System` fallback labels. `%`, `_`
  and `/` stay escaped literal input. Only the existing public identity label
  (`username`, falling back to email) is searched.
- The count and page remain in **one SQL statement and one MVCC snapshot**,
  including an empty page. No cached or approximate total is introduced.
  Timestamp descending followed by UUID descending remains the complete order.
  Offset pagination is a live view: subsequent appends can move positions
  between separate requests; it is not a multi-request frozen snapshot.
- The protected Super Admin dependency, initiation writer, append-only trigger,
  returned metadata allowlist and request limits are unchanged.

### Measured format index

The one-million-row disposable A/B trial adds only
`(format, created_at, id)` after completing the no-index measurements. This
matches a format equality filter followed by the existing stable sort, and
keeps exact counts independent of the much wider display projection.

| Scenario (1m) | Original | Query only | Query + format index |
| --- | ---: | ---: | ---: |
| First page, all history | 1,959.2 | 78.3 | 57.1 |
| Offset 999,925, all history | 2,804.5 | 513.3 | 359.6 |
| Past end | 2,642.2 | 352.2 | 365.6 |
| Broad label | 1,316.7 | 137.0 | 133.5 |
| Broad label, offset 100,000 | 2,211.8 | 233.5 | 216.7 |
| Rare label | 615.4 | 132.2 | 126.7 |
| Rare actor | 616.2 | 169.4 | 105.5 |
| No match | 547.5 | 468.3 | 403.8 |
| Legacy fallback label | 591.0 | 572.3 | 557.6 |
| PDF filter | 346.9 | 59.1 | 18.9 |
| CSV filter, offset 100,000 | 1,886.1 | 113.8 | 99.7 |
| XLSX filter | 436.5 | 53.6 | 16.9 |
| User filter | 3.1 | 0.6 | 0.7 |
| UTC window | 7.1 | 0.9 | 0.9 |
| Search + user + UTC + CSV | 1.3 | 1.3 | 1.4 |

The new index occupied 49,692,672 bytes (47.4 MiB) at one million synthetic rows.
PDF/XLSX plans changed from parallel heap scans to index-only count paths and
format-ordered page paths. The roughly threefold format-filter gain justifies
the additional append/storage cost. Differences for unfiltered, label and actor
cases are warm-cache/planning variation, **not** gains attributed to this index.
Deep CSV improves modestly because its format matches most rows.

A separate 500k run on the final migrated schema again compared all public
results and totals with the original query. It measured 49.0 ms versus 1,000.1 ms
for the first page, 151.6 versus 1,326.5 ms for the deep all-history page,
25.6 versus 167.1 ms for PDF, and 34.4 versus 225.6 ms for XLSX.

No trigram or persisted label index is added: public download labels are a
small live catalog, not unbounded text, and copying identity text into an
append-only ledger would introduce freshness/privacy issues. The existing
actor/time index already serves selective user filters at sub-millisecond
scale; an additional actor index was not justified by these measurements.

Forward migration `0014_download_reporting_index` installs the measured index
and its downgrade removes only that index. Apply it through the existing
operator procedure, not at application startup. It is a normal transactional
index build: on a large ledger it can block append writers while building, so
schedule the migration in an appropriate maintenance window. No application
or managed database migration was performed during this task.

Exact totals require processing all qualifying matches. Common search counts
and deep offsets still grow with history; this work does not claim constant
latency at unlimited scale. Sparse or zero-match searches may read much of the
ledger for both count and page. The 500k fallback search showed no meaningful
gain, rather than being hidden by reporting only the best scenarios.

## Correctness and release coverage

`test_download_queries.py` verifies tied-timestamp pages, the maximum allowed
offset, half-open UTC bounds (including equivalent non-UTC input), safe fallback
search and metadata shape. Its concurrency test holds an advisory lock **inside
the read statement after its snapshot exists**, commits a newer row from a
second connection, and then unblocks the read. That read must return the old
count and old page together; the next read must see both new values.

These tests join the normal release gate. Existing download tests also verify
anonymous/regular-user denial, session replacement and logout, idempotent
acceptance, safe ingestion, append-only history and server/private-file release
behavior. No browser test is needed to verify this backend-only query change.
