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

Private cross-user reporting is not an editor draft: discard fetched history
when authorization is temporarily unavailable and reload it after verification,
while retaining already-mounted browser-local editors elsewhere.

**Why:** Keeping editor input prevents data loss; keeping fetched administrative
history across an identity or authorization boundary risks disclosing another
account's private records. These two kinds of state need different lifetimes.

**How to apply:** Do not reuse editor-preservation behavior as a private-data
cache policy. Requests must guard both completion and response-body decoding
against logout/login generation changes.