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

The user confirmed that `ST-001` applies to Employee Code only, not the separate
EVX account label or protected Super Admin account.

For Immunotherapy Order Batch No, the user confirmed `E | PD | 11 | 0002`;
`PP` was a typo for `PD`. Monthly numbering is shared across dosages and actors,
using the saved order date, and the placement dosage stays authoritative for
the issued label after dosage edits. No visible year was requested, so labels
can repeat in different years and are not globally unique order identities.

**Why:** The user explicitly requested a system sequence audit against these examples.
The batch format and monthly reset were separately confirmed by the user;
they do not authorize backfills, renumbering or inventory-batch changes.

**How to apply:** Preserve the stated prefix casing and digit counts when
implementing business numbering. These requirements do not assert that current
records already follow them or authorize replacing relational UUID identities.
