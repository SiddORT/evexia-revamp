---
name: In-house reserve dilution policy
description: Approved dilution rules and the boundary between concentrate reserves and inventory.
---

Keep manufactured reserve entry snapshots separate from usable inventory. Only
an explicitly reviewed protected Super Admin movement may dilute input by 2, 5
or 10; No transfers the concentrate unchanged as reserve-only. Output ml equals
input ml times factor; concentration equals input concentration divided by factor.
Positive plain numeric concentrations remain unitless; an explicit percent suffix
is preserved only when present in the saved source. Never add a percent unit to
the catalogue's plain numeric values.
Diluted expiry is movement date plus two calendar years, leap-day clamped,
not original expiry plus two years and not capped by original expiry.

**Why:** The user explicitly approved these business rules while retaining the
protected reserve boundary. Moving undiluted concentrate does not authorize
making it order-ready, and the legacy descriptive units must not be reinterpreted.

**How to apply:** Preserve these rules across movement, inventory and historical
display changes. Never expand dilution to purchased/assembled stock, arbitrary
factors, clinical recommendations or catalogue concentration edits.
