---
name: Address data authority
description: Preserve postal and historical address meanings when geography catalogues differ.
---

Treat the geography catalogue as selection assistance, not authority to change a
saved address or India Post result. Keep postal-only and historical names under
their original parents; never substitute a nearby city to obtain a catalogue ID.

**Why:** The user requires existing addresses and valid postal results to remain
retainable even when their spelling or locality is absent from the catalogue.
Storage geography must remain optional and retain its PO destination semantics.

**How to apply:** Future dataset updates and normalization changes must preserve
these meanings. Phone-country metadata and GST states are not city directories.
