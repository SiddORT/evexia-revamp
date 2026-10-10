# Schema dictionary status

`EVEXIA_Database_Data_Dictionary.xlsx` and its validation JSON are **historical
merged-code snapshots**, not the current schema or a connected-database export.
The workbook predates the current organization retirement and encryption head.
Do not use it to plan a current migration, inspect retained data, or claim that
its listed objects still exist.

Current schema authority is the immutable Alembic graph ending at
`0031_remove_organizations`, plus the registered ORM and migration-only
`directory_crypto_stage` infrastructure. Generate a fresh snapshot from the
merged sources with `python3 scripts/schema_dictionary/generate.py`.
The generator rejects unmerged schema edits; source hashes and the revision head
must agree with the release being described. See
`docs/organization-retirement.md` for actual database findings and rollout gates.
