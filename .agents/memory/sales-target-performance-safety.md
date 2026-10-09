---
name: Sales Target performance safety
description: Data and operator-approval boundaries for Sales Target scale work.
---

Sales Target performance benchmarks must use synthetic records in a disposable
database, never seed or load-test real records. Any index change must be reviewed
separately and receive operator approval before a managed migration.

**Why:** The user explicitly requires these boundaries. Per-record reference
queries were the demonstrated export bottleneck; that evidence does not justify
changing managed indexes.

**How to apply:** Keep scale fixtures isolated from configured application
credentials. If larger synthetic directories reveal a query-plan problem,
document the measurements and propose the index review separately rather than
applying a migration as part of a responsiveness fix.
