---
name: Receipt PDF text geometry
description: SVG text measurement constraints when preserving selectable receipt text.
---

Measure the displayed SVG characters, after its default whitespace collapsing, rather than indexing raw textContent.

**Why:** SVG collapses repeated spaces and removes edge whitespace before assigning character positions. Raw string indices can exceed the browser's addressable character count even for ordinary receipt headers.

**How to apply:** Normalize SVG whitespace before calling character-position APIs, omit entirely blank text nodes, and test extraction against actual browser-generated PDF pages. Keep the visual page image unchanged so adding searchable text cannot drift from the saved receipt preview.