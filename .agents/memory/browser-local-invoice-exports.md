---
name: Browser-local invoice exports
description: Tradeoffs behind the on-device PO invoice preview and PDF export.
---

Keep PO invoice generation on-device while purchase orders remain browser-local. Preview and PDF should use the same normalized document and saved calculations, not independent layouts or freshly computed prices from product masters.

**Why:** The portal is an unauthenticated local preview; sending its records to a server solely for export would introduce new data-handling behavior. A shared A4 renderer makes preview and download agree without new server storage or PDF dependencies.

**How to apply:** Preserve clear demo/deleted markings and multi-page final-total/signature space. Current PDFs are rasterized, so do not promise searchable/selectable PDF text. Supplemental vendor address/GST and HSN currently come from masters, not historical snapshots; disclose that limitation until invoice metadata is captured when saving orders.