---
name: Immunotherapy tariff meaning
description: User-confirmed distinction between total suborder prices and separate per-allergen quantities.
---

The user confirmed that a category/count tariff is the **total suborder MRP**,
not a per-ml charge. Extract and Dilution are separate per-allergen quantities,
not whole-suborder totals; dosage and independent ranked pairs remain required.

**Why:** The user explicitly clarified these meanings; the former material-price
formula and a repeated/redistributed pair would produce different financial
or clinical outcomes even if the displayed master looked similar.

**How to apply:** Keep money revisions independent of quantity settings. A price
change alone never authorizes reapplying current clinical quantities to saved
orders, inventing count multipliers or adding a Dilution charge.

Pricing Rules must be an MRP-only workspace; Extract & Dilution belong in the
existing Settings editor. This supersedes the combined pricing/quantity
presentation, not the clinical configuration or calculation policy.

**Why:** The user explicitly requested separate workflows without deleting
clinical settings or changing their persistence.

**How to apply:** MRP loading, editing and navigation guards must not depend on
quantity services. Keep legacy INR/ml evidence read-only and distinct from MRP.

All Categories pricing means one-time bulk configuration of combinations
**within each category**, never cross-category mixtures or a global fallback.
Future categories/allergens are not automatically covered.

**Why:** The user approved this interpretation and explicitly withheld approval
to activate these records in current order quotation or reprice saved orders.

**How to apply:** Keep saved identities category-specific and require another
explicit configuration save for new catalogue members. Do not infer quotation
activation from approval of the bulk-entry workflow.

All Categories **Individual / 1 allergen** base pricing covers both Mix and
No Mix saved eligible allergens for one selected dosage/effective date. Base
means an explicitly saved common singleton price, not a global fallback.
Pair/triple prices remain independent explicit totals for category-local Mix
members only.

**Why:** The user requested a common individual base followed by separately
configured two- and three-allergen prices, without automatic future coverage,
additive formulas or order-consumer activation.

**How to apply:** Never derive combination totals from individual prices or
expand a singleton save to other dosages, future records or saved orders.

The user subsequently approved **using new combination pricing for order
placement** while removing the old pricing APIs and database structure.
This supersedes the earlier configuration-only activation restriction above.

**Why:** On being told that removing the old structure would otherwise break
order placement, the user explicitly selected “Use new combination pricing.”

**How to apply:** New quotations require an active, exact category/dosage/member
combination with a rate applicable on the saved order date. No count, singleton,
catalogue or per-ml fallback. Preserve historical order financial/quantity
snapshots and shared retry protection; removal does not authorize repricing them.
