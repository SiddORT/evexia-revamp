# Communication candidate verification

Candidate source commit: `d3f91191fe23efe1a278b574dc95bdfcdeeda608`.
Verification began on `bda7102a7538add27d99930a5e685024e2fd07e2`:
its only additional change was an attached requirements document, not application
or migration code. All work remained local; no VPS access, production migration,
deployment, push, real email delivery or production approval occurred.

## Results

| Command | Result |
| --- | --- |
| `python -B -m unittest discover -s scripts/tests -v` | 85 passed |
| `sh scripts/test-fresh-install.sh` | 30 passed, using two isolated socket-only PostgreSQL 17 clusters and real production-mode guards |
| Extended backend command below | Initially 168 passed, 1 historical fixture failure |
| Retirement/catalog rerun below | 62 passed after test-only correction |
| `sh scripts/test-api-foundation.sh tests/test_protected_admin.py` | 14 passed |
| Frontend unit command below | 9 passed |
| Targeted browser commands below | 10 passed: Communication 1, recovery 4, development gate 2, dates 3 |
| `pnpm run typecheck` | Passed |
| `pnpm --filter @workspace/evexia-portal run build` | Passed; existing large-chunk advisory |
| Initial `pnpm run validate:release` | **Not green:** 792 backend tests and 282 Node tests passed before browser setup failed |
| `pnpm run validate:release` after runtime restoration | **Not green:** 792 backend and 282 Node tests passed; Chromium 196 passed, 13 failed; exit 1 before later engine matrices |
| `node --test scripts/test-nix-browser-runtime.mjs` | 8 passed |
| Shell syntax and `git diff --check` | Passed |
| Workflow YAML | Parsed using installed `yaml@2.9.0`; concurrency and main trigger retained |

Initial release failure: `scripts/prepare-nix-download-browsers.mjs` cannot read
the configured Nix Firefox/WebKit dependency source
`/nix/store/q70d15vcgipibv45yxp44hdjfhdmdmg5-playwright-browsers`.
The available replacement Nix bundle contains only Chromium. Downloaded
Playwright Firefox/WebKit executables are present, but their presence is not
proof of a working, matching dependency runtime. No older executable substitution,
engine omission or weakened gate was used to declare success.

The full browser matrix and whole release gate remain required before release
approval. Passing fresh-install tests is not approval to initialize any VPS.

## Follow-up: runtime restored; browser assertions still block release

Declared development Nix dependencies now include `firefox`, `webkitgtk_4_1`,
`libjpeg8` and `mesa`. The `system-packages` adapter discovers their system
library paths through PATH instead of requiring the vanished copied bundle.
It still launches the CURRENT downloaded Playwright Firefox/WebKit engines,
not the installed Nix browser executables. Bundled browser libraries/NSS remain
untouched; only cached ELF process interpreters are adapted to the selected
loader. WebKit explicitly uses Mesa's software EGL vendor for headless rendering.

Firefox 155.0 and WebKit 26.6 both passed launch, page creation and DOM-content
checks using the exact current-driver engine locations. Eight dependency tests
cover missing executables/libraries/Mesa, empty PATH and rebuilt store hashes.

The complete command was rerun:

```sh
node --test scripts/test-nix-browser-runtime.mjs
node scripts/prepare-nix-download-browsers.mjs
pnpm run validate:release
```

The gate passed all 792 backend tests and 282 Node tests, then ran all 209
Chromium cases: 196 passed and 13 failed. These are browser assertions, not the
previous missing-runtime error:

| Spec | Failures | Observed assertion |
| --- | ---: | --- |
| `allergens-backend.preview.spec.mjs` | 2 | Filter summary not focused |
| `order-entry-layout.preview.spec.mjs` | 1 | Selected-patients row not found before timeout |
| `role-urls.preview.spec.mjs` | 2 | Doctor login title / mapped MR account not found |
| `roles-permissions.preview.spec.mjs` | 1 | Next-role control not found |
| `spt-orders.preview.spec.mjs` | 1 | Selected-patients region not found |
| `staff-backend.preview.spec.mjs` | 3 | Native select/ambiguous phone-country locator against searchable controls |
| `vendors-backend.preview.spec.mjs` | 3 | Native option/value expectations against searchable country combobox |

Full output: `/tmp/evexia-release-runtime-restored.log`.
Browser failure contexts: `test-results/evexia-auth-preview.jxaOpS/`.
The normal fail-fast exit prevented subsequent engine matrices and trailing
recovery/development/date stages in this invocation; they are not claimed passed.
The remaining browser assertions were not changed as part of dependency repair.
No CI matrix, test stage, application security or operator approval was removed.
The complete gate must still pass before release approval.

## Commands

```sh
sh scripts/test-api-foundation.sh \
  tests/test_communication.py tests/test_account_crypto.py \
  tests/test_account_inventory.py tests/test_account_identifier_migration.py \
  tests/test_sessions.py tests/test_organization_retirement.py \
  tests/test_organization_catalog.py tests/test_reference_privacy_migration.py

sh scripts/test-api-foundation.sh \
  tests/test_organization_retirement.py tests/test_organization_catalog.py

node --test \
  artifacts/evexia-portal/src/development/releaseState.test.js \
  artifacts/evexia-portal/src/services/communicationSettings.test.js \
  artifacts/evexia-portal/tests/communication-form.test.mjs

sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/communication.preview.spec.mjs
sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/password-recovery.preview.spec.mjs
EVEXIA_TEST_DEVELOPMENT_GATE=1 sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/development-gate.preview.spec.mjs
sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/date-preferences.preview.spec.mjs

bash -n scripts/operator-retirement.sh scripts/initialize-api.sh scripts/test-fresh-install.sh
git diff --check

# Read-only graph inspection, not a database migration:
cd artifacts/api-server/backend
python -B -m alembic heads --verbose
python -B -m alembic history \
  -r 0030_directory_crypto_retirement:0039_communication
```

Raw verification logs are retained in `/tmp/evexia-*-0039-verification.log`
in this workspace. Final browser results are in
`/tmp/replit-background-tasks/6d87ff0a-77ce-4e50-b0e5-942a4e48034b.log`
(Communication/recovery) and
`/tmp/replit-background-tasks/9f7a8294-d592-4040-8de0-3df3b412e0f3.log`
(development gate/dates). They are temporary evidence, not durable recovery backups.

## Failures corrected

`test_fresh_upgrade_downgrade_reupgrade_and_head_schema` correctly migrates only
to `0034_shared_phone_countries`, but its expected table set came from the current
`0039` ORM. It therefore expected later domain, PO and Communication tables.
The test now uses the already-frozen `0034` table inventory and explicitly
projects the later account/reference column changes back to that historical
boundary. Exact table/column comparisons, downgrade/recovery, re-upgrade and
authentication protection tests remain enabled. No production migration or
application guard was changed.

Two browser fixtures also retained older product behavior:

- Communication still expected browser-local configuration storage and discarded
  credentials. It now supplies synthetic credentials, expects the encrypted
  shared-storage status, checks empty edit fields and clearing after failed
  submit/cancel/type changes, preserves credentials during normal field focus
  changes, and checks both browser storage and actual API responses for leakage.
  Response auditing matches the exact API pathname rather than also capturing
  Vite source-module responses. The final CRUD/default/delete/mobile/no-provider
  journey passes.
- Password recovery still expected the removed login-screen detour and generic
  submission for the reserved Super Admin identifier. It now verifies direct
  navigation, the identifier-conditional protected-account notice/no recovery
  request, and indistinguishable generic responses for staff/unknown identifiers.
  The real synthetic staff recovery, token reset/revocation and error flows pass.

These were test-only repairs; no application behavior or security checks changed.

## Verified safety boundaries

- One source head: `0039_communication`, after `0038_purchase_orders`.
- Retirement depends on the hostname sibling; both branches merge at `0033`.
- The actual wrapper remains capped at `0034_shared_phone_countries`.
- Fresh finalization covers the reviewed empty stages through `0039`; it rejects
  business records, wrong database/cluster, altered catalogs, used PO sequences,
  missing Communication keys and changed/deleted migration-owned channel rows.
- The expected channel metadata is exactly `email=1`, `sms=1`, `waba=1`;
  configurations remain empty after fresh bootstrap.
- Bootstrap creates the protected Super Admin atomically with readiness/optional
  hostname handling; a populated retry cannot replace its credentials.
- Policy planning from `0038` returns `OPERATOR_MIGRATION_REQUIRED`, zero
  migrations applied; at `0039` it returns `READY`, zero pending migrations.
- CI policy inspection/execution precedes service promotion. Exit 42 is reported
  as blocked, not promoted; concurrency, maintenance lock, recovery and explicit
  approval requirements remain enabled.
- Workflow, migration policy, Alembic migrations/environment/configuration,
  schema requirement and legacy VPS deploy script are unchanged by this
  verification repair.
