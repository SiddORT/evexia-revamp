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
