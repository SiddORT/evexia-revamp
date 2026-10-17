---
name: Release fixture reuse
description: Why release-speed improvements stop at pre-bootstrap schema setup
---

Reuse setup only before bootstrap; do not cache a provisioned Super Admin,
authenticated history, password-hash results or passing test outcomes.

**Why:** Reusing account setup would avoid real bootstrap/password-hashing
behavior, and shared actor/hour budgets and single-session rules can make
otherwise independent fixtures interfere. The speed requirement explicitly
retains backend, migration, security and three-engine assertions.

**How to apply:** Optimize deterministic empty-schema preparation and independent
service startup. Preserve dedicated credential fixtures, fresh bootstrap and
failure propagation. Keep performance reports separate from release approval.
