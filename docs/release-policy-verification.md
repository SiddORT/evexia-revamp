# Release-policy implementation verification

## Verdict

The conditional automation policy is implemented. **Automatic release
certification remains NO-GO**: the full release gate exits 1 on 13 browser
failures. No real release certificate or production approval was issued.

Routine migration execution requires successful signed validation, exact
artifact integrity and an entirely automatic pending path. Fresh automation
additionally requires independent target/recovery evidence and authenticated
pristine origin. Existing-database operator classifications and approvals are
unchanged, including `0039_communication`.

The fixed boundaries remain prepare `0031_role_hostnames`, retirement cap
`0034_shared_phone_countries`, final/readiness `0039_communication`.

## Actual checks and results

| Command/check | Result |
|---|---|
| `python -B -m unittest discover -s scripts/tests -v` | **98 passed** |
| `sh scripts/test-fresh-install.sh` | **42 passed** against isolated production-mode PostgreSQL fixtures |
| `sh scripts/test-api-foundation.sh tests/test_organization_retirement.py tests/test_organization_catalog.py` | **62 passed** |
| `pnpm run validate:release` | **Exit 1**: 792 pytest passes, successful Node groups (298 passing test executions), then 196 browser passes / 13 failures |
| `EVEXIA_NIX_DOWNLOAD_ENGINES=1 sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/download-logs.preview.spec.mjs` | **30 passed**: 10 each on Chromium 152, Firefox 155 and WebKit 26.6 |
| `bash -n scripts/operator-retirement.sh` | Passed |
| `git diff --check` / staged diff check | Passed |
| Prettier YAML parser on both GitHub workflow files | Passed; actual GitHub-hosted execution not performed |
| Python AST parsing and all reviewed source/policy hash checks | Passed |
| Original development API health/readiness | Both HTTP 200; readiness `ready` |

The final CI secret-scope adjustment was followed by the 98-test policy suite,
the complete 42-test fresh suite and YAML parsing. It exposes only the release
signing secret to the reusable validation job, not inherited VPS SSH secrets.
There is no claim that the failed full release gate is a successful validation
of this candidate.

Fresh tests include a real empty backup/independent-cluster restore, real
original guarded retirement to 0034, automatic continuation/bootstrap to 0039,
separate bootstrap permission denial, rejection of populated and revisionless
non-pristine databases, incorrect physical target, non-table objects,
missing crypto, invalid graphs and tampered proof. Signing authorities and
application keys in these tests are synthetic test fixtures, **not production
recovery evidence**.

The release validator's negative test confirms a failed command issues no
certificate. Signed integrity cannot substitute for the independently attested
restoration rehearsal/key recovery.

## Every observed full-gate browser failure

All paths below are under `artifacts/evexia-portal/tests/`. This list exactly
matches the recorded pre-policy run. These UI files were not modified here;
their causes were not repaired or waived.

1. `allergens-backend.preview.spec.mjs:195` — desktop keyboard switch,
   persistence, concurrency, filters and deletion.
2. `allergens-backend.preview.spec.mjs:195` — mobile variant of the same flow.
3. `order-entry-layout.preview.spec.mjs:47` — themes, conditional content,
   keyboard menus and enlarged text.
4. `role-urls.preview.spec.mjs:222` — mapped/unknown host visits and retries.
5. `role-urls.preview.spec.mjs:273` — mapped Admin/MR login, deep refresh,
   renewal and logout.
6. `roles-permissions.preview.spec.mjs:224` — bounded catalogue navigation,
   sidebar and zero-permission workspace.
7. `spt-orders.preview.spec.mjs:124` — cold responsive/enlarged-text routes.
8. `staff-backend.preview.spec.mjs:134` — empty-directory/account CRUD,
   conflict and export flow.
9. `staff-backend.preview.spec.mjs:193` — retry, uncertain create and duplicate
   email flow.
10. `staff-backend.preview.spec.mjs:225` — mobile phone-country/credential flow.
11. `vendors-backend.preview.spec.mjs:46` — cold catalogue/code/country flow.
12. `vendors-backend.preview.spec.mjs:87` — desktop modal/conflict/deletion flow.
13. `vendors-backend.preview.spec.mjs:87` — mobile variant of the same flow.

Detailed failed-run diagnostics:
`test-results/evexia-auth-preview.t3cbVw/`.
The full command is fail-fast between stages: downstream layout/isolation
matrices were not reached after its Chromium stage failed. The separate
30-case download run does not claim those unexecuted matrices passed.
No browser assertions, retries, security checks or thresholds were weakened.

## Offline policy evidence (no database access)

```sh
python -B scripts/deploy-migrations.py --offline-current 0038_purchase_orders
# OPERATOR_MIGRATION_REQUIRED; operator_only=["0039_communication"];
# migrations_applied=0; exit 42.

python -B scripts/deploy-migrations.py --offline-current 0039_communication
# READY; pending=[]; migrations_applied=0; exit 0.
```

`READY` in this offline example is a plan result, not a signed release approval
or verification of any actual VPS database.

## Files changed across the policy implementation

Includes the preceding local implementation checkpoint, not just its final
follow-on commit. `scripts/migration-policy.json` is unchanged; the separate new
authorization policy does not reclassify any migration.

- `.github/workflows/deploy.yml`
- `.github/workflows/release-validation.yml`
- `artifacts/api-server/backend/app/fresh_install.py`
- `artifacts/api-server/backend/app/services/release_authorization.py`
- `artifacts/api-server/backend/tests/test_fresh_install.py`
- `scripts/release-authorization-policy.json`
- `scripts/validate-release-artifact.py`
- `scripts/deploy-migrations.py`
- `scripts/operator-retirement.sh`
- `scripts/fresh-install-review.json`
- `scripts/tests/test_deploy_migrations.py`
- `scripts/tests/test_release_authorization.py`
- `docs/release-authorization.md`
- `docs/fresh-install.md`
- `docs/organization-retirement.md`
- `docs/release-policy-verification.md`
- `.agents/memory/scoped-operator-approval.md` (durable approval-scope rule).

Reference uploads already captured by the preceding checkpoint were not edited.
No Alembic migration, Alembic environment/configuration, schema requirement,
`.env`, `deploy-scripts/deploy.sh`, Compose override, storage or Nginx/HTTPS
configuration was changed.

## Future operator procedure and remaining prerequisites

Use [release authorization](release-authorization.md) for the exact one-time
trust setup, public-key conversion, genuine recovery-evidence contract,
authority signing command, Docker/flock supervisor requirements, and
prepare/retire/finalize commands. The original manual procedure remains
available with all its approvals.

Before any unattended execution:

1. Repair the release-gate browser blockers and obtain a genuinely successful
   signed validation for the exact clean committed release.
2. Separately provision the release signing secret and the independent recovery
   authority; install the canonical restricted target/trust configuration.
3. Independently identify the actual server/network/database/cluster. Do not
   infer emptiness from missing public tables or the Alembic table.
4. Complete real durable backup, independent restoration/path rehearsal and key
   recovery; retain the evidence and obtain the independent signed attestation.
5. Use the existing maintenance marker, inherited real exclusive flock and
   genuine writer drain. Never invent origin/recovery files or remove maintenance
   just because an intermediate phase succeeded.

No VPS connection, production migration, deployment, push, Docker-container
restart, volume reset or original-development database migration was performed
for this implementation. Migration execution was confined to disposable test
databases. One managed Replit development API process was restarted after its
code batch; that was not a VPS/container deployment.
