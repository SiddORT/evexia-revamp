---
name: Legacy attribution evidence
description: Why role updater provenance commonly needs manual review despite plausible audit timestamps.
---

Do not infer the current legacy updater from the latest visible audit event or
from a nearby timestamp, even when its actor is the protected administrator.
Creation and latest-persisted-mutation evidence are separate decisions; a
verified creator is not automatically a verified updater.

**Why:** Successful role audits historically have no saved mutation version.
Audit time is PostgreSQL transaction-start time, while edited-row update time
comes from the application clock. Complete version-counted history can still
lack definitive final-mutation timestamp evidence. Conservative manual
field-specific attribution was chosen rather than silently guessing.

**How to apply:** Preserve the accepted evidence boundary and reviewed mapping
distinction in future lifecycle work. Shared preflight/migration evidence
helpers are historical migration logic: evolve new rules through a reviewed
forward revision, not by changing the meaning of an already accepted migration.
See the role lifecycle operations document for the operator procedure.

Private reviewed mapping and backup files are not transported by code merges.
A completion report describing a migrated task database does not prove the
shared workspace database has that schema or the operator files.

**Why:** A merged lifecycle report described completed attribution, while the
shared database still required the same reviewed updater mapping.

**How to apply:** Check the live revision and preflight coverage. Require an
available reviewed map or explicit operator confirmation; never reconstruct an
approval solely from the report.
