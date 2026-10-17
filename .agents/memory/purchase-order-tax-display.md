---
name: Purchase order supply destination
description: Deliveries are not limited to Maharashtra; vendor state alone cannot determine GST treatment.
---

The user confirmed that deliveries can be outside Maharashtra. Never treat Maharashtra as an implicit delivery destination or choose interstate GST from vendor state alone.

**Why:** A Karnataka vendor delivering to Karnataka is an intrastate purchase, while that same vendor delivering to Maharashtra is interstate. Supplier identity alone cannot distinguish them.

**How to apply:** Require an applicable place of supply for any newly reviewed ordinary domestic goods purchase. A selected location's structured Indian State/UT may suggest it, but manual delivery exceptions must remain possible. Missing historical destination evidence is not permission to fabricate a tax breakdown.

Changing a storage master must not change saved PO destinations or tax snapshots.
A deliberate location switch must ask before replacing a manual or saved destination;
missing/foreign geography must clear an older automatic suggestion rather than reuse it.

**Why:** The user explicitly requested location-driven convenience while preserving
exceptional deliveries, incomplete legacy addresses and historical order amounts.

**How to apply:** Distinguish draft suggestion provenance from the saved tax snapshot.
Never geocode free-text legacy addresses or infer international treatment.