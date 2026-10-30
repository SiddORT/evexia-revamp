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

A generic identity-encryption-unavailable failure on a new schema can mean its
explicit compatible-revision boundary was not reviewed, even when the migration
adds only unrelated tables. Do not replace keys to resolve a schema rejection.

**Why:** Identity crypto readiness rejects unreviewed heads before ordinary
authenticated feature operations, independently of whether their new tables
contain account data.

**How to apply:** Accept only explicitly reviewed compatible revisions, verify
the required physical storage projections, retain existing approval/recovery
evidence, and preserve fail-closed behavior for unknown future schemas.

Application readiness and unattended post-merge schema checks must share the
current coordinated release head, not a historical operator revision.

**Why:** Maintenance compatibility across approved older schemas does not mean
the current application can safely serve them after adding encrypted fields.
