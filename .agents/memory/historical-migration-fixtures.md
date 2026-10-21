---
name: Historical migration fixtures
description: Preserve historical contracts when current ORM models have additional columns.
---
Migration-preservation tests that seed an older schema must use its historical
column contract, not the current ORM model. Tests of current operational services
should first upgrade their isolated schema to the current head.

**Why:** Adding opt-in access fields made unrelated migration and key-rotation
fixtures fail because current ORM inserts/selects referenced columns that did not
exist in their intentionally historical schemas.

**How to apply:** Keep the historical migration being tested explicit. Seed its
old rows with bounded SQL, upgrade, then assert them using current models; do not
weaken production queries or skip the preservation assertions.

Raw inserts must supply historical NOT NULL values whose defaults existed only
in the ORM; do not assume those are SQL defaults. Seed valid historical names
that satisfy the catalogue's checks when testing normalization or reused names.

**Why:** A synthetic row can fail before reaching the intended migration boundary
because missing client-side defaults or invalid catalogue labels violate the old
schema; this is not evidence of a migration defect.

**How to apply:** Read the migration being seeded, include its required flags and
versions explicitly, and assert fixture creation succeeds before exercising the
forward migration.

Isolated historical schemas must not fall back to `public` in their search
path, and independently restored connections must retain that schema selection.
Current authentication must be exercised on a separately upgraded restored copy
when a historical recovery suite must remain at a reversible predecessor.

Migration-test helpers must stop at the revision whose behavior the test is
exercising, rather than silently advancing every historical fixture to the
current application head. Operator-scope success tests need the original
reviewed graph; separately assert that the real newer release is rejected.

**Why:** Later identifier-encryption guards can correctly reject synthetic
historical identifiers before an earlier phone or recovery test reaches its
assertions. An unchanged operator review must also reject a newer application
revision, even if a legacy test previously expected success.

**How to apply:** Use explicit historical targets and isolated historical
metadata fixtures. Do not weaken migration validation or expand production
operator review boundaries to make old tests pass.

Current-model migration consumers must explicitly opt into later protected
conversions, with separate recovery evidence for each populated scope. Keep
older shared helpers' historical defaults unchanged.

**Why:** Metadata-created service fixtures can pass while migration fixtures
silently stop before new reference-snapshot or encrypted-contact contracts.
Reusing an earlier migration's approval would conceal that mismatch and widen
the approved scope.

**How to apply:** Compare the service's model contract with the fixture's actual
revision. Upgrade only the operational consumer, rehearse populated recovery
separately, and retain legacy constraint assertions at their original schema.

**Why:** Falling back to public can select a current encryption anchor/table
instead of the intended historical schema and make a rehearsal appear valid.

**How to apply:** Preserve namespace options when cloning test connections;
escape URL percent signs for Alembic ConfigParser. Keep the historical source
unchanged for its recovery tests rather than weakening later forward-only guards.

Service-test isolation must preserve protected migration-owned seeds. Prefer an
outer rollback transaction with savepoint-backed sessions over cascading
truncation when tests need to call commit.

**Why:** A cascade from identity cleanup can attempt to delete protected recovery
templates. Disabling the protection to clean up a fixture would hide a real
production invariant.

**How to apply:** Keep seed rows installed by migrations and roll back test-owned
changes. Tests that genuinely require independent committed transactions should
use a separate disposable database instead.

Do not assume a full-release downgrade reaches an older migration's refusal.
Newer forward-only stages can correctly block the path first.

**Why:** A preservation test expected a historical template/privacy refusal even
though a later stock safeguard stopped the downgrade earlier, as intended.

**How to apply:** Keep historical guard assertions at their own revision before
upgrading to the declared current schema for service tests. Separately verify
the current path's first actual refusal and retained revision/data; do not
weaken guards or drop the earlier protection assertion to obtain a passing test.
