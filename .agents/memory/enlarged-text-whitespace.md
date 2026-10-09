---
name: Enlarged text whitespace geometry
description: Preserved whitespace can hang beyond boxes in WebKit even without page overflow.
---

Preserve authored description newlines without allowing trailing whitespace to hang outside measured text boxes when verifying enlarged text.

**Why:** WebKit's text ranges exposed hanging spaces under `pre-wrap` at intermediate desktop widths that Chromium and Firefox did not flag. Page-wide overflow checks alone missed this; bounding every rendered text line revealed it.

**How to apply:** For preserved multiline text whose whole line must fit, consider `break-spaces` rather than `pre-wrap`. Keep cross-engine text-bound checks and test intermediate widths, saved indicators, and both clean and draft states.
