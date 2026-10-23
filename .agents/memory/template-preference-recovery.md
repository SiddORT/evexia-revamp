---
name: Template preference recovery
description: User-facing recovery semantics for browser-local document preferences.
---

Refresh document defaults across tabs without mutating preferences or transaction records. Keep PO and PR preferences independent. A valid external write must not silently dismiss an existing load, save, or reset error; loading errors require explicit Retry or a confirmed reset before showing a trusted default again.

**Why:** The requested recovery behavior prioritizes visible, actionable storage failures over silently treating later browser events as proof that a failed operation succeeded. Resetting one document's layout must never repair or replace another document's choice.

**How to apply:** Treat storage events as read-only invalidation signals and read current storage rather than trusting the event payload. Preserve existing errors during background refresh, and expose document-specific Retry and confirmed Reset actions.

Saved procurement documents must preserve the template/date choices from their
save, while the defaults themselves remain browser-specific. PR remains a
quantity-based receipt, not a financial/tax invoice. Missing historical layouts,
values or actors must be shown as unavailable, never reconstructed as fact.

**Why:** The user explicitly restricted revision history to reliable saved
evidence and kept shared template administration and financial PR invoices out
of scope.

**How to apply:** New document workflows must not turn current Settings or
master data into supposed historical evidence. Re-downloading through the app
can mark an old revision superseded; already downloaded files cannot be changed.