---
name: Purchase order tax display
description: Why purchase order summaries do not infer interstate or intrastate GST components.
---

Show a gross/taxable amount, aggregate GST amount, and final amount for purchase orders; do not infer IGST versus SGST/CGST amounts from the GST rate alone.

**Why:** A visual reference included separate tax components, but the requested fields only required GST and GST amount. The current purchase order data does not establish a reliable place of supply or interstate/intrastate tax treatment.

**How to apply:** If tax component breakdown is later requested, first define and capture the relevant supply and destination information and calculation rules, then extend validation and persistence consistently rather than splitting GST evenly as a display shortcut.