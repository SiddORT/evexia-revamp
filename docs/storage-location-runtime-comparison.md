# Structured Storage Location / PO rollout status

## Requested execution boundary

No tests, typechecks, builds, release suites, validation scripts, broad
development preflight/verification, schema activation, key changes or production
deployment were run for this implementation. API contract export, direct Orval
generation, generated-constant ordering and generated-file formatting were
authoring operations only; the normal codegen script's chained typecheck was
not invoked. Existing browser assertions were updated but not executed.

The frontend workflow was restarted to serve the edited frontend and freeze its
passive release metadata. The API workflow was **not** restarted through
`scripts/start-development-api.sh`: that launcher invokes database synchronization,
which is outside this task's read-only exception. No synchronization or migration
command was run to clear a mismatch.

## Bounded read-only comparison (2026-10-17)

The final comparison requested only:

- The actual development preview's `/release-runtime.json`.
- The actual development preview's `/api/v1/version`.
- `SELECT version_num FROM public.alembic_version ORDER BY version_num LIMIT 8`
  using the application's configured database connection.

HTTP reads had a four-second timeout and a 16 KiB response bound. The PostgreSQL
transaction was explicitly read-only, with a three-second connection timeout,
three-second statement timeout and one-second lock timeout. The entire comparison
had a 22-second process deadline. No business rows, keys, credentials, required
column probes, encryption checks, readiness endpoint, or compatibility endpoint
were read. An initial comparison preceded a small listing-recovery improvement;
only the final served-identity/revision comparison below describes the final UI.

| Component | Actual evidence | Conclusion |
| --- | --- | --- |
| Served frontend | Development metadata, contract `evexia-preview-2026-10`, expected schema `0041_location_geography` | Reachable, expects the new structured-location schema |
| Loaded backend | `/api/v1/version` returned **HTTP 502** | Unreachable; its loaded expected revision/source cannot be established |
| Configured database | One recorded revision: **`0040_po_tax_basis`** | Does not match frontend's expected `0041_location_geography` |
| Implementation declaration | `0041_location_geography` | Candidate requirement only, not proof of running API identity |

Final served frontend identity:
`c2b2b01eddcc78f8026fee6d58e7a50b4312704d6738ff067bfe66dcfb043450`.

The frontend metadata expects backend source identity:
`78a9aea8fe7ca1ee28f19cdf5d3cb833ca8dbf45e7ca1a74c552ee2b4396402a`.
No matching loaded backend identity was available. These are non-secret source
hashes, not credential values.

**Result: NOT COORDINATED / activation blocked.** The frontend/database revisions
disagree, and the API is unreachable. No synchronization, release-gate success,
live authenticated functionality, postal-provider delivery or cross-browser
behavior is claimed. Git state and migration files alone are not runtime evidence.

## Operator boundary

`0041_location_geography` is additive and explicitly `operator_only` in the
migration policy. It creates empty geography for existing locations, not a
geographic backfill, and does not recalculate any saved order. Applying it needs
separate operator approval and coordinated rollout/recovery planning; inspect
the actual target and any pending predecessors first. Existing signed/pinned
release and fresh-install review metadata were not rehashed or expanded to
authorize this successor. Do not weaken the automatic release policy, stamp a
database, apply migrations or replace keys to make this comparison pass.
