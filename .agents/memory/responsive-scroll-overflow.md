---
name: Scroll-region accessibility labels
description: Offscreen screen-reader labels can contribute to page overflow even inside a scrollable table.
---

An absolutely positioned screen-reader-only label can extend the document's scrollable width from a horizontally scrollable table when its positioning container is outside the table.

**Why:** Chromium exposed page overflow caused by an invisible label in a final action column, although the visible table was correctly contained. Filtering all descendants of scroll regions out of diagnostics hid the cause.

**How to apply:** Do not dismiss measured page overflow because all visible controls appear contained. Inspect hidden-label rectangles too; keep absolute accessibility labels positioned within their owning component rather than masking document overflow.
