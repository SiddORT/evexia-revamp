# Organization retirement verification

## Findings and rollout state

Operator-approved read-only development preflight on 2026-10-10 returned
`verified_read_only` at `0029_role_lifecycle`. Organizations, memberships,
membership-linked users, refresh/audit correlations, dangling audit correlations,
logical retired audit resources, dangling logical resources and unexpected
dependencies were all **zero**. A second read-only run with the stricter
definition/ownership/ACL checks also returned zero unexpected dependencies.
No contacts, payloads, password/token hashes or credential values were reported.

No managed database schema/data operation, recovery export or production
inspection was authorized or performed. Directory-encryption prerequisites,
external-consumer review, retention resolution, durable restricted recovery,
an actual managed-source restoration rehearsal and separate operator rollout
approval remain mandatory. The currently connected development schema is
**not** the new release head. Its readiness endpoint correctly returns 503;
the API process starts and the signed-out portal renders normally.

## Actual verification

All database migration and authenticated-browser tests below use synthetic
disposable PostgreSQL databases and isolated listeners, not managed accounts.

| Command/check | Result |
| --- | --- |
| `pnpm run test:api-foundation` | **869 passed**, 718 warnings, 632.52 seconds. Whole backend suite after historical round-trip recovery reconciliation. |
| Foundation harness: latest retirement, API, Staff rotation and session suites | **90 passed**, 135 warnings, 70.68 seconds. Includes current fail-closed schema-skew guard. |
| Foundation harness: latest retirement suite alone | **24 passed**, 54 warnings, 18.54 seconds. Three later boundary cases supplemented the full-suite run. |
| Foundation harness: merged directory rotation + retirement | **38 passed**, 112 warnings, 53.17 seconds, on the final fix. Covers new-head prepare/batch/finish/verification, a frozen rotation crossing from 0030 to 0031, and repeated verification without leaving a transaction open. |
| Foundation harness: retirement + directory-deletion + historical MR-designation | **32 passed**. |
| Foundation harness: master permissions, roles, staff, designation/target, retirement and role audit assertions | **51 passed**. |
| `pnpm run check:api-contract` | **PASS**, unchanged public OpenAPI contract. |
| `pnpm run typecheck` | **PASS**, canonical workspace/library checks. |
| `PORT=5173 BASE_PATH=/ pnpm -r --if-present run build` | **PASS**, all applicable application builds, including portal and Canvas. |
| `node --test scripts/hoist-generated-zod-constants.test.mjs` | **1 passed**. |
| `python3 scripts/schema_dictionary/generate.py --working-tree` | **PASS**, explicitly unmerged dictionary at actual head `0031_remove_organizations`; 27 application tables, 345 columns, 78 FKs/79 FK column pairs, 2 separately documented infrastructure tables. |
| `sh -n scripts/post-merge.sh`, `git diff --check` | **PASS**. |
| Prior Alembic version files versus Git | **UNCHANGED**; only one new forward revision. |
| API workflow restart/log check | **PASS** process startup; managed readiness **BLOCKED/503** by deliberately unapplied prerequisite/release migrations. |
| Public portal screenshot | **PASS**, rendered signed-out landing page without browser errors. |

Warnings are existing FastAPI/TestClient and Alembic path-separator deprecations,
not skipped assertions. The whole backend run had originally failed historical
downgrades missing external recovery and an unordered audit-row assertion;
both were fixed, and the complete subsequent run passed. A new boundary fixture
initially used an invented `slug` column; it was corrected to the real historical
table contract and the final 90-test run passed.

The retirement suite exercises fresh/populated upgrade, exact downgrade and
re-upgrade, truly absent physical tables/fields and whole ORM table/column
reconciliation, metadata-only rejection-marker idempotence, stale/missing/corrupt
or wrong-target recovery, unresolved retention, absent restoration attestation,
changed retained credential/identity/audit data, unknown constraints/indexes/
views/functions/incoming FKs, injected transactional DDL failure, lock contention,
organization-only recovery without retained users, and predecessor-runtime denial
without false replacement notices. Existing full-suite auth/provisioning/Staff/
MR, soft-deletion, permissions, reporting and master tests run at the physically
organization-free head.

The first completion review identified a merged operator revision allowlist
regression. It was corrected without accepting arbitrary future revisions;
required encrypted projections/lookup indexes and absence of retired plaintext
are verified. Both new-head operation and finishing a previously frozen
predecessor rotation pass. The crossover snapshot compares every retained
value, explicitly requiring the intentionally removed old audit correlation to
have been null rather than ignoring populated history. Final completion review
and the broad configured release command report their own terminal outcomes.

### Completion-gate exception

The second completion review **approved** the reconciled implementation.
The configured `pnpm run validate:release` command started and progressed through
passing backend/node and authenticated-browser checks, but the completion runner
terminated its wait after the fixed polling budget (`POLL_BUDGET_EXCEEDED`,
1800 polls). It did not produce a terminal full-release success. Earlier passing
checks remain evidence for their stated scopes only.

Completion therefore uses an audited validation exception for that runtime
limitation, not a claim that the broad release gate passed. A full uninterrupted
release run outside the completion polling window remains an operator action;
this exception does not authorize database migration or deployment.

### Authenticated browser evidence

The initial tester's command accidentally included a trailing `.` and collected
unrelated specs. It hit its 300-second shell limit after 64 successful tests,
with no application assertion failure before termination. It is **not** a
completed full browser/release pass. Confirmed requested results:

- Activity/reporting: **30 passed**.
- Super Admin authentication/session notices: **10 passed**.

Only unrun requested flows were continued in a tracked background harness:

- Staff permissions + Zone CRUD/import/export/recovery: **20 passed**.
- MR desktop/mobile login/home, import/reset/deactivation and compact filters:
  **4 passed**.
- The two MR assignment tests exposed stale test expectations, not changed app
  source. Explicit “No reporting manager” remains available for an empty result;
  typed assignment rejection is a pre-mutation 409, not a stale-version
  reconciliation workflow. Tests retain unchanged-account/version assertions
  and require explicit reference replacement. The manager/search/paging/layout
  correction passed its targeted rerun.
- Deleted-designation explicit replacement, unchanged account/version and saved
  replacement identity: **1 passed**, 9.0 seconds, on the final typed-409
  expectation. An intermediate test-only assertion incorrectly expected 422;
  the captured actual response and current pre-mutation assignment policy were
  used to correct it. Application frontend source was not changed.
- Eight-master single-action Staff permission matrix: **8 passed** in a separate
  isolated fixture, 1.7 minutes.

All six requested authenticated areas are covered by the completed scoped runs
and narrowly corrected MR flows above. This is not a claim that the initial
interrupted broad browser run finished. The configured completion validation
reports its own terminal result; the broad `validate:release` is not equivalent
to the scoped app build/typecheck commands above.

## Exact changed-file inventory

All backend paths below are under `artifacts/api-server/backend/`.

- Added `alembic/versions/0031_remove_organizations.py`.
- Removed current entity/field mappings in `app/db/models.py`; refactored
  `app/services/auth.py`; coordinated readiness in `app/api/v1/system.py`.
- Added read-only/restricted recovery tooling:
  `app/organization_preflight.py`, `app/services/organization_retirement.py`.
- Preserved merged directory-key rotation at both the encrypted predecessor and
  organization-free head in `app/services/directory_rotation.py` and
  `tests/test_directory_rotation.py`; final storage projection checks are retained.
- Added `tests/test_organization_retirement.py`; current-head assertions adapted
  in `tests/test_api.py`, `test_domain.py`, `test_patients.py`.
- Reconciled historical round trips, without changing historical migrations,
  in `tests/test_migration_0006.py`, `test_migration_zones.py`,
  `test_migration_staff.py`, `test_migration_roles.py`,
  `test_migration_master_permissions.py`, `test_download_queries.py`,
  `directory_test_data.py`. `tests/test_roles.py` now checks exact audit action
  multiplicity without assuming insertion order from unordered SQL.
- Current storage/auth documentation: `README.md`, `STORAGE_CONTRACT.md`.
- Updated the supported-revision/operator guidance in
  `docs/directory-encryption.md` without weakening its custody, permission,
  paused-writer or key-retention requirements.
- Root: `scripts/post-merge.sh`, `scripts/schema_dictionary/generate.py`,
  `scripts/schema_dictionary/purposes.py`, `exports/README.md`, `.gitignore`,
  `.replitignore`, `replit.md`, this document and the rollout guide.
- Supporting verification repair: `scripts/hoist-generated-zod-constants.mjs`,
  its `.test.mjs`, `lib/api-spec/package.json`,
  `lib/api-zod/src/generated/api.ts`; constraint values and validators are
  unchanged and no public contract regeneration was required.
- Reconciled two MR test expectations in
  `artifacts/evexia-portal/tests/mrs-backend.preview.spec.mjs`; ordinary-language
  navigation and application frontend source were not edited.
- Durable non-sensitive lessons in `.agents/memory/MEMORY.md`,
  `codegen-literal-order.md`, `operator-revision-boundaries.md`.

Removed schema objects and intentional surviving reference categories are
enumerated in `docs/organization-retirement.md`. Final source search covers
tracked/untracked application/configuration files, hidden tracked files,
generated clients, current/historical schema exports and uploaded historical
requirements. Historical Alembic/test SQL, recovery tooling, historical
non-promotion explanations and ordinary-language/workspace-package membership
are the only remaining retired-entity references. Historical access-token
`org` denial is retained security compatibility, not authorization lookup.

## Operator recovery limitations

Recovery is outside the workspace, private, integrity-checked, database/schema/
owner-role bound, at most 64 MiB, and exact for the retired rows/correlations.
SHA-256 is not encryption, durability or automatic proof of a restoration
rehearsal. No actual managed backup currently exists from this work. Identity
or correlated-row changes after export deliberately prevent automatic exact
rollback; reviewed reconciliation is required rather than forced restoration.
Original recovery is always required for downgrade, including originally empty
retired tables. Rejection evidence is never removed and no credentials are
reactivated. Previous encryption/history downgrade safeguards still apply.
