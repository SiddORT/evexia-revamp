---
name: Order approval notes
description: Optional approval notes versus mandatory rejection reasons for Kits, SPT and Lupin.
---

Kits, SPT and Lupin approval reasons are optional notes. Missing, empty or whitespace-only notes must not block an otherwise eligible approval. Supplied notes retain plain-text and 2,000-character validation. Rejection reasons remain mandatory; this approval change does not authorize changes to Immunotherapy policy or other approval safeguards.

**Why:** The user explicitly said approval reasons must not be mandatory.

**How to apply:** Keep frontend availability and backend validation consistent when changing the shared order decision flow. Preserve historical decision notes.
