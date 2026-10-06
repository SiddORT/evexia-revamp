# Activity search performance

## Reproduce without application or production data

From the workspace root:

```sh
sh scripts/profile-activity-search.sh --rows 500000 --output /tmp/activity-search-plans.json
sh scripts/test-api-foundation.sh tests/test_reporting.py tests/test_migration_0008.py tests/test_migration_files.py
```

The profiler initializes a private PostgreSQL cluster with no network listener,
overwrites the configured database URL, applies migrations, and uses only a
synthetic test database. A trap deletes the cluster on completion/failure.
The Python profiler additionally refuses any other database name/socket path or
environment. It never queries an application database. Prerequisites are the
existing PostgreSQL runtime tools and workspace Python dependencies.

The fixture has 500,000 events, 1,000 users, null/deleted actors, invalid legacy
references, browser/server provenance, tied timestamps, common authentication
actions, less frequent browser actions, and rare request references. No real
accounts, credentials, patient records, or history are used.

Both queries return the same public columns. The baseline uses the original
safe CASE/label predicates over the outer join; the optimized query uses the
new candidate branches. Each scenario runs three
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` measurements per query, followed by
an ordered-ID equality assertion. The baseline in the final comparison shares
the new indexes; the original pre-index run also measured about 600 ms for
selective searches. These are warmed, local measurements, not production SLAs.

## Recorded results

PostgreSQL 17.5, x86_64 Linux, isolated UTF-8/C-locale cluster. Recorded
2026-10-06. Times are median execution milliseconds, excluding network/JSON
serialization. Full query plans, buffer counts, estimates, and index sizes are
in [activity-search-plans.json](activity-search-plans.json).

| Scenario | Original predicate | Optimized |
| --- | ---: | ---: |
| Rare request reference | 626.3 | 4.4 |
| Actor label | 649.5 | 1.6 |
| Friendly action: Export generated | 645.5 | 1.0 |
| Friendly resource: Zone Master | 660.6 | 0.8 |
| Unknown/System actors | 627.8 | 1.0 |
| Server-recorded provenance | 688.2 | 1.9 |
| No matching literal | 649.6 | 0.4 |
| Literal percent sign | 2038.5 | 181.8 |
| One-character common search | 0.1 | 0.1 |
| Offset 10,000, common outcome | 264.3 | 81.7 |
| Actor and exclusive UTC range | 0.7 | 0.7 |
| Rare-reference export (limit 5,001) | 616.5 | 3.9 |
| Common-outcome export ceiling probe | 225.1 | 40.8 |

Representative plans:

- Rare request: bitmap index scan on the sanitized-text GIN index finds 20
  candidates, rather than evaluating the joined projection over 500,000 events.
- Friendly action: index-only scan on `(action, created_at, id)` reads 51 rows;
  friendly resource uses the corresponding resource index.
- Actor label: filter the user directory and use the existing actor/history
  index. Missing actors use `NOT EXISTS`, preserving null and deleted actors.
- Broad outcome: reverse scan of the existing chronological index stops after
  the bounded candidate count, then loads only the selected report rows.
- Literal `%`: raw fields cannot contain `%`, so their branch is empty.
  PostgreSQL still chooses an overoptimistic ordered actor join for this
  synthetic case; it scans history without repeating the safe-field/label CASE
  expressions. This remaining 182 ms is not a guarantee for larger datasets.
- Nonselective or non-extractable trigrams cannot universally avoid scanning.
  Very short allowed-character searches keep the original ordered path.

## Why this implementation

Migration `0008_activity_search` adds a versioned immutable SQL function that
projects only safe raw event fields into a delimiter-separated string, a
lowercase trigram GIN index, action/resource chronological indexes, and
single-expression statistics followed by `ANALYZE`. Alias labels remain in
the existing explicit Python mappings, not duplicated in persisted index text.
The extension's actual namespace is resolved when creating the index, including
in disposable schemas whose search path excludes `public`.

An initial implementation redundantly rechecked every safe-field CASE after
the indexed predicate. Rare queries became fast, but broad deep/export queries
regressed to approximately 800–920 ms because the planner underestimated that
combined predicate and sorted a full scan. Expression statistics plus removal
of that logically redundant recheck restored ordered early termination.

Removal is safe because every raw field is sanitized before indexing and none
can contain the `|` separator. An escaped literal without `|` cannot cross a
field boundary. A disallowed ASCII character cannot match a raw field at all.
Unicode folding remains PostgreSQL's responsibility. Actor and friendly-label
branches still use their explicit original matching semantics.

Each branch applies the same actor/date filters and takes its newest
`offset + limit + 1` rows. Their deduplicated union must contain the global top
that many rows: a globally qualifying row cannot have more preceding rows in
any individual branch than globally. Final ordering remains
`created_at DESC, id DESC`, with the unchanged bounded offset and page limit.
The export calls the same repository function with 5,001 rows as its ceiling
probe; overflow still fails without returning partial data.

## Correctness and operations

Regression checks compare the optimized path directly to the original
projection for every friendly action/resource label, provenance, unknown and
deleted actors, combined date/actor filters, wildcard and escape literals,
Unicode, invalid legacy text, cross-field strings, duplicate branch matches,
and tied timestamps. API checks exercise offset 10,000, exactly 5,000 export
rows, 5,001-row rejection, authorization, and portable-export privacy.
Upgrade/downgrade/upgrade tests retain synthetic history and verify function
sanitization and index presence.

The full isolated backend run had **175 passing tests and one unrelated
failure**: `test_auth_lifecycle_refresh_reuse_and_password_revocation` in
`test_api.py` expects HTTP 204 for a password change with an access token
invalidated earlier by session replacement/refresh reuse; the backend returns
401. Authentication code was not changed here.

The new indexes occupied approximately 165 MiB for this fixture (GIN 94 MiB,
action 28 MiB, resource 42 MiB). Synthetic insertion plus analysis took about
52 seconds with indexes already present; this is not a measured baseline write
overhead. GIN maintenance increases storage/write costs. Standard transactional
index creation can block writes on populated histories; plan an appropriate
maintenance window for large installations. `pg_trgm` must be available and
the migration role must have extension/index/function privileges. Failure is
explicit, not a silent search fallback.

The development-only migration was applied and the API workflow restarted.
No production migration, deployment, real-data profiling, or startup-time DDL
was performed. Downgrade removes only the new statistics/indexes/function,
retaining audit history and the potentially shared `pg_trgm` extension.

Do not replace an immutable sanitizer's body in place: change its version and
rebuild the dependent index/statistics when its projection changes. The GIN
index/function/statistics are Alembic-managed, not provisioned by ORM
`create_all`. Keep future migration generation aware of these DDL objects.
