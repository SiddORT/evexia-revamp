---
name: Operator revision boundaries
description: Head changes can strand approved offline maintenance even if its domain storage is unchanged.
---

When adding a schema revision, reconcile offline maintenance revision allowlists
as well as application readiness. Test an already paused maintenance operation
crossing the new boundary, not only starting on the new head.

**Why:** Advancing the head after directory encryption initially left the merged
key-rotation tool unable to verify or finish a frozen rotation despite unchanged
encrypted directory storage.

**How to apply:** Accept only explicitly reviewed compatible revisions, verify
the required physical storage projections, retain existing approval/recovery
evidence, and preserve fail-closed behavior for unknown future schemas.
