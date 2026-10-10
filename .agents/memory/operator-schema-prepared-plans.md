---
name: Operator schema prepared plans
description: Prepared query result shapes can survive historical migrations in pooled connections.
---

Avoid reusing additive-stage `SELECT *` prepared queries after final retirement
adds configuration columns; final maintenance should use an explicit projection
distinct from the additive query.

**Why:** Populated disposable migration rehearsals reused pooled Psycopg connections
and PostgreSQL rejected the cached query because its result type changed. Production
outages must likewise restart/drain old connections rather than assume DDL clears
every client prepared statement.

**How to apply:** When an operator workflow spans schema changes, verify it with
reused connections as well as fresh processes. Keep fixed safe errors even for
driver failures; do not expose query parameters while diagnosing them.
