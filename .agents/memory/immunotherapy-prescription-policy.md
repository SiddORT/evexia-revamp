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
one INR rate per allergen/suborder before approval; PO number is optional for
saving, approval and permitted fulfillment and may be omitted or cleared. Rejection
requires no fabricated financial values. New and explicitly repriced orders
total the entered occurrence rates, not bottle MRPs. Historical saved totals
and prices stay unchanged unless an Admin explicitly saves the changed basis
with all required rates. Internal historical groups are not suborder identities.

**Why:** The user explicitly confirmed rate-sum totals, superseding the earlier
sum-of-bottle-MRPs rule, and later made PO numbers optional end to end,
superseding the approval/fulfillment PO prerequisite. Historical association
and price retention still apply.

**How to apply:** Keep financial/review authority on the Admin side across
forms, imports and retries. Never infer historical missing rates or replace
pending financial values with zero. Keep the verified-prescription boundary.

For the four sales-order listings, “created and deleted” means Created By,
Created At, Updated By and Updated At, not deletion, trash or restore features.

**Why:** The user explicitly clarified this wording.

**How to apply:** Use protected actor/time facts and mark unknown history
unavailable; do not add deletion features to interpret that phrase.
