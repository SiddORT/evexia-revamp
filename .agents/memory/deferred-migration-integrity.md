---
name: Deferred migration integrity
description: Keep populated backfills and later DDL atomic while respecting deferred identity guards.
---

When a forward migration updates rows protected by deferred integrity triggers,
validate and drain the pending checks inside the same transaction before altering
the table. Never disable those guards or split the backfill into a separately
committed transaction to make the DDL succeed.

**Why:** PostgreSQL rejects ALTER TABLE while deferred trigger events remain
pending, even when the populated backfill itself is valid. Empty-schema tests do
not expose this interaction.

**How to apply:** Exercise populated historical-schema upgrades and atomic failure
cases when adding relationships to identity-backed tables; include inactive and
deleted rows and assert unrelated identity/audit data remains unchanged.
