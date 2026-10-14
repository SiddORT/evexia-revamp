---
name: Self-contained PostgreSQL recovery
description: Schema-filtered archives may omit shared extension dependencies needed by restoration.
---

Use a full-database archive for recovery rehearsals when the application's schema
depends on extensions or operator classes installed in another schema.

**Why:** A schema-scoped archive successfully captured application tables but
failed during actual restoration because the shared pg_trgm operator class was
absent. Successful export or a matching checksum does not establish restorability.

**How to apply:** In disposable migration tests, isolate the entire database and
dump it completely rather than filtering only the test schema. For operator
recovery, retain and actually restore the complete reviewed backup with its
dependencies and independently recoverable keys. Never skip failed restore
objects or call an integrity check a restoration rehearsal.
