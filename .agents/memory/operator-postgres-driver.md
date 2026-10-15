---
name: Operator PostgreSQL driver compatibility
description: Operator driver compatibility and managed development proxy identity checks.
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

Do not infer that the application's client connection uses a Unix socket merely
because PostgreSQL returns NULL for inet_server_addr().

**Why:** The managed development client connected through the helium endpoint,
while PostgreSQL reported a server-side Unix-socket connection behind that
endpoint. A client-side socket-only check incorrectly rejected the right target.

**How to apply:** Validate the independently reviewed client endpoint, database
name and physical cluster identity together with the managed development
database check. Inspect only non-secret connection metadata; never print the
connection URL. Do not auto-accept a new endpoint or relax production boundaries
to accommodate a proxy.
