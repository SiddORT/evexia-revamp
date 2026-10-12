---
name: Restored catalog fidelity
description: PostgreSQL dump/restore can change serialized constraint expressions rejected by strict operator guards.
---

Treat successful pg_restore and matching rows as insufficient evidence that a
restored catalog passes the operator retirement preflight. Schema reserialization
can change cast/expression representation without changing intended semantics.

**Why:** An independent PostgreSQL 17 rehearsal restored the membership role CHECK
with different casts; the unchanged strict retirement guard correctly rejected
its catalog. The original migration-created catalog passed.

**How to apply:** Always run the actual retirement preflight on the restored
rehearsal target. For a proven never-used fresh install, replay original migrations
to the recovery predecessor, then restore business data without overwriting
Alembic/directory-stage metadata. Verify restored data against external recovery.
Do not generalize that fresh-only procedure to populated recoveries, edit restored
constraints to force acceptance, or relax the production guard.
