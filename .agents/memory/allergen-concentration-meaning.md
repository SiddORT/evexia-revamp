---
name: Allergen concentration meaning
description: Clinical interpretation boundary for catalogue concentration display.
---

Allergen concentration strings have no approved display unit. Label them as
Concentration without appending a unit, percentage or dilution interpretation.
Historical saved descriptions retain their original meaning.

**Why:** The user clarified that bare values such as 1 and 0.5 in selected
Immunotherapy allergens are concentrations, not quantities or Skin Test Results,
and explicitly prohibited inventing a display unit.

**How to apply:** Prefer the saved allergen snapshot, then the existing reference
fallback. Omit missing concentration metadata rather than inventing a value.

For Purchase Orders, the requested `1` default applies only to newly entered
product lines. It does not authorize changing catalogue defaults or assigning a
concentration to historical PO lines.

**Why:** The user explicitly scoped this default to PO entry and prohibited
historical backfills, invented units and dilution interpretation.

**How to apply:** Keep historical absence distinct from the new-line default;
do not extend PO concentration metadata into receipt or inventory operations.
