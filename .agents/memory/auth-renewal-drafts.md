---
name: Auth renewal and drafts
description: Preserve unsaved local editor state during blocking same-route session verification.
---

Initial or denied authorization must never mount protected content. For an
already-verified same-route workspace, hide and disable interaction during
renewal or recoverable verification failure without unmounting its editor.
Drop the subtree on definitive denial/logout or identity change.

**Why:** Local editor drafts live in React state. Conditional loading/error
screens that replace the protected subtree discard edits even when automatic
renewal succeeds; dirty-navigation confirmations do not see that unmount.

**How to apply:** Distinguish initial authorization from same-route renewal.
Verify draft and DOM-node preservation through success and transient-error retry,
while confirming hidden content is non-interactive and denied content removed.