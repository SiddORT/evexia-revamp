---
name: Allergen expiry and cost authority
description: Approved expiry boundary, real cost requirement, and no historical digest replay.
---

Allergen expiry starts at 00:00 on the saved expiry date in Asia/Kolkata.
Expiry-today is a separate warning group but is already unusable. The alert
window after today is tomorrow through day 15 inclusive. Do not model expiry
separation as a fictitious physical storage transfer.

**Why:** The user approved date-based separation, not physical movement.

Loss valuation uses actual purchase/manufacturing cost, never catalogue/PO
selling prices or assumed historical costs. Missing cost remains unavailable;
known zero is distinct. Past disposal cost snapshots stay immutable even when
cost is later supplied. Daily digest configuration repairs must not replay old
blocked/uncertain days.

**Why:** The user explicitly selected purchase/manufacturing cost and prohibited
invented backfills and automatic historical resend.

**How to apply:** Retain these business boundaries when extending receipts,
reserve conversions, loss reports or expiry notifications. Source-only
implementation was requested; future runtime activation/testing requires its
own authorized scope, not an assumption that this work verified it.
