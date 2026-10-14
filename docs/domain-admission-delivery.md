# Secure domain configuration delivery

## Implementation and boundaries

Shared primary-domain configuration, exact-host TXT verification, independent
activation/revocation, legacy-unverified transition, production raw-Host
admission, exact proxy-peer trust, guarded nginx delivery and protected Settings
controls are implemented. See [domain-admission.md](domain-admission.md) for
the operator contract, recovery, expiry and rollback limitations.

No live DNS, registration, certificate, VPS, Compose topology, managed/shared
database migration, deployment or production account operation was performed.
The GitHub push-to-main deployment workflow was not disabled or changed.

## Verification evidence

All database and protected-browser verification below used disposable synthetic
fixtures, never live/shared accounts:

| Command | Result |
| --- | --- |
| `sh scripts/test-api-foundation.sh tests/test_role_urls.py tests/test_domain_admission.py tests/test_migration_domain_admission.py tests/test_nginx_domain_admission.py tests/test_operator_hostnames.py tests/test_sessions.py` | 107 passed, 14 deprecation warnings. Includes independent-connection stale DNS completion, migration upgrade/downgrade, real nginx syntax/delivery/revocation and cookie/session checks. |
| `sh scripts/test-fresh-install.sh` | Final run: 23 passed, 12 Alembic deprecation warnings. Includes fresh-process model registration and actual disposable restore/continuation. |
| `pnpm --filter @workspace/evexia-portal run test:admin-session` | 37 passed. Includes domain response decoding without a mapping ID, old/malformed response refusal and safe 429 feedback. |
| `node --test artifacts/evexia-portal/src/config/portalHost.test.js artifacts/evexia-portal/src/config/portalResolver.test.js scripts/check-portal-hostname.test.mjs` | 21 passed. |
| `python3 -m unittest discover -s scripts/tests -p test_deploy_migrations.py` | 44 passed. |
| `python3 scripts/export-api-contract.py` and `pnpm --filter @workspace/api-spec run codegen` | Passed. Existing path contracts unchanged; only the existing RoleUrlPage schema gains fields, alongside new domain schemas/operations. |
| `sh scripts/check-api-contract.sh` | Passed after final changes. |
| `pnpm run typecheck` | Passed for generated/shared libraries and configured workspace leaf checks. The existing portal is JavaScript; its production build is also checked. |
| `pnpm --filter @workspace/evexia-portal run build` | Passed. |
| `git diff --check` | Passed. |

Browser verification used the same tester and
`sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/role-urls.preview.spec.mjs`.
Its safety checks passed 3/3. The first pass had 2 passing scenarios and 3
failures caused by the old mapping-ID-only response decoder. After fixing it and
adding the unit regression, only the affected scenarios were repeated with
`'--grep=primary.domain|new.visits|same-origin.mapped'`: 3/3 passed. All five
scenarios are therefore verified; no second broad browser pass was run.

Covered browser flows: shared primary save/reload, stale-write review and draft
preservation across failed reload, exact TXT instructions, real cooldown with
injected DNS, verification without implicit activation, activation and revoke;
role CRUD keyboard/mobile and uncertain-write guards; private-preview cookie
restriction/redirect refusal; Admin/MR/Doctor role paths/retries; isolated
Admin/MR sign-in, deep refresh, renewal and logout; Doctor sends no credentials.
The inspected primary-domain mobile screenshot and no-horizontal-overflow
assertion passed.

API and portal workflows were restarted after the code batch and both started
cleanly. The public chooser screenshot rendered normally, and the preview API
liveness route returned HTTP 200. These are startup/liveness evidence only,
not connected-database readiness, real TLS-ingress or production evidence.

### Separate release-gate limitation

The existing `release` workflow was observed in FAILED state. Its
`pnpm run validate:release` log contains four unrelated historical Allergen
migration-test failures in `tests/test_migration_allergens.py`:

- `test_forward_empty_rollout_preserves_categories_locations_and_accounts`
- `test_concurrent_duplicate_and_stale_status_delete`
- `test_concurrent_imports_and_revoked_session`
- `test_reference_change_waits_for_catalogue_transaction`

That group reports 4 failed, 45 passed. The last fixture wraps
`validate_references` without returning its mapping; other failures report
`allergen_unavailable`. These files and Allergen runtime contracts were not
changed by this task. No full release success is claimed, no validation
assertion was weakened, and no skipped validation is represented as passing.
The completion check determines whether this separate gate blocks acceptance.

## Remaining infrastructure requirements

An authorized operator must separately approve the exact migration graph and
target, backup/rehearsal evidence and coordinated `0037_domain_admission`
rollout; configure exact bootstrap/recovery hosts and exact proxy peers; bind
DNS, publish TXT, verify and explicitly activate each required custom hostname;
configure real TLS and redirects; ensure every static/API entrypoint applies
the host policy and same-origin API/SPA routing; and verify actual health-probe
Host, login/cookie behavior, unknown-host rejection and immediate next-request
revocation on the real ingress. Source review metadata is not execution approval.
No production readiness claim is made.

## Git status

At handoff, the task changes are local to the assigned workspace fork. No manual
task commit and no Git push were performed. In particular, a push to `main` or
any deployment-triggering ref was intentionally withheld. The task-completion
workflow owns any accepted task commit/merge; this document does not claim that
acceptance or a production rollout has occurred.

## Changed files

Application and serving configuration:

```text
.replit
artifacts/api-server/.replit-artifact/artifact.toml
artifacts/api-server/backend/.env.example
artifacts/api-server/backend/Dockerfile
artifacts/api-server/backend/alembic/versions/0037_domain_admission.py
artifacts/api-server/backend/app/api/v1/role_urls.py
artifacts/api-server/backend/app/api/v1/system.py
artifacts/api-server/backend/app/core/config.py
artifacts/api-server/backend/app/core/host_policy.py
artifacts/api-server/backend/app/core/schema.py
artifacts/api-server/backend/app/db/models.py
artifacts/api-server/backend/app/db/domain_models.py
artifacts/api-server/backend/app/fresh_install.py
artifacts/api-server/backend/app/main.py
artifacts/api-server/backend/app/schemas/role_urls.py
artifacts/api-server/backend/app/serve.py
artifacts/api-server/backend/app/services/account_crypto.py
artifacts/api-server/backend/app/services/directory_rotation.py
artifacts/api-server/backend/app/services/domain_policy.py
artifacts/evexia-portal/nginx.conf
artifacts/evexia-portal/vite.config.js
artifacts/evexia-portal/src/auth/adminSession.js
artifacts/evexia-portal/src/components/admin/PrimaryDomainPanel.jsx
artifacts/evexia-portal/src/components/admin/RoleUrlSettings.jsx
artifacts/evexia-portal/src/components/admin/settingsSections.jsx
artifacts/evexia-portal/src/roleUrlSettings.css
pyproject.toml
uv.lock
```

Tests, harnesses, migration review and contract outputs:

```text
artifacts/api-server/backend/tests/domain_preview_app.py
artifacts/api-server/backend/tests/test_domain_admission.py
artifacts/api-server/backend/tests/test_fresh_install.py
artifacts/api-server/backend/tests/test_migration_domain_admission.py
artifacts/api-server/backend/tests/test_nginx_domain_admission.py
artifacts/api-server/backend/tests/test_role_urls.py
artifacts/evexia-portal/src/auth/adminSession.test.js
artifacts/evexia-portal/tests/role-urls.preview.spec.mjs
scripts/check-portal-hostname.mjs
scripts/check-portal-hostname.test.mjs
scripts/fresh-install-review.json
scripts/migration-policy.json
scripts/run-authenticated-previews.sh
scripts/test-api-foundation.sh
scripts/tests/test_deploy_migrations.py
scripts/validate-template-preferences.sh
lib/api-spec/openapi.yaml
lib/api-client-react/src/generated/api.schemas.ts
lib/api-client-react/src/generated/api.ts
lib/api-zod/src/generated/api.ts
lib/api-zod/src/generated/types/domainAction.ts
lib/api-zod/src/generated/types/domainActionAction.ts
lib/api-zod/src/generated/types/domainResponse.ts
lib/api-zod/src/generated/types/domainResponseKind.ts
lib/api-zod/src/generated/types/primaryDomainFields.ts
lib/api-zod/src/generated/types/roleUrlPage.ts
```

Documentation:

```text
artifacts/api-server/backend/README.md
artifacts/api-server/backend/ROLE_HOSTNAME_DEPLOYMENT.md
docs/domain-admission.md
docs/domain-admission-delivery.md
docs/fresh-install.md
docs/hostname-only-operator.md
docs/portal-resolution-recovery.md
```
