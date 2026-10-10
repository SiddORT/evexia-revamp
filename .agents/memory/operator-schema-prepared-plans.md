---
name: Operator schema prepared plans
description: Prepared query result shapes can survive historical migrations in pooled connections.
---

Prepared query result shapes can outlive schema changes on pooled connections.
Do not assume successful DDL invalidates every client's cached statement.

**Why:** A populated migration rehearsal passed with a fresh connection but
PostgreSQL rejected a cached result shape when the same workflow reused its
connection. Fresh-process evidence alone missed the maintenance failure.

**How to apply:** When an operator workflow spans schema changes, verify it with
reused connections as well as fresh processes; drain old pools during deployment
when result shapes change. Keep fixed safe errors for driver failures and never
expose query parameters while diagnosing them.
