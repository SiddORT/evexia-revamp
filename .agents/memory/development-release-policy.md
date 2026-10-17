---
name: Development release policy
description: User-approved boundary between seamless development updates, manual diagnostics, and protected production work.
---

Routine reviewed additive development updates must not require repeated human
approval. When verification is requested, verify actual running backend and
frontend versions, not just synchronized Git commits.

**Why:** The user explicitly requested seamless development synchronization and
pointed out that synchronized Git does not prove running containers are current.

**How to apply:** Follow the manual-only development compatibility policy in
`replit.md`; it supersedes the former unattended startup/update verification.
Keep the independently approved additive synchronization boundary separate
from compatibility diagnostics. Keep destructive/operator-only and production
approvals separate; successful development checks never imply production permission.
