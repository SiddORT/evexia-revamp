# Legacy pricing retirement

The approved replacement is exact saved combination MRP, not a category/count
fallback or a per-ml calculation. New Admin and MR Immunotherapy quotations use
the category, canonical dosage, sorted distinct allergen UUIDs and saved order
date. The newest rate effective on/before that date is selected only when the
combination's latest explicit status is active. Missing, inactive, future-only
or unreadable prices block the quote. Explicit zero is valid.

## Database changes

`0110_retire_legacy_pricing`, directly after `0108_doctor_mr_mapping`, removes:

- `it_pricing_rules`
- `it_pricing_rule_categories`
- `it_pricing_rule_targets`
- `it_category_count_tariffs`

It renames `it_pricing_rule_requests` to `it_combination_requests`, preserving
every request key, owner and encrypted retry outcome. The original encryption
context remains intentionally unchanged: changing associated data would make
pending retries unreadable. Combination tariff/status history is unchanged.

`0111_pricing_retirement_merge` joins the separately staged ancestry for full
head installations; it does not extend the declared development target.
Previously applied migrations are unchanged.

The migration obtains the shared pricing advisory lock and exclusive locks on
retiring tables. It does not use CASCADE, disable triggers, stamp revisions,
modify orders, change clinical settings or rewrite stock/financial history.
DDL and Alembic revision recording are transactional. A lock/readiness failure
rolls the coordinated development transaction back; do not retry by stamping.

## Application changes and recovery

Only `/api/v1/admin/pricing-rules/combinations/*` endpoints remain. Old root
rule CRUD, reference and `/count-tariffs` endpoints are removed. Obsolete UI
adapters/disclosures are removed; Extract & Dilution settings remain separate.

Saved orders retain their existing money, policy identifiers, component
evidence, quantity assignments and consumption history. Their immutable
snapshots can still be read and validated without the retired tables.
An explicit quote refresh uses the new combination policy and preserves
assigned quantities; it does not silently reprice any other saved order.
New quotes do not invent a rate for configurations that have not been saved.

Deploy the matching API/frontend together and use the existing migration runner.
Retain the PR encryption keyring and all other existing keys. This change adds
no secrets, clinical defaults, tariff seeds or authentication permissions.
Development must target the bound original database, not a task copy or VPS.
Development checkpoint rollback is the recovery mechanism for destructive
development changes. Production activation and recovery are separate operations
and are not authorized by local development work.

Downgrade is intentionally refused: discarded master configuration cannot be
reconstructed from combination prices. Recovery means restoring the complete
pre-retirement database/checkpoint and its matching application, not recreating
empty old tables. A process still running the old application must be stopped
before enabling writes on the new schema.
