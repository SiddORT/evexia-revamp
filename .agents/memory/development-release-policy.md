---
name: Development release policy
description: User-approved boundary between seamless development updates, manual diagnostics, and protected production work.
---

Routine reviewed additive development updates must not require repeated human
approval. The pipeline must verify actual running backend and frontend versions,
not just synchronized Git commits.

**Why:** The user explicitly requested seamless development synchronization and
pointed out that synchronized Git does not prove running containers are current.

**How to apply:** Keep normal browsing free of recurring compatibility quarantine.
“Manual compatibility checks” does not mean removing the startup/update pipeline's
live-version verification. Reconcile overlapping manual-diagnostic work with this
distinction. Keep destructive/operator-only and production approvals separate;
successful development checks never imply production permission.
