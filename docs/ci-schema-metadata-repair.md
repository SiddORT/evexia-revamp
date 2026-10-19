# CI schema metadata repair — 0045 source repair and catalog provenance

## Execution boundary

The initial investigation used read-only source inspection. The user then
selected `0045_pr_batch_numbers` and separately authorized disposable catalog
collection only. That collection applied migrations in two new private
PostgreSQL 17.5 clusters with synthetic configuration; both clusters were
removed afterward. No existing development or live database was accessed.
No tests, schema-review checkers, validation suites, builds, Docker harnesses,
workflow reruns, pushes or deployments were executed. Downstream CI success is
**unverified**. This document is not release approval or a passing validation
attestation.

## Original failures

Both jobs belong to run
<https://github.com/SiddORT/evexia-revamp/actions/runs/39203786358>
for commit `484188ed30568a6c47f729fc5ac51ecb7dd9f302`.

- Release job:
  <https://github.com/SiddORT/evexia-revamp/actions/runs/39203786358/job/117902112612>.
  The supplied original logs show **Verify separately reviewed production
  fresh-install target** failing with `SCHEMA_REVIEW_BLOCKED:
  AuthorizationBlocked`; the full release gates were not reached.
- Docker job:
  <https://github.com/SiddORT/evexia-revamp/actions/runs/39203786358/job/117902112793>.
  The supplied original logs show the wrong-target loop expecting
  `INITIALIZATION_BLOCKED:` but receiving `INITIALIZATION_ERROR:
  AuthorizationBlocked: Unknown release authorization policy.` Image build
  succeeded. Neither the nonfatal Node warning nor canonical checkout
  reservation explains this failure.

At that commit, the application/development declaration required
`0044_purchase_received`, the release authorization policy named
`0043_email_templates`, and the reviewed manifest named
`0042_rate_hundredths`. The strict equality in
`app/services/release_authorization.py::policy` rejects the mismatch before
database target rejection. The Docker assertion correctly refuses to treat
this generic authorization error as proof that a wrong database was rejected.

## Selected source-review candidate

At initial inspection the checkout contained the additional protected migration
`0045_pr_batch_numbers`, descending from `0044_purchase_received`, while the
development declaration and generated application revision named 0044.
The policy named 0043 and the fresh-install manifest named 0042.
The user explicitly selected `0045_pr_batch_numbers` as the source-review
candidate and subsequently authorized disposable catalog collection only.
The declaration, generated revision, authorization policy and reviewed
manifest are now aligned to 0045. This is source-review selection, not
authorization to migrate an existing database, run tests or CI, or deploy.

- The selected current-checkout candidate is 0045. This does not authorize
  executing protected migrations on an existing database.
- Selecting 0044 requires a separately isolated candidate without the newer
  migration and dependent application changes. Do not delete concurrent work
  from this checkout or pretend that its graph has a 0044 head.
- Do not restore consistency by reverting to 0042/0043 while leaving the newer
  graph and application in place.

Unrelated existing edits to development schema review tooling and fixtures
were left untouched.

## Observed catalog provenance

No prior independently verified 0045 evidence was located. The authorized
collection now supplies a full 0045 catalog snapshot in
`scripts/fresh-install-catalog.json`; every historical entry is preserved.
No unsupported 0043/0044 finalization-start entries were fabricated.

Both independently initialized PostgreSQL 17.5 clusters produced the same
complete 0045 projection, containing 46 public tables, and the same digest:
`46b994805bc60ecbbb149144b6ea63a0c7e6c25ab89cd23680b42cd135c671e8`.
The collector also observed 0042 on each migration path and reproduced the
existing historical digest, rather than copying it onto the new target.

`scripts/fresh-install-catalog-provenance.json` binds the source commit,
collector, source inventory, observations, PostgreSQL version and relevant
migration/projection source hashes. The evidence archive contains both raw
observations, source inventory, frozen collection inputs and collector. It is
retained in ignored generated output, not as a passing release receipt.
The complete raw projections were compared between clusters. This is
independent-cluster reproduction by the same operator, not a claimed separate
human reviewer attestation.

The first collection attempt stopped at crypto configuration validation because
its synthetic keys reused the same bytes across scopes. Its cluster was
removed. The successful collection used distinct synthetic keys; no guard was
disabled and no live credential was read.

The source snapshot preceded the metadata/empty-seed finalization edits.
Historical migration files, the Alembic environment, initializer and catalog
projection remain unchanged. The later schema constant and finalizer changes
do not supply or alter the observed migration DDL. Source hashes in the review
manifest describe the repaired candidate, while the provenance separately
identifies exactly what was observed.

### How the evidence was collected

The now-completed, separately authorized collection followed this procedure:

1. Freeze the selected candidate source and record its commit and complete
   migration/source hashes. Use PostgreSQL 17 with new private temporary
   clusters, no network listener, no inherited database URL or live credentials,
   and synthetic configuration only.
2. Apply the reviewed migration path through 0045 solely to a demonstrably
   disposable pristine database. Protected historical migrations require a
   reviewed disposable-only procedure; do not bypass their production guards
   or assume a plain `alembic upgrade head` is safe.
3. Capture the actual database revision, server version, exact public table
   list and every section returned by the unchanged
   `app/services/fresh_catalog.py::projection`. Save that projection and its
   canonical SHA256 using the same serialization as `digest`, together with
   migration-owned seed observations and source hashes.
4. Independently review/reproduce the observation against the frozen migration
   inventory and record the reviewer/collection reference. A full
   fresh-install or restoration claim additionally requires actual successful
   execution of that respective procedure; a catalog capture alone proves
   neither.
5. Retain the non-secret evidence bundle outside Git's generated-output
   history, then use its reviewed exact target expectation to prepare the
   source-only metadata repair. Collect again if relevant source changes
   invalidate the observation.

The existing `scripts/test-fresh-install.sh` demonstrates environment clearing,
private Unix-socket clusters and synthetic configuration, but it runs a full
pytest suite. It is **not** a standalone catalog exporter and must not be run
under the current no-tests permission. Likewise, the normal initializer
requires the missing reviewed catalog and is not a shortcut for generating
its own trusted expectation.

## Narrow source changes made

1. Aligned the selected candidate's declaration/generated revision,
   `scripts/release-authorization-policy.json` and
   `scripts/fresh-install-review.json`. The complete migration
   inventory and guard/release/policy hashes were prepared from file bytes only,
   without executing the refresh/check routines. The development review target
   was aligned without changing its executable-source approval inventory.
2. Added only evidence-supported target catalog expectations to
   `scripts/fresh-install-catalog.json`; preserved every historical entry and
   all historical migration bytes and operator-only classifications.
3. Split current-release assertions from intentionally historical scenarios
   in `scripts/tests/test_fresh_install_alignment.py`. Its current target,
   parent, migration filename, predecessor plan and table-equality expectations
   were tied to 0042 and could not all be changed by substituting a target string.
   Retained the 0041 geography projection scenario and protected-migration
   rejection assertions as explicit historical cases.
4. Kept `scripts/test-docker-initialization.py` unchanged, with assertions specific
   to `INITIALIZATION_BLOCKED:`. It does not accept `INITIALIZATION_ERROR:` or a
   generic authorization failure as a substitute.
5. Preserved both reusable workflow gates and deployment dependencies. No
   workflow bypass, Node action upgrade, Compose change or authorization-policy
   relaxation is needed to explain the reported metadata mismatch.

## Exact migration-owned row handling

The 0043 migration inserts the required recovery email template. The 0045
migration inserts the initial manual-mode batch settings singleton.
The original `app/fresh_install.py::finalize` excluded only the verified
communication channel constants from its business-table emptiness loop.
At the selected target, legitimate migration-owned rows in those new tables
would encounter that loop.

Finalization now verifies exact migration-owned constants under its existing
table locks, before the emptiness loop and again after any final upgrade.
Recovery template content comes from the original hash-bound 0043 migration,
not a mutable runtime template. Exactly one template with unchanged version,
content, provenance, authorship and matching creation/update timestamps is
allowed. Batch settings must be exactly the original `(1, 1, NULL)` singleton.
Extra rows or modified values block; all other business tables must remain
empty. No historical seed or migration was rewritten.

The existing unused-PO-sequence check is unchanged; the new Receipt sequence
also must be unused. Fixture source covers the new seed/sequence rejection
cases, current 0045 path, all 50 migration sources and final-target continuation,
while retaining historical rate/geography and protected-path scenarios.
**These fixture and finalization changes have not been executed.**

## Later validation handoff — not authorized or executed here

The metadata repair now has authentic catalog observations. Request separate
permission before running any of the following:

- Development coordination and production schema-review checkers.
- Target alignment fixtures and protected migration policy checks, including
  intentionally historical cases.
- PostgreSQL 17 pristine/atomic initialization and exact final catalog checks,
  including migration-owned seed rejection and modified-catalog rejection.
- The actual Docker harness, retaining canonical-path, wrong-target,
  pre-existing database, transaction and pristine-state checks.
- Full exact-commit release validation and both reusable CI gates.

A passing local check would not itself authorize a push, workflow dispatch,
production migration or deployment. Those require separate permission.

## Repair status

The 0045 source/metadata repair and authorized catalog collection are complete.
There is no remaining catalog-evidence prerequisite. Installation, restoration,
all test suites, schema checkers, Docker and downstream CI remain explicitly
unverified; none is represented by the catalog observation.
