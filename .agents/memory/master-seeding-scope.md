---
name: Master seeding scope
description: User's meaning of master samples, distinct from inventory transactions.
---

Treat a request for master samples as directory/catalogue data, not procurement
or stock transaction samples. The user specifically clarified Storage Locations,
Zones, Product Categories, Allergens, Doctors, MRs and Patients.

**Why:** The user corrected an Inventory-focused interpretation and wanted the
linked master directories instead. Purchase Orders activation must not become
a prerequisite for independently ready masters.

**How to apply:** Confirm the named masters and their own prerequisites. Include
only required enrollment dependencies and preserve existing identities.
The user subsequently explicitly requested Vendors, Sales Targets and Doctor
Opening Balances too; those are authorized master fixtures, not permission to
create payment history or accounting ledgers. Keep purchase orders and stock
movements outside the master seed.
