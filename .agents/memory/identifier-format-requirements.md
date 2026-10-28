---
name: Requested identifier formats
description: User-requested business-number prefixes, casing and minimum padding.
---

The user requests these business-number patterns:
- Immunotherapy: `IT-000001`.
- Kits: `kit-000001`.
- SPT orders: `spt-0000001` (seven numeric digits).
- Lupin: `lup-000001`.
- Immunotherapy suborders: `IT-000001A`, `IT-000001B`.
- MR: `MR-001`; Doctor: `DR-001`; Staff: `ST-001`; Patient: `PAT-001`.
- Allergens: `ALG-001`.

**Why:** The user explicitly requested a system sequence audit against these examples.

**How to apply:** Preserve the stated prefix casing and digit counts when
implementing business numbering. These requirements do not assert that current
records already follow them or authorize replacing relational UUID identities.
