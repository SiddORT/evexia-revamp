---
name: Rate rounding scope
description: User-confirmed business scope for two-decimal half-up rates, distinct from other numeric contracts.
---

Rates/prices and discounts must round half-up in saved values and transfers,
not merely look rounded on screen. Presentation and decimal-string exports use
exactly two fractional digits. This is not a blanket policy for every number.

**Why:** The user confirmed that category prices, Allergen selling prices/GST,
discounts and new procurement snapshots follow the same two-decimal policy,
while quantities, thresholds, balances and historical financial records retain
their existing semantics.

**How to apply:** Preserve original source validation and percentage bounds
before rounding, exact decimal/workbook arithmetic, and post-round overflow
checks. Keep historical snapshots/audits immutable and local/shared datasets
separate. Never turn a load or render into a persisted normalization operation.
For Stock Status alerts, reuse the existing optional allergen threshold and its
backup transfer contract; do not introduce a second threshold or round it as a rate.

**Why:** The user explicitly requested preserving existing saved threshold values
and allergen backup compatibility when introducing Low stock alert filtering.

Two-place money fields with a rejection contract still reject extra precision;
display formatting does not expand those input contracts. Split tax rates may
need more internal digits than their two-place presentation.
