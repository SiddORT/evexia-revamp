---
name: Doctor overview financial boundary
description: Business scope for MR Doctor summaries and unavailable financial tracking.
---

The MR Doctor Overview uses real available saved-order facts, not a synthetic
financial demo. Saved payment flags are not evidence of outstanding balances,
remaining credit or deadlines. Do not introduce a ledger or infer due dates
from order creation dates to populate this overview.

**Why:** The user explicitly selected real available data with unavailable
payment figures clearly marked, and authorized only fictional Doctor-master
fixtures for the existing Reena MR, not orders or financial transactions.

**How to apply:** Preserve known-price coverage and neutral unknown financial
states as order workflows evolve. New payment tracking or financial sample
transactions require separate explicit scope approval.

Keep the combined summary on the My Doctors listing. Inside the Doctor detail,
show a simple paginated list of the current MR's saved orders instead of the
aggregate summary and type breakdown.

**Why:** The user explicitly approved individual-order history inside the Doctor
detail, superseding its previous exclusion, without redesigning the main MR
Orders listings or the My Doctors list/grid.

**How to apply:** Keep detail history read-only and scoped to both the currently
assigned Doctor and authenticated MR ownership. Exclude SPT drafts and MR-supply
Kits; do not present a bounded page as complete history or infer balances.
