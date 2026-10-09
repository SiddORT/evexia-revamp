---
name: Browser keyboard modality
description: Cross-engine focus assertions need real keyboard entry, not only programmatic focus.
---

Enter controls through a real Tab action before asserting keyboard focus indicators.
Programmatic focus followed by an arrow or Space key is not equivalent to keyboard entry in every engine.

**Why:** Firefox preserved pointer modality after authenticated dialog clicks and search fills, so programmatically focused tabs and native checkboxes correctly lacked `:focus-visible`. Real Tab entry exposed the intended keyboard behavior without weakening the focus assertions.

**How to apply:** Use bounded real Tab navigation from a known preceding control. Check the focused element, visible focus styling and settled viewport bounds independently; do not force CSS focus styling or manually scroll the destination to make a keyboard regression pass.

When a hybrid hover/touch test scrolls between controls, move the mouse to a neutral location before starting touch interactions.

**Why:** A stationary mouse can enter a different help button as keyboard or touch scrolling moves the page beneath it, reopening an unrelated tooltip and falsely appearing to break outside-touch dismissal.

**How to apply:** End the hover phase explicitly before checking keyboard/touch help behavior; do not weaken dismissal or no-mutation assertions.
