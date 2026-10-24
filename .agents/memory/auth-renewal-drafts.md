---
name: Auth renewal and drafts
description: Preserve unsaved local editor state during blocking same-route session verification.
---

Initial or denied authorization must never mount protected content. For an
already-verified same-route workspace, hide and disable interaction during
renewal or recoverable verification failure without unmounting its editor.
For an already-mounted staff editor, a later permission denial or revoked session
must also preserve the hidden, non-interactive draft. A fresh password sign-in
may recover it for the same account after access is restored; never restore a
known revoked bearer through a newer shared cookie. Drop the retained editor on
identity change or explicit navigation away.

**Why:** The user explicitly requires role/staff revocation not to lose mounted
recoverable drafts. Local editor drafts live in React state. Conditional loading/error
screens that replace the protected subtree discard edits even when automatic
renewal succeeds; dirty-navigation confirmations do not see that unmount.

**How to apply:** Distinguish initial authorization from same-route renewal.
Verify draft and DOM-node preservation through success and transient-error retry,
while confirming hidden content is non-interactive and never grants authority.
Initial denied routes must not mount; retained drafts require fresh authorization
before they can become visible again. Keep transport checks tied to the real
current session, not the retained editor's previous identity.
Audit child session subscriptions too: keeping the boundary mounted cannot
preserve an editor that its parent closes merely because the user is temporarily
null. Distinguish owner changes from loss of current authorization; fetched
directories and one-time credentials can be cleared without closing the draft.

Private cross-user reporting is not an editor draft: discard fetched history
when authorization is temporarily unavailable and reload it after verification,
while retaining already-mounted browser-local editors elsewhere.

**Why:** Keeping editor input prevents data loss; keeping fetched administrative
history across an identity or authorization boundary risks disclosing another
account's private records. These two kinds of state need different lifetimes.

**How to apply:** Do not reuse editor-preservation behavior as a private-data
cache policy. Requests must guard both completion and response-body decoding
against logout/login generation changes.