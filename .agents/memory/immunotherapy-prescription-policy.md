---
name: Immunotherapy prescription and historical ID policy
description: Required prescriptions for future writes without rewriting historical bottles or blocking reads.
---

Immunotherapy orders require at least one successfully uploaded, verified
prescription associated with the selected patient before save, including edits
of previously fileless orders and reviewed imports. Historical fileless orders
remain viewable. Pending, failed, quarantined, metadata-only and removed files
do not count; MR restrictions on detaching saved attachments remain intact.

Historical bottle IDs must never be reassigned in persisted data or silently
rewritten in transfers. Short labels for legacy bottles are presentation only.

**Why:** The user explicitly required real prescriptions for future writes
while preserving existing historical orders and their bottle associations.

**How to apply:** Keep read compatibility separate from authoritative write
validation; retain historical IDs when simplifying labels or transfer flows.

New-order entry must not expose bottle-management controls. Use explicit
Allergen Name, Skin Test Result (mm) and Add entry after dosage; historical
multi-bottle associations remain intact.

**Why:** The user explicitly requested removal of “Bottles and allergens,” not
a rename of the old bottle-management interface.

**How to apply:** Preserve the backend grouping contract internally without
adding bottle creation, removal or reassignment controls to the simplified form.

MR submits an unpriced Confirmed order and has no Billing editor. Admin enters
required MRP, an INR rate for each allergen occurrence in its saved group, and
PO number before approval; rejection requires no fabricated financial values.
Per-allergen rates are independently recorded: the existing total remains the
sum of bottle MRPs, not an inferred rate/quantity/tax formula.

**Why:** The user explicitly superseded pricing during MR entry and the former
omission of PO number. No alternative rate-to-MRP formula was approved.

**How to apply:** Keep financial/review authority on the Admin side across
forms, imports and retries. Never infer historical missing rates or replace
pending financial values with zero. Keep the verified-prescription boundary.
