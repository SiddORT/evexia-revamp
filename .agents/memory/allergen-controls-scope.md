---
name: Allergen control meaning and scope
description: Meaning of “one unit” and the boundary for Allergen selector refinements.
---

For Allergen, “one unit” means one combined searchable dropdown, not a new
measurement-unit field.

**Why:** The user explicitly clarified this meaning; a schema addition would
misinterpret the request.

**How to apply:** Keep Category and Storage Location search and selection
integrated without inferring new catalogue fields.

Allergen selector refinements should remain scoped to Allergen unless a shared
change is demonstrably necessary and covered against unrelated-master regressions.

**Why:** The user separated other-master refinements and listing-notice removal
into other work; existing shared selectors must not change incidentally.

**How to apply:** Reuse the portal's established appearance without broadening
the scope to global dropdown behavior or unrelated master guidance.
