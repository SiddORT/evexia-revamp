---
name: Receipt historical balances
description: Historical receipt balances and correction behavior must not use today's fulfillment.
---

Receipt documents use a saved post-receipt quantity per source PO line, not a balance recalculated from current receipts. Duplicate products remain distinct source lines. Rejected units remain outstanding.

**Why:** Later receipts, deletions and corrections change current fulfillment without changing what an earlier receipt originally showed. Legacy activity is not a complete historical ledger and cannot safely reconstruct missing values.

**How to apply:** Preserve missing historical balances as unavailable. For a correction with a known snapshot, use the original snapshot plus that receipt's original acceptance as its historical baseline, then subtract revised acceptance. If that baseline cannot represent the correction (for example, an earlier receipt was deleted and revised acceptance now exceeds the historical baseline), mark history unavailable rather than clamp a negative result to zero. Do not rewrite other receipts' snapshots.

PR template preferences are intentionally separate from the strict existing PO preference record.

**Why:** Adding PR fields to the existing PO record would make its older strict readers reject otherwise valid PO settings.

**How to apply:** Scope PR saves, resets and storage-error recovery to PR only; do not migrate or broaden the PO preference schema just to add document types.