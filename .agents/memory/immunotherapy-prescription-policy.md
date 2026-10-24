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
one INR MRP per existing SUB header, whose children may contain multiple
allergens with separately entered result (mm), extract and dilution (ml).
Individual allergen rate editing is superseded. PO number is optional for
saving, approval and permitted fulfillment and may be omitted or cleared. Rejection
requires no fabricated financial or clinical values. Admin explicitly adopts
the header-MRP model, retaining every original SUB separately with its initial
allergen; adding children does not create another SUB or price. Historical
saved totals and prices remain unchanged until that explicit save. Internal
historical bottle groups are not suborder identities and must remain recoverable.

**Why:** The user explicitly confirmed that multiple allergens inside one
suborder share its existing SUB number and single header MRP, superseding
the earlier per-allergen-rate model. Historical associations, old prices and
optional PO still apply.

**How to apply:** Keep financial/review authority on the Admin side across
forms, imports and retries. Never infer historical missing rates or replace
pending financial values with zero. Keep the verified-prescription boundary.

For the four sales-order listings, “created and deleted” means Created By,
Created At, Updated By and Updated At, not deletion, trash or restore features.

**Why:** The user explicitly clarified this wording.

**How to apply:** Use protected actor/time facts and mark unknown history
unavailable; do not add deletion features to interpret that phrase.

Immunotherapy suborder numbering is order-local and starts at `SUB001`.
Issuance belongs to the MR's first successful save, not draft entry or Admin
review. Existing saved numbers must not be renumbered, and removed numbers
must not be reused. Do not reserve draft numbers or bulk-backfill old orders.

**Why:** The user confirmed the compact format and explicitly required saved
identities to exist before Admin review while preserving historical identities.

**How to apply:** Treat pending draft rows and saved business numbers separately;
keep older formats compatible and assign missing history only on an explicit
supported save.

Save SUB rates directly; keep overall order approval. SUB Update saves the
whole order, including other pending edits, rather than a separately approved
price change. Do not introduce a pricing approval step or automatically approve
an order when its rates are saved.

**Why:** The user explicitly clarified this separation.

**How to apply:** Keep pricing-save guidance distinct from overall order review;
retain existing protected draft-save and order-decision requirements.
