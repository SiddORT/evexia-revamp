---
name: Session rollout compatibility
description: Why pre-session credentials are invalidated at the session schema boundary.
---

Pre-session refresh families must be preserved as revoked history rather than silently bound to newly active sessions. Old access tokens without a session reference fail closed, so a coordinated migration/API rollout requires a fresh login.

**Why:** Historical credentials have no verified session ownership or security-version snapshot. Automatically activating them across a new session boundary would silently grant access that the new policy cannot validate.

**How to apply:** When changing session schema or JWT claims, plan an explicit compatibility boundary and preserve replay evidence. Do not run an older API against a schema that requires session-bound credential creation. Coordinate rollback through reviewed forward migration or verified restore, not credential reactivation.