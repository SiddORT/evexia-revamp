---
name: Cold-route component styles
description: Shared controls must not depend on CSS loaded by an unrelated lazy route.
---

Verify reused controls on a direct, cold visit to their consuming page. Give
the page its own scoped styles or load component-owned styles explicitly; do
not rely on styles introduced by a previously visited route.

**Why:** A reusable searchable selector functioned correctly but loaded without
its control and menu geometry on a direct visit. Another lazy route supplied
global CSS, hiding the problem after navigation. This affected bounded scrolling
and dropdown overlay positioning, not just cosmetic appearance.

**How to apply:** Check cold-route menu position, scroll bounds, focus styles and
clipping ancestors. Avoid importing an unrelated page's stylesheet solely to
obtain a shared control's styles.
