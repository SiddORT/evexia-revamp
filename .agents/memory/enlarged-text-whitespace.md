---
name: Enlarged text whitespace geometry
description: Verify actual enlarged font sizes and text bounds, not just root sizing and page overflow.
---

Preserve authored description newlines without allowing trailing whitespace to hang outside measured text boxes when verifying enlarged text.

**Why:** WebKit's text ranges exposed hanging spaces under `pre-wrap` at intermediate desktop widths that Chromium and Firefox did not flag. Page-wide overflow checks alone missed this; bounding every rendered text line revealed it.

**How to apply:** For preserved multiline text whose whole line must fit, consider `break-spaces` rather than `pre-wrap`. Keep cross-engine text-bound checks and test intermediate widths, saved indicators, and both clean and draft states.

Verify that an enlarged-text fixture actually doubles the computed font sizes of representative headings, labels and body text.

**Why:** Setting the root font size to 200% left portal text with pixel-based font sizes unchanged, producing a false pass until real computed-size doubling exposed mobile overflow.

**How to apply:** Snapshot computed font sizes before modifying elements, then double from that snapshot and assert sampled ratios. Do not use device scale or root sizing alone as evidence for pixel-sized text.

Verify enclosing controls and panels as well as each text node's own bounds.

**Why:** A WebKit enlarged-text failure stopped reporting out-of-bounds text after a label wrapper was added, but the button's allocated hit area and its ancestors still overflowed. Text-bound success alone would have accepted an incomplete repair.

**How to apply:** Keep both ancestor scroll/client-size checks and text-range checks. Diagnose the allocated control height before changing markup or layout mode; confirm the complete cross-engine matrix rather than only the initially failing theme.
