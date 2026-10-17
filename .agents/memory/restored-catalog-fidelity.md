---
name: Restored catalog fidelity
description: PostgreSQL dump/restore can change serialized constraint expressions rejected by strict operator guards.
---

Treat successful pg_restore and matching rows as insufficient evidence that a
restored catalog passes the operator retirement preflight. Even same-major
restoration can change cast/expression representation without changing semantics.

For a populated-development full-archive rehearsal, compare the restored schema
against a separate disposable reference created from the complete source
schema-only SQL using the same PostgreSQL major. Compare canonical dumps without
discarding SQL definitions; independently compare all restored row contents.
This is not migration replay or a replacement for the actual operator preflight.

**Why:** Both PostgreSQL 16-to-17 and 16-to-16 archive restoration reserialized
array casts and flattened CHECK conjunctions, making raw dump byte equality an
invalid fidelity test. A native schema-only reference preserves every supplied
definition without inventing textual normalization or modifying either catalog.

**How to apply:** Require error-on-first-failure for both independent restores,
same-major tools, exact canonical schema comparison, full data comparison and the
actual unchanged migration/readiness rehearsal. Never use this comparison to
replace frozen production/fresh-install catalog evidence.

Do not replace a frozen fresh-install catalog digest with a fingerprint from a
retained restored development rehearsal just to admit a new additive migration.
Development PostgreSQL can also differ from the fresh-install supported major.

**Why:** A retained PostgreSQL 17 Communication rehearsal's predecessor projection
did not match the frozen fresh-install predecessor, despite successful restoration.
The shared development database also used a different PostgreSQL major.

**How to apply:** Preserve the frozen predecessor contract; review added catalog
rows exactly, and require fresh-install validation separately. Read-only restored
catalog inspection does not establish a successful fresh-install rehearsal.

**Why:** An independent PostgreSQL 17 rehearsal restored the membership role CHECK
with different casts; the unchanged strict retirement guard correctly rejected
its catalog. The original migration-created catalog passed.

**How to apply:** Always run the actual retirement preflight on the restored
rehearsal target. For a proven never-used fresh install, replay original migrations
to the recovery predecessor, then restore business data without overwriting
Alembic/directory-stage metadata. Verify restored data against external recovery.
Do not generalize that fresh-only procedure to populated recoveries, edit restored
constraints to force acceptance, or relax the production guard.

Keep complete archive recovery evidence separate from exact-catalog continuation
evidence. A replay-plus-data-only clone is not proof that a full archive restores.

**Why:** A full restoration can match all data and pass the bounded retirement
preflight while still having reserialized CHECK text elsewhere that an exact
fresh-install catalog projection rejects. Neither check substitutes for the other.

**How to apply:** Rehearse complete restoration and review any DDL differences;
use a separate migration-replayed clone for the exact protected continuation.
Retain both results before human attestation. Never delete or overwrite an
operator recovery target merely to reuse it for the second proof.

The reviewed membership predicate permits only its two exact equivalent typed
array-cast forms, never arbitrary cast removal or expression simplification.
Grouping normalization must preserve characters inside quoted literals.

**Why:** Logical restore distributes a varchar-array-to-text-array cast over its
elements. Blind parenthesis removal also incorrectly matches altered role literals.

**How to apply:** Treat any new serialization form as a separate compatibility
review with strict negative tests. Preserve all operator gates and update the
pinned fresh-install guard review when its source changes.

Rehearsal databases must preserve the source encoding and locale settings.

**Why:** An isolated cluster initialized with `--no-locale` can default to
SQL_ASCII; Psycopg then returns text as bytes and catalog comparisons can fail
before the actual restoration safeguards are evaluated.

**How to apply:** Explicitly select the source encoding when creating the
rehearsal database. Compare data and catalog contracts separately, and never
treat matching rows as proof that the unchanged operator preflight passes.

SQL superuser/replication role flags do not establish physical-backup access.

**Why:** The managed development connection denied replication through its HBA
rules despite those role flags and an enabled WAL sender configuration.

**How to apply:** Verify provider/protocol permission before promising physical
recovery; do not change managed-server access controls to work around that denial.
