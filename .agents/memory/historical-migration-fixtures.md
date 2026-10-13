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

**Why:** Falling back to public can select a current encryption anchor/table
instead of the intended historical schema and make a rehearsal appear valid.

**How to apply:** Preserve namespace options when cloning test connections;
escape URL percent signs for Alembic ConfigParser. Keep the historical source
unchanged for its recovery tests rather than weakening later forward-only guards.
