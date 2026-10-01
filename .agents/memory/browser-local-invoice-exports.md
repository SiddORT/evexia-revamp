---
name: Browser-local invoice exports
description: Tradeoffs behind the on-device PO invoice preview and PDF export.
---

Keep PO invoice generation on-device while purchase orders remain browser-local. Preview and PDF should use the same normalized document and saved calculations, not independent layouts or freshly computed prices from product masters.

**Why:** The portal is an unauthenticated local preview; sending its records to a server solely for export would introduce new data-handling behavior. A shared A4 renderer makes preview and download agree without new server storage or PDF dependencies.

**How to apply:** Preserve clear demo/deleted markings and multi-page final-total/signature space. PO PDFs are image-only; do not extend that limitation to PR receipts, which preserve searchable text using browser-measured SVG geometry over the same page image. Supplemental PO vendor address/GST and HSN currently come from masters, not historical snapshots; disclose that limitation until invoice metadata is captured when saving orders.