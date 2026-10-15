---
name: Role directory refresh boundaries
description: Why role directory refreshes reset cursor depth instead of replaying all loaded batches.
---

Refresh the role directory from the first batch and retain the selected role through a bounded detail read; do not automatically replay every previously loaded cursor.

**Why:** A long scrolling session must not turn a focus refresh or mutation into an unbounded directory scan. Cursor chains can also become obsolete after mutations. Selection and permission drafts must survive that reset.

**How to apply:** Keep background appends separate from explicit unknown-save reconciliation. Automatic loading must not supersede the authoritative reconciliation read, and append failures require user-directed retry rather than focus-triggered retry.
