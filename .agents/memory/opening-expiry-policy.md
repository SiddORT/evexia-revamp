---
name: Opening expiry policy
description: Explicit expiry is permitted only on new opening rows, not a backfill of committed stock.
---

Opening expiry is optional and must be explicitly entered per new row. Blank
means unknown; committed historical openings must not be edited or backfilled.
An existing source/row identity cannot be reused with a changed expiry.
Future-dated allergen openings use the common expiry policy, while unknown,
expiry-today and expired stock stay blocked at the Asia/Kolkata boundary.
Finished-product eligibility is unchanged.

**Why:** The user authorized fixing missing entry evidence, not relaxing
expiry safeguards or rewriting previously committed inventory.

**How to apply:** Preserve unknown historical dates and old backup support.
Do not treat permission to date new openings as permission to repair old lots
or change the separate Stock Status physical-versus-usable visibility policy.
