---
name: Fieldset grid measurements
description: Browser grid assertions for fieldsets must use rendered field geometry.
---

Count responsive fieldset columns using the distinct horizontal positions of
the rendered fields, and compare their actual widths and row positions.
Do not assume computed grid-template-columns always contains pixel track sizes.

**Why:** Chromium returned unresolved repeat()/minmax() track expressions for a
fieldset grid. Parsing the expression as pixel sizes produced NaN even though
the form had rendered normally.

**How to apply:** For form-layout regressions, measure the field bounding boxes
to verify equal widths, expected column counts and unchanged row-major order.
