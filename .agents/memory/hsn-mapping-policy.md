---
name: HSN mapping policy
description: User-approved one-to-one HSN/GST meaning and historical product boundaries.
---

Each HSN code maps to one GST rate, and each normalized two-decimal GST rate maps
to one HSN code. Do not implement multiple HSN codes sharing a rate.

**Why:** The user explicitly chose “one HSN code per GST rate,” so entry must
resolve uniquely in either direction.

**How to apply:** Require explicit HSN and low-stock threshold for ordinary new
Allergens, including imports; zero GST and zero threshold are valid. Keep
historical blanks and saved HSN/GST snapshots unchanged when the master changes.
The bound Dilution material retains optional threshold/HSN and mandatory Mix.
This approval does not authorize order/invoice tax changes or historical backfill.
