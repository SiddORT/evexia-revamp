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

Pristine-catalog proof is not authorization of the target database. Never
auto-populate target-confirmation arguments from the connection being initialized
or its environment; that only confirms its own possibly incorrect configuration.

**Why:** Another empty database can satisfy every fresh-install catalog check.
Physical PostgreSQL replicas/clones can also share a cluster system identifier.

**How to apply:** Bind approval to independently reviewed server/network and
database identity. Keep target confirmation distinct from content checks and
recovery evidence; do not claim that an identifier alone verifies the host.
