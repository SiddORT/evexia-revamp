# GST Settings (configuration only)

The Settings navigation/search exposes GST Settings only to Super Admin.
Both independent `/api/v1/admin/gst-settings` operations revalidate the
protected Super Admin identity and session on the server. No Staff or MR
capability grants access.

GET returns `configured: false`, version `0` and three null fields until the
first explicit save. There is no seeded cutoff or rate. POST requires all three
fields and `expected_version`. A transaction-held advisory lock serializes
writers, including first creation. Conflicts return 409 without updating data.
Loads never create configuration.

The cutoff is a literal `YYYY-MM-DD` calendar date stored as PostgreSQL DATE.
The exact cutoff belongs to the **on or after** period; before is strictly
earlier. No time zone, timestamp conversion or GST selection is involved.
Rates are required decimal strings between 0 and 100 inclusive, up to two
fractional places, stored as exact unconstrained NUMERIC with range/precision
constraints (not floating point or a rounding typmod). Zero is valid.
Responses use two decimal places. Non-personal business configuration is stored
in the dedicated shared `gst_settings` table, not browser storage.

The compact form keeps drafts in memory. Save/Cancel edits and the existing
Settings navigation guard protect unsaved work. Loading the saved configuration
after a conflict/uncertain result retains edits and displays all current saved
values for comparison; saving again is explicit. Cancel uses the last loaded
values and does not bypass a required reload after an uncertain save.

## Strict scope boundary

This configuration is saved for future order processing. No order service reads,
selects or applies these values. Kits, Immunotherapy, Lupin, SPT, Purchase
Orders, catalogue taxes, defaults, totals, invoices, saved orders and historical
snapshots are unchanged. Future integration requires a separate user request.
There are no multiple schedules, exceptions, tax components or statutory lookup.

## Source delivery and activation

Forward `0088_gst_settings` follows `0087_pricing_rule_categories`; no historical
migration is modified. Coordinated declaration, inherited readiness probes and
maintenance compatibility include this successor without changing existing
encryption inventories. The table is not seeded. Normal automatic migration
policy is unchanged, but **no migration or service restart was performed for
this delivery**. Development source integrity is generated offline only.
Production fresh-install catalog evidence is not fabricated or advanced.

No tests, regression/release checks, validation wrappers, builds/typechecks,
browser checks, deployments or live data edits were run. Contract/client and
source metadata generation are not runtime verification. Persistence,
authorization, concurrency, failure recovery and rendered layout remain
unverified at runtime.
