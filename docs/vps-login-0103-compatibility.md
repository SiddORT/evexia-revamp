# Backend-only login recovery for an existing 0103 database

## Scope and diagnosis

The operator reported `0103_tariff_staged_merge` on the VPS. The previous
`account_crypto.ready()` accepts `0102_category_count_tariffs`, but rejects
0103 before comparing encryption anchors. This deterministically produces
`account_crypto_unavailable`; it is **not evidence of damaged or missing keys**.
No VPS connection, deployment, Git push, migration or key change was performed.

The correction accepts only this exact additional runtime revision. The declared
development schema, generated constant, migration review target and Compose
configuration remain at their existing values (development schema 0102).
Intermediate staged merges and unknown future revisions are not newly accepted.

## Reviewed ancestry and storage

Both parents of 0103 are accounted for:

* `0102_category_count_tariffs` → `0100_applicable_gst` →
  `0098_opening_corrections` → `0096_hsn_master` →
  `0092_quantity_hundredths` → `0093_language_status` →
  `0089_it_material_pricing`, followed by the existing shared ancestry.
* `0101_gst_staged_merge` joins 0100 and `0099_opening_staged_merge`;
  0099 joins 0098 and `0097_hsn_staged_merge`; 0097 joins 0096 and
  `0095_quantity_staged_merge`; 0095 joins the quantity branch and
  `0093_designation_short_name`; that designation revision follows
  `0094_language_low_stock_merge`, joining `0093_language_status` and
  `0092_low_stock_cron` → `0091_low_stock_alerts` →
  `0089_it_material_pricing`.

Relative to the complete 0102 ancestry, the physical changes are the four
weekly low-stock settings/request/claim/delivery tables, the three recurring
schedule/occurrence/delivery tables, and a designation short-name CHECK
relaxation allowing blank values. The six join revisions (0094/0095/0097/
0099/0101/0103) execute no DDL, but their **parents do**, hence they cannot be
treated as evidence of compatibility on their own.

The common ancestry includes quantity transition storage and insertion guards,
language status/history, HSN, audited opening corrections, immutable GST policy
and immutable category/count tariffs. These are not re-run by this fix.
Low-stock settings, request and delivery payloads use the existing Receipt/PR
encryption domain; they do not extend the Directory encrypted-field inventory.
Designation metadata introduces no ciphertext. Neither branch changes account
AAD, lookup namespace, ciphertext, password hashes, reservation ownership,
configuration digest or protected-email index. Both inherit the protected
identity established at 0080; no identity migration or re-encryption is needed.
Retain all existing historical decryption keys, not just the active key.

Readiness now traverses tariff → GST → opening → staged HSN/quantity →
designation/language → recurring and weekly low-stock → all common predecessor
probes. It checks tariff columns, immutable triggers and timeline uniqueness,
plus the existing inherited objects, configuration and encryption anchors.
Readiness is a bounded structural/configuration check, not a full audit of
every historical ciphertext.

Directory runtime validates its unchanged encrypted phase/configuration/index
anchors without a revision allowlist; it needs no change. Offline
`directory_rotation` deliberately remains **unsupported on 0103**: its separate
lock/inventory contract is not approved by this runtime login correction.
Do not use rotation or key replacement as a login recovery step.

## Release tooling blocker

The normal migration planner in `scripts/deploy-migrations.py` requires the
application target to equal the single source head. Here the application target
is deliberately 0102 while the source head is 0103. It rejects this combination
with `APPLICATION_REQUIREMENT_NOT_SOURCE_HEAD`. The ordinary deployment also
performs migrations and recreates both application services.

Therefore **do not use the normal push-to-main deployment, the historical
deploy script, migration planner execution, or an installation/retirement
runner for this repair**. Do not alter the target, review approvals or planner
to bypass this blocker. Runtime compatibility does not mean normal release
tooling is compatible. A backend-only operator procedure needs separate
approval for a specific immutable image and target; this document is not that
approval.

## Read-only operator preflight

1. Independently confirm the approved host, active checkout, Compose project,
   Docker network, database name and cluster identity. The active checkout
   reported by the operator is `/var/www/admin-uat.allergyevexia.in`; this does
   not authorize hostname, DNS, TLS, network or resource changes. Inspect only
   non-secret image IDs/labels and `/api/v1/version`. Do not print `.env`,
   container environment, keyrings, anchors, ciphertext or passwords.
2. Obtain the corrected immutable candidate image through an independently
   reviewed build/transfer that does **not** trigger deployment. The backend
   Dockerfile starts Uvicorn directly; building an image does not migrate.
3. Run the following Python in a **one-off candidate container**, with the
   existing securely supplied environment and approved database network, not
   by editing an active container. Override its entrypoint to
   `uv run --project /workspace python -`. Do not launch Uvicorn or lifespan
   workers for preflight. Replace the two target placeholders from independent
   operator records, never derive the expected values from this connection.

   ```python
   from sqlalchemy import text
   from sqlalchemy.orm import Session
   from app.db.session import session_factory
   from app.api.v1.system import readiness
   from app.core.development_identity import LOADED_IDENTITY

   engine = session_factory().kw["bind"]
   try:
       with engine.connect() as connection, connection.begin():
           connection.execute(text("SET TRANSACTION READ ONLY"))
           connection.execute(text("SET LOCAL statement_timeout='5000ms'"))
           connection.execute(text("SET LOCAL lock_timeout='500ms'"))
           target = connection.execute(text(
               "SELECT current_database(), system_identifier::text "
               "FROM pg_control_system()")).one()
           assert tuple(target) == (
               "INDEPENDENTLY_APPROVED_DATABASE",
               "INDEPENDENTLY_APPROVED_CLUSTER_IDENTIFIER",
           )
           assert connection.execute(text(
               "SELECT version_num FROM alembic_version"
           )).scalars().all() == ["0103_tariff_staged_merge"]
           with Session(bind=connection, join_transaction_mode="rollback_only") as db:
               assert readiness(db) == {"status": "ready"}
           print({"preflight": "pass", "release": LOADED_IDENTITY,
                  "database_revision": "0103_tariff_staged_merge"})
   except Exception:
       print({"preflight": "failed", "action": "stop; operator review required"})
       raise SystemExit(1) from None
   finally:
       engine.dispose()
   ```

   This checks anchors by comparison without displaying them and does no
   migration, bootstrap, account creation or notification send. If the approved
   DB role cannot read cluster identity, stop and have the operator supply an
   independently authorized read-only identity check; do not grant runtime
   superuser access. A failure is not permission to repair data or keys.

## Separately approved backend-only rollout

Only after explicit operator approval:

1. Retain a verified recoverable database backup and independent existing key
   custody. Record current backend/frontend image IDs, candidate image digest,
   source identity, target identity and preflight result privately.
2. Acquire the existing host deployment lock and maintenance interlock, drain
   user traffic and stop competing deployments/writers. Do not run migration
   commands. Keep PostgreSQL and frontend containers/volumes unchanged.
3. Use a restricted **external Compose override** binding `backend.image` to the
   reviewed candidate image. Retain the same Compose project, network, `.env`
   and service identity. For this login-only recovery, override backend command:

   ```yaml
   services:
     backend:
       image: OPERATOR_REVIEWED_IMMUTABLE_IMAGE
       command: ["uv", "run", "--project", "/workspace", "uvicorn",
                 "app.main:app", "--no-proxy-headers", "--lifespan", "off",
                 "--host", "0.0.0.0", "--port", "8080"]
   ```

   Disabling lifespan intentionally keeps all background notification/expiry
   workers stopped; it temporarily suspends their existing background work too.
   Approve that operational consequence explicitly. Keep outbound mail/provider
   egress blocked and traffic limited to login/readiness verification. Do not
   invoke invitation, recovery, template-test or business-send endpoints.
4. With reviewed Compose arguments/project/files, replace **only backend** using
   `up -d --no-deps --no-build --force-recreate backend`. Do not copy this command
   without the approved image override. Never run `down`, replace PostgreSQL,
   touch volumes or rebuild/recreate frontend.
5. Verify actual backend image ID and `/api/v1/version` source identity. Its
   declared schema remains 0102; SQL still reports exactly 0103. Require
   `/api/v1/health/readiness` HTTP 200 with `{"status":"ready"}`; `/health` alone
   is insufficient.
6. Have an authorized existing account holder sign in through the unchanged
   portal with their existing credentials; verify a protected request, refresh
   and logout. Do not put credentials/tokens into shell history, logs or reports.
   Record pass/fail only. Confirm frontend/PostgreSQL image and volume identities
   did not change. Re-run read-only version/anchor preflight.
7. If any check fails, keep maintenance and sending restrictions, retain safe
   evidence and stop. Reverting only the backend image is possible under
   operator control, but the previous backend will again reject 0103; it is not
   restored login service. Never downgrade/stamp/reset the database.

Removing lifespan/egress restrictions and resuming any worker or notification
delivery requires a separate approved operational decision; this fix does not
authorize it. Low-stock eligibility itself remains blocked by the unchanged
0102 runtime target and the existing exact scheduler allowlist.

## Local evidence and requested validation limit

The dedicated disposable PostgreSQL suite builds actual 0102 ancestry, creates
synthetic encrypted accounts/reservations and tariff history, then upgrades the
0103 fixture through the real merge ancestry. It covers login/refresh, HTTP
login/readiness, retained storage, missing inherited objects/guards, invalid
anchors, unknown/multiple heads, read-only preflight and blocked scheduling.

Before the user requested closure without further regression/release checks,
one run reported **82 passed, 6 failed**. The six failures were test-fixture
issues (a reserved `.test` email rejected by HTTP response validation, an invalid
synthetic directory phase and a nonexistent worker test helper). Those fixtures
were corrected and a read-only preflight test added. **No rerun was performed**;
the final suite is not claimed green. No regression/release checks should be
inferred from source review or task closure.
