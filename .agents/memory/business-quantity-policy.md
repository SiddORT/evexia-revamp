---
name: Business quantity precision policy
description: User-confirmed expansion of two-place rounding to approved operational quantities, preserving original evidence.
---

The user's confirmed nearest-hundredth half-up policy now includes stored
business quantities and calculation results in the approved inventory,
procurement, opening-stock, reserve/dilution, recipe/assembly and coupled
Extract/Dilution ml areas, not just rates and displays. It supersedes the old
three-decimal quantity policy in those areas.

**Why:** The user explicitly requires canonical saved values and calculations,
not a formatter-only change, while preserving balanced provenance and original
immutable evidence.

**How to apply:** Coordinate all affected writers, operands, reviews, transfers,
documents and the explicit existing-data precision boundary. Preserve residuals
without rewriting old ledger/receipt/order evidence. Reject invalid original
ranges, fractional whole-unit sources and new positive quantities rounding to
zero. Counts, identifiers and unrelated clinical values remain out of scope.
Do not turn render/read paths into browser-local normalization writes.
