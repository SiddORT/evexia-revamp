---
name: Browser label locators
description: Label queries can match labelled regions as well as form controls.
---

Use a control's role and accessible name when the same caption labels a section and its input.

**Why:** Playwright's label query matched both an `aria-labelledby` section and a textarea named Remarks, blocking an otherwise functioning order flow.

**How to apply:** Prefer textbox, combobox or button role queries for interactive controls. Keep section labels useful; do not remove accessible naming to make a broad locator unique.

Scope option-count assertions to the intended listbox rather than the whole page.

**Why:** Native Status and page-size selects also expose the option role, so a global option count can falsely report that a bounded searchable menu exceeded its server batch.

**How to apply:** Locate the named listbox first, then count or inspect its options. Preserve separate assertions for the server request's batch bound.

Prefer role/name queries for required inputs and filled textareas as well.

**Why:** Exact label queries can include visually hidden required-marker text or a wrapping textarea's text content, while the control's actual accessible name remains unchanged. This blocked otherwise valid form checks.

**How to apply:** Use textbox/combobox roles for text controls and an explicit locator for native file inputs; do not remove required markers or useful labels to satisfy a test.
