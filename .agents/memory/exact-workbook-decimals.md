---
name: Exact workbook decimals
description: Preserve monetary workbook precision without silently converting through binary floats.
---

Exact monetary imports must use decimal strings or the workbook's original
numeric XML lexeme, not a spreadsheet parser's float representation. Keep
monetary exports as text cells.

**Why:** Eighteen-digit supported category prices exceed Excel's reliable
numeric-cell precision; even a well-formed workbook XML amount can lose
significant digits through openpyxl's conversion. Producer scientific notation
may represent a valid exact amount even though form/CSV transport requires
plain decimals.

**How to apply:** Run the shared inert archive/formula/link/size validation
first, then validate the original numeric XML using Decimal and explicit source
precision/range limits. Apply the field's own normalization only after validation:
rates round half-up, while exact-rejection monetary fields remain unrounded.
Support bounded exact numeric workbook notation, but
never infer or restore precision already lost by the spreadsheet producer.
Advise users to keep long prices in text cells before upload.
