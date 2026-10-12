---
name: Scoped operator approval
description: Recovery evidence does not expand permission to execute a broader migration sequence.
---

Match operator approval to the entire reachable execution sequence, not just
its first migration. A valid recovery file is not permission for subsequent
retirement or other protected changes.

**Why:** A recovery gate before an additive predecessor can appear to provide a
targeted repair, even when the runner unconditionally continues into retirement.
The user required a separate reviewed narrow procedure rather than broader
approvals or weakening the existing full procedure.

**How to apply:** Review fixed-target reachability, recovery requirements and
postconditions separately. Preserve the existing full procedure, global migration
policy and application readiness boundary; report narrow success separately from
full-release or live-service recovery.
