---
name: Operator PostgreSQL driver compatibility
description: Disposable explicit-driver URLs can hide failures in operator CLIs on the connected app database.
---

Check operator CLIs with both bare PostgreSQL URLs and explicit Psycopg 3 URLs.
Do not install a second driver merely to fix a mismatched default.

**Why:** The connected environment supplies a bare PostgreSQL connection URL.
SQLAlchemy selects Psycopg 2 for that spelling, but this app installs Psycopg 3.
Disposable fixtures use an explicit Psycopg 3 URL and therefore did not reveal
the read-only preflight incompatibility until approved real-data inspection.

**How to apply:** Keep operator connection handling consistent with the existing
application/migration driver convention; add a bare-URL CLI regression when
introducing another database operator tool. Never print a connection string
while diagnosing the mismatch.
