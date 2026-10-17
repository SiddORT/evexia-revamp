# Release validation setup and profiling

Release approvals and deployment access are unchanged. These changes affect
validation only; they do not contact a production database or the VPS.

## What is reused

Each `validate:release` invocation creates its own owner-only temporary cache.
The first API fixture and first browser fixture each run the original `initdb`
and migration setup. After verifying the exact application revision and empty
users/session/audit tables, the fixture cleanly stops PostgreSQL and publishes
an offline physical copy. Subsequent matching fixtures verify its checksum and
copy it into a **new** private directory before starting a **new** PostgreSQL
process. Physical copies preserve PostgreSQL catalog expressions without a
dump/restore reserialization.

There are no shared writable database files, socket listeners, API/portal
listeners, accounts or authenticated browser contexts across concurrent fixtures.
The bootstrap and password hashing still run for every browser fixture. The
existing dedicated fixtures and credential-provisioning budgets stay separate.
Vite may start alongside Uvicorn, but both original process-identity and HTTP
readiness checks must pass before Playwright starts.

The snapshot fingerprint includes application/migration source, Alembic
configuration, dependency manifests and locks, installed Python dependencies,
Python/PostgreSQL identity, fixture scripts, database kind and the explicitly
overridden synthetic encryption/signing configuration. A changed input causes
a miss. A corrupt or live snapshot is a failure, not a silently accepted cache.
Snapshots are removed at release exit and are never uploaded or cached by CI.
Standalone harness invocations without a release context keep fresh setup.

CI caches only pnpm/uv downloads and matching Playwright engine downloads.
The exact cache key includes schema, locks and synthetic-fixture scripts; there
are no broad fallback keys. Frozen dependency installation and installation of
**all three** browser engines still run. Missing engines and failed assertions
remain failures.

## Coverage

All 51 original release commands, test-file arguments and their ordering are
retained. Backend tests, historical migration rehearsals, encryption, request
boundaries, security assertions and Chromium/Firefox/WebKit configurations are
unchanged. Fresh-install/recovery tests still initialize pristine independent
clusters and never use the snapshot cache. Additional checks cover checksum
rejection, invalidation, private-directory requirements, profiling exit status
and concurrent database-copy isolation.

The date-preferences browser fixture supplies the required Maharashtra
`placeOfSupplyCode: '27'` when creating its synthetic purchase order. The
baseline exposed this missing input before reaching its existing date
assertions. Its order-detail locator targets the grid containing “PO date”
instead of also matching the new tax-summary grid. The expected date and
timestamp values and production validation are unchanged.

## Reproduce and inspect timings

Run serially on the same otherwise-idle runner, with dependencies and required
browser engines available:

```sh
python3 -B scripts/profile-release-gate.py --baseline \
  --output generated-artifacts/release-profile/baseline \
  > generated-artifacts/release-profile/baseline.log 2>&1
python3 -B scripts/profile-release-gate.py \
  --output generated-artifacts/release-profile/optimized \
  > generated-artifacts/release-profile/optimized.log 2>&1
python3 -B scripts/compare-release-coverage.py \
  generated-artifacts/release-profile/baseline.log \
  generated-artifacts/release-profile/optimized.log
```

Create the parent output directory first. Outputs must be new directories.
The profiler reads the current authorization policy's complete command list,
stops on the first failure and records actual return codes. It issues no release
approval. A partial or failed run is not complete validation evidence.

Each run writes `summary.json` for full wall time and `commands.jsonl` for
per-command and nested phase timings. `api:initdb`, `api:migrate`, cache restore,
`preview:bootstrap`, `preview:startup` and each browser matrix are separate
labels. Nested durations overlap; do not sum them as total wall time.
Ordinary `validate:release` runs print their timing-evidence path. CI retains
`release-profile` even after a failure; successful validation evidence is still
created only after every configured gate succeeds.

## Measurements and verification

**Current local verification scope:** The user subsequently requested skipping
browser checks to stop the long local wait. Local browser validation registrations
are therefore omitted, and the registration audit explicitly uses
`--without-browser`. Every non-browser backend, migration, security, service and
policy check remains required. This does not alter the complete CI gate, browser
specs, engine matrix, release-authorization policy, or production approvals.
The latest local completion is **not** full browser verification or fresh proof
of equal executed coverage. The earlier full parity measurement below remains
historical evidence only. Manual `verify` still rejects missing browser receipts;
the local exception cannot produce a complete full-gate report.

The non-browser run also caught the new Storage PIN endpoint using the generic
endpoint-name gate, which did not recognize `postal`. It now uses the same
resource gate as the other master PIN helpers; the shared lookup service still
checks the exact consuming add/edit permission before and after provider I/O.
No permission grant, global operation allowlist or denied-action assertion changed.
Its isolated test cache retains the service's ordered-cache interface rather
than replacing it with a plain dictionary that fails on successful lookups.

Current fresh-install expectations include the exact reviewed geography graph
and retain PO-preservation checks at the now-historical `0040` stage. An uncertain
commit/output acknowledgement withholds exception details, retains the explicit
“do not assume rollback” warning, and never prints initialization success.
Bounded pre-commit operator diagnostics remain intact.
The corrected complete fresh-install suite passed all **62** cases, and all
**11** operator-diagnostic unit cases passed. These are non-browser checks;
they do not reinstate a claim of current browser verification.

The completed measurements below describe the pre-synchronization code snapshot.
After synchronization with newer main-branch changes, the database head became
`0041_location_geography`, exposing an account-encryption allowlist that stopped
at `0040_po_tax_basis`. With explicit user approval, the compatibility fix admits
only that exact geography successor, which does not change account storage.
Both configuration and protected-identifier anchors remain mandatory; missing,
future and multiple heads remain rejected. The full account-encryption test suite,
including seven new readiness regression cases, is now an additional required API
stage. The earlier successful measurements are not passing validation evidence
for this newer snapshot; its required checks must pass independently.

The same successor is explicitly supported by offline directory rotation, with
its original encrypted-field inventory, vendor locks and storage checks intact.
A new real-PostgreSQL regression test freezes rotation at `0040`, upgrades the
isolated schema to `0041`, and verifies/batches/finishes using the same content
digest; this targeted test passed. Unknown future revisions remain unsupported.
Historical Allergen fixtures now seed their actual old column contract and
assert preservation at the original `0036` boundary before separately upgrading
their current-model operational consumer. The affected complete API groups
passed **85** and **49** cases respectively; no assertions were removed.

The targeted successor check passed all 18 account-encryption tests. Restarting
the managed development API also exposed its separate, pending operator-only
`0040` → `0041` database migration. No migration was applied to that database,
and its approval classification was not changed. This preview startup limitation
does not apply to the private disposable release fixtures.

These are local measurements, not a prediction of GitHub runner times. Dependency
installation was already complete locally; its new CI timers and download cache
have not yet been measured on GitHub.

| Measurement | No reuse / serial startup | Independent snapshot / overlapped startup |
| --- | ---: | ---: |
| API setup-only probe: cluster initialization, server start and migrations / restore | 9.265 s | 0.755 s |
| Browser setup-only probe through API/portal readiness | 16.575 s | 5.915 s |
| API schema setup in the optimized release run | — | 1 initialization/migration, 14 cache hits for 15 suites |

The setup-only probes used test collection rather than executing browser
journeys; they are timing evidence, **not** evidence of passing those journeys.
They are individual samples under variable local load, not statistical estimates.
In the longer optimized run, median API restore plus PostgreSQL startup was
about 0.705 s. All 793 backend/migration cases completed successfully.

The original `validate:release` run took **3,853.063 s (64m 13s)** and failed in
the last date-preferences fixture. After the synthetic PO input and ambiguous
detail locator were corrected, that whole three-test fixture passed in
**27.260 s** including startup. All **60** fresh-install/recovery checks then
passed in **163.048 s**, followed by **137** script/operator checks in
**8.141 s**. The successful baseline inventory across these phases contains
350 Node, 853 pytest, 407 Playwright and 163 unittest executions. It includes
the ten added cache/profiling unit tests and repeated existing smoke checks.
This is a repaired, phased baseline, not a claim that the first monolithic run
passed. Failed attempts are retained separately.

The approved bounded local run is now complete: **all 41 required execution
stages and the final coverage verification passed**. Summing successful
validation-command wall times gives **4,446.041 s (74m 06s)**; summing phase
bodies without outer bookkeeping gives **4,421.427 s (73m 41s)**. The repaired
original baseline summed to **4,051.512 s (67m 32s)**. The bounded local run
therefore **did not demonstrate an overall wall-time improvement**. It uses
23 browser fixtures instead of 14 and runs extra setup tests; test execution
also varied under local load. Do not describe this as a measured CI speedup.
The measured improvements are reduced setup work and per-fixture setup time.
The unsplit CI gate keeps its original fixture grouping.

The final coverage comparison passed: **853 pytest and the identical 407
individual Playwright cases** across Chromium, Firefox and WebKit. Node
executions increased from 350 to 386 solely because the nine additional
fixtures each repeat their four bootstrap assertions. Unittest executions
increased from 163 to 172 because nine partition/invalidation tests were added.
Every original non-bootstrap Node group and backend suite is retained.

Two earlier optimized detached runs were lost to workspace restarts; a
monolithic managed validation was stopped by its roughly ten-minute waiting
limit. Those runs are not counted as passes. In the final bounded run, the
Opening Balance group initially encountered three Chromium page-creation
crashes; all nine cases passed on a fresh whole-group execution with unchanged
assertions and `retries: 0`. The failed attempt took another **76.806 s** and
its raw log is retained separately; including it adds that amount to the
bounded-run total. Nothing was waived or silently retried.

Raw profiles and logs are in the ignored `generated-artifacts/release-profile/`
directory; managed validation also retains its own workflow log. The generated
baseline coverage inventory excludes superseded failed attempts only to compare
successful assertion groups; it is not a release certificate. The final
comparison is `generated-artifacts/release-profile/coverage-comparison.json`;
complete current-source stage results are in
`test-results/local-release/summary.json`. Runtime receipts do not authorize
production activation or replace the full CI release artifact.

## Required bounded local validation

The approved local split is generated by `scripts/local-release-checks.py`
from the unchanged full gate and release policy. It assigns every original
non-browser command exactly once, preserves command arguments/environment, and
partitions the default browser spec list into disjoint groups of at most four
ordinary specs. Credential-heavy workflows and all-engine matrices remain
separate. No test selection, assertion, browser project or retry setting changes.

The local validation named `release` now runs the service checks. The other
`release-*` validations run every backend/browser/policy stage, and
`release-coverage` verifies that every required execution check remains
registered with its exact command. It is safe in any scheduling order. These are
all required checks, not optional alternatives to the former monolithic check.
The production/CI policy still invokes `pnpm run validate:release` in full.

Start a new profiling session with:

```sh
python3 -B scripts/local-release-checks.py prepare
python3 -B scripts/local-release-checks.py plan
# Run each registered local validation separately, then:
python3 -B scripts/local-release-checks.py verify
python3 -B scripts/compare-release-coverage.py \
  generated-artifacts/release-profile/before-coverage-inventory.log \
  test-results/local-release/complete.log --partitioned --added-operator-tests 9
```

Each stage really executes on every invocation: receipts are evidence, not a
test-outcome cache. A retry removes its earlier receipt before starting.
Code/dependency changes invalidate the entire session; each fixture's cache
additionally checks its actual synthetic encryption configuration. Browser
workloads are serialized. Only empty, offline schema snapshots are shared
between stages; databases, sockets, listeners and accounts are never shared.
The first scheduled stage prepares a fresh session when needed under the
execution lock; it does not depend on the service stage starting first.
After all execution checks pass, `verify` separately requires current successful
receipts for every stage and combines their logs. The validation service itself
still requires each execution check to pass, not just the registration audit.
Repartitioning adds bootstrap smoke executions, which the comparison reports
separately while requiring identical individual Playwright case identities,
backend suite counts and original non-bootstrap Node groups. The nine new
partition/invalidation unit tests are an explicit addition, not a replacement.
