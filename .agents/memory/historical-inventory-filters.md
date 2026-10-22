---
name: Historical inventory filters
description: Preserve historical meaning when filtering stock movements involving assembled products and finished-product openings.
---

Filter historical inventory by saved identifiers and saved recipe evidence,
not current catalogue membership. Do not attribute allergen components to
finished-product openings that have no saved recipe evidence.

**Why:** The user requires assembled-product movements and their historical
meaning to be preserved. Reinterpreting an old movement using today's edited
recipe would silently change which history it matches; assuming components
for an opening finished product would invent provenance.

**How to apply:** When extending historical inventory search, reports or
filters, distinguish known historical members from unknown membership.
Keep unknown-member finished products visible when no allergen criterion is
applied rather than dropping them from inventory history entirely.
