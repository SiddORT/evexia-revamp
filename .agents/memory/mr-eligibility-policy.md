---
name: MR eligibility policy
description: Confirmed financial configuration ownership, date basis and advisory inventory scope.
---
MR order eligibility uses the MR's unpaid exposure plus the proposed order
against MR Payment Limit, and the MR's Doctor Days Limit for unpaid obligations
of the selected Doctor. Each zero setting independently means no restriction.
Doctor Master settings are not additional limits or fallback values. Days start
at the saved order date while a positive balance remains; equality with either
limit is allowed except for the separately authorized new configured-price MR
Immunotherapy workflow, whose positive payment limit uses strict `<`. Allergen
stock warnings stay advisory at placement; that supported IT workflow consumes
saved Extract and Dilution ml only on explicit Admin approval.

**Why:** The user explicitly confirmed these choices, including the order-date
basis, rather than Doctor Master limits or blocking inventory rules.

**How to apply:** Preserve these business boundaries in future order, settlement
and configuration changes. Unknown financial evidence is not a zero balance;
missing inventory coverage is not zero stock. Do not introduce price guesses,
receipts inferred from labels, or stock reservations under this approval.

For the narrowly authorized configured-price MR Immunotherapy workflow, a
separate stable-ID Dilution material is inventory/pricing-only, never a clinical
allergen child. Use configured ml and explicit Pricing Rules, not name-based
binding, catalogue prices or inferred formulations. No historical backfills.

**Why:** The user explicitly superseded configuration-only pricing and
advisory-only inventory for this workflow, confirmed both quantities are ml,
requested a separate dummy Dilution material, and specified strict `<` exposure.

**How to apply:** Preserve the other order types' equality/stock policies.
Unknown master setup values and missing rates must remain explicit. Only the
new supported saved composition authorizes approval consumption.
