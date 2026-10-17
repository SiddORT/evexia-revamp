# Development schema recovery: single activation handoff

## Status and ownership

This is the handoff for the **existing separately authorized activation task
(534)**, not another rollout or permission to execute it. The process repair
changes source checks and error handling only. It has **not** migrated a shared
database, taken/restored a shared backup, changed keys, restarted services,
sent mail or deployed anything. The email-template incident is **not resolved
live** by this change.

The supplied read-only investigation observed `0040_po_tax_basis` and no
`email_templates` table. That observation is not a fresh attestation from this
fork. The source head, application declaration, generated constant and independent
development review now agree on **`0044_purchase_received`**. Production
fresh-install evidence deliberately remains at its earlier reviewed target,
`0042_rate_hundredths`; its release-authorization/source checks currently fail.
This development repair neither refreshes that evidence nor fabricates a tested
production catalog.

## Exact target and reachable path

Only the original-development target described by the independently reviewed
`scripts/development-database.json` is a candidate:

| Identity | Expected value |
| --- | --- |
| Environment | development, primary (not in recovery) |
| Network host / port | `helium` / `5432` |
| Database | `heliumdb` |
| Cluster system identifier | `7689828272860483604` |
| Database OID | `16384` |
| Expected predecessor | `0040_po_tax_basis` |
| Fixed final target | `0044_purchase_received` |

These are non-secret expected identifiers, **not authorization derived from a
connection string**. The activation owner must independently confirm the original
workspace/network target and compare the real connection's database, system
identifier, OID and primary status. A clone can share identifiers. If any identity,
revision, source bytes or reachable path differs, stop and review a new exact
scope; do not silently substitute this fork, widen the target or stamp revisions.

The entire pending sequence is protected (`operator_only`):

1. `0040_po_tax_basis` → **`0041_location_geography`**: adds structured storage
   geography with empty defaults and a country-code constraint. No address
   inference or geography backfill.
2. → **`0042_rate_hundredths`**: **separate irreversible business-data change**.
   Preflight rejects out-of-range prices/GST and exhausted versions. Current
   category unit prices, allergen selling prices and GST round half-up to
   hundredths. Every category/allergen row's version and update time advances,
   including unchanged/deleted rows. Constraints/types change; historical order
   snapshots are not rewritten. Old drafts become stale. Lost digits cannot be
   reconstructed by downgrade.
3. → **`0043_email_templates`**: creates the shared table, constrained event
   assignment and protected identity triggers; seeds exactly the required
   `password_recovery` template with migration provenance. It does not import
   browser-local templates or send email.
4. → **`0044_purchase_received`**: creates four receipt/source/history/retry tables,
   indexes and a numbering sequence. No receipt import/backfill. Its separate
   `PR_ENCRYPTION_KEYS` / `PR_ENCRYPTION_KEY_ID` configuration is needed for target
   readiness and use; existing PO encryption scope is unchanged.

Approval for email templates alone does **not** approve price normalization,
receiving activation or any other predecessor. No revision has been reclassified.
The unattended development synchronizer refuses the whole path with exit **42**,
observed/required revisions, ordered pending/protected lists and this handoff.
It never executes the safe-looking first part of a mixed protected path.

## One ordered recovery sequence — activation owner only

1. **Pin and review source without a database.** Run
   `python -B scripts/review-development-schema.py`. Record the exact candidate
   commit and migration hashes from `scripts/development-schema-review.json`.
   Confirm the four-step path above and independently confirm the original target.
   Do not use `review-schema-release.py --refresh` to bypass production review.
2. **Obtain the exact scoped approval.** The approval must name original
   development, `0040` → `0044`, the catalogue rewrite/versions, template seed,
   receiving objects/configuration and coordinated service activation. If the
   existing activation authorization is narrower, stop for expansion; this
   process-repair task does not supply it.
3. **Exclude every writer and reconcile process ownership.** Inventory the
   managed API/frontend owners, their actual working directories and assigned
   `PORT`s, plus any manually launched Uvicorn/Vite or background/import workers.
   Record which process owns each listener before stopping it. Stop writers through
   their owning managed workflows; do not kill an unknown listener, start a duplicate
   API, or assume stopping the visible workflow stops a stray process. Existing
   application/browser tabs with drafts need explicit handling, not automatic reload.
4. **Independently verify recovery before any mutation.** Take a current complete
   database archive (including shared extension dependencies), with writer exclusion
   still effective. Retain it in the already approved **private App Storage**
   namespace, not Git/public assets/Library. Private temporary directories/files
   must be 0700/0600 outside the repository. Verify authenticated readback and
   rejected anonymous access. Actually restore onto a distinct disposable cluster,
   fail on any restore error, and compare schema plus all existing table contents
   and row counts without exposing business records. Separately attest recovery
   of every encryption/signing key needed to decrypt predecessor data and restart
   predecessor code. Archive checksum, successful restoration and key recovery
   are three different requirements. The older 0037→0038 evidence does not prove
   a current 0040 backup or these prerequisites.
5. **Rehearse then execute only the fixed approved sequence.** Rehearse the
   approved source against the independently restored predecessor, including 0042
   preflight/data effects, target readiness and protected seed/trigger checks.
   Only after that succeeds, the activation owner may run its reviewed fixed-target
   procedure against the confirmed original database. Use a caller-owned
   PostgreSQL transaction, the common advisory lock **145002**, bounded SQL/lock
   timeouts, reviewed migration bytes and exact target **`0044_purchase_received`**.
   The migration must recheck identity/predecessor after locking; keep all writers
   stopped through commit. Preserve the 0042 table locks. Never `upgrade head`,
   stamp, edit historical migrations, bypass safeguards or use the unrelated
   0037→0038 runner. On preflight/readiness/commit uncertainty stop, inspect and
   reconcile explicitly; do not retry mutations blindly.
6. **Verify committed schema/data before starting candidate services.** Confirm
   exactly one Alembic revision at 0044; verify the expected added objects, 0042
   normalization/version effects and unaffected historical snapshots. Verify the
   single protected recovery identity/event and its delete/update/truncate guards;
   verify receipt tables/sequence and required crypto configuration without printing
   keys or inserting live sample records. If target readiness cannot pass, do not
   call the migration or incident successful. Restoring after commit requires a
   separately coordinated full backup/code/key restoration, not a downgrade.
7. **Activate the correct owners once, then prove the running release.** Only
   under the activation approval, restart the existing API owner through
   `scripts/start-development-api.sh` (managed artifact directory, server-owned
   backend `PYTHONPATH`, assigned `PORT`; default 8080), then the existing frontend
   owner with its configured development launcher and assigned port. The sync must
   now be a no-op. Confirm listener ownership and clean startup logs; no duplicate
   ad-hoc processes. Compare served `/api/v1/version` loaded identity with the
   candidate and served frontend runtime/asset identity, not just Git. Check
   `/api/v1/health/readiness` is HTTP 200 for the exact target. Run
   `pnpm verify:development` **explicitly once** against the actual routed preview
   if authorized; diagnostics remain manual-only.
8. **Close only with protected browser evidence.** In the original routed preview,
   sign in legitimately as Super Admin, open the database-backed Email library,
   fetch the protected template detail, and verify its inert preview/source.
   Record the expected event/identity and absence of API/storage errors, without
   exposing credentials or real reset links. Do not send real mail or edit a live
   record just to test. Preserve old drafts and use explicit Load latest to reconcile
   uncertain saves. A login screenshot, Git sync, liveness response or passing
   source test alone cannot close the incident.

## What is independently tested here / what is still blocked

The focused source and disposable PostgreSQL tests verify reviewed additive DDL,
repeat no-op, concurrent lifecycle exclusion, execution/readiness rollback,
wrong-target refusal, tampered/unreviewed source refusal and **the actual protected
pending path's refusal despite stale production review**. A separate synthetic
predecessor rehearsal executes the four unmodified migrations in order and checks
rounding/version changes, protected seed/delete guard and empty receiving objects.
It uses minimal historical dependency tables, not a complete original database.

Mocked authenticated transport and component-hook tests verify collection/API
404 versus typed record-not-found errors, storage errors, retained last-valid
lists/editor identity, typed draft retention after failed saves and explicit
failed/different reconciliation, and no mutation replay. They are not live
browser/authentication or SMTP evidence.

**Still blocked/pending for activation:** fresh original-target confirmation and
exact approval scope, current private archive/readback/anonymous-access evidence,
complete independent restoration/content comparison, independently recoverable
keys (including verification/provisioning of PR configuration under its own
approval), full restored-predecessor rehearsal, managed process/port ownership
reconciliation, shared migrations and restarts, and actual running-release/
protected-browser evidence. None of these has been attested by this process repair.
The production fresh-install/release review remains separately blocked.

### Process-repair verification recorded in this task workspace

- `python -B scripts/review-development-schema.py`: passed, source-only.
- `python -B -m unittest discover -s scripts/tests -p 'test_development_sync*.py'`:
  **28 passed** initially, using only private socket PostgreSQL clusters where needed.
  The protected-path rehearsal used real Alembic and the unchanged migration files.
  After the completion review, a CI toolchain-order regression was added:
  the contract-only suite then passed **13 tests** (one additional case; the
  unchanged classifier/runtime and rehearsal results remain valid).
- `node --test artifacts/evexia-portal/src/services/emailTemplates.feature.test.js artifacts/evexia-portal/src/services/emailTemplates.state.test.js`:
  **9 passed**, mocked transport/component hooks (not a DOM/browser test).
- `PYTHONPATH=artifacts/api-server/backend python -B -m pytest -q artifacts/api-server/backend/feature_tests/test_email_templates_feature.py`:
  **24 passed**, disposable database and captured SMTP only.
- `git diff --check`: passed. Existing FastAPI test-client and Alembic
  configuration deprecation warnings did not fail these checks.
- A static capture of the existing routed root preview failed with an HTTP
  navigation error before rendering a page. It supplies **no protected-library,
  frontend or API identity evidence**. No workflow was started/restarted to change
  that result, consistent with this task's scope.

No complete passing full release/production catalog gate or live browser/SMTP
delivery is claimed. The separately owned activation must still satisfy the
sequence above against the original environment.

### Broader completion checks: not a release pass

The automatic completion attempt launched the configured local release stages.
It stopped at the completion wait limit after about 30 minutes; it did not finish.
It also recorded actual failures (not just timeouts):

- `python3 -B scripts/local-release-checks.py run api-role-urls`:
  `test_current_head_keeps_reviewed_crypto_inventory` rejects the already merged
  receiving head in the existing directory-maintenance revision allowlist.
- `python3 -B scripts/local-release-checks.py run api-shared-phone` and
  `python3 -B scripts/local-release-checks.py run api-directory-crypto`:
  existing directory export checks returned server errors.
- `python3 -B scripts/local-release-checks.py run api-product-categories`:
  existing tests still expect six-place catalogue prices, not the current
  hundredths policy (10 failures, 30 passes).
- `python3 -B scripts/local-release-checks.py run api-sales-targets`:
  the historical designation migration fixture's readiness check failed.
- `python3 -B scripts/local-release-checks.py run services` and several remaining
  stages were stopped before completion. Services had also emitted failing legacy
  product-category service cases. Their unfinished results are not passes.
- `python3 -B scripts/local-release-checks.py run api-patients` passed
  (37 tests); `python3 -B scripts/local-release-checks.py audit --without-browser`
  passed its command-registration audit, not the entire release suite.

The review also found that the new integration tests were initially placed in a
pre-Nix CI step. That defect is corrected: the early step only runs the offline
source check; disposable PostgreSQL tests stay in the existing Nix-backed gate.
The added source regression confirms this ordering.

The other failures concern source/test contracts that already predate this
process repair; no catalogue semantics, directory-maintenance allowlists or
historical fixtures were broadened to make them pass. They remain release
blockers to reconcile separately, alongside the deliberately stale production
review. This report does not waive those failures or assert release readiness.
