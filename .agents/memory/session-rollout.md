---
name: Session rollout compatibility
description: Why pre-session credentials are invalidated at the session schema boundary.
---

Pre-session refresh families must be preserved as revoked history rather than silently bound to newly active sessions. Old access tokens without a session reference fail closed, so a coordinated migration/API rollout requires a fresh login.

**Why:** Historical credentials have no verified session ownership or security-version snapshot. Automatically activating them across a new session boundary would silently grant access that the new policy cannot validate.

**How to apply:** When changing session schema or JWT claims, plan an explicit compatibility boundary and preserve replay evidence. Do not run an older API against a schema that requires session-bound credential creation. Coordinate rollback through reviewed forward migration or verified restore, not credential reactivation.

Treat logout using intentionally preserved, already-revoked refresh history with no session binding as an idempotent no-op, not a corrupt-session security failure.

**Why:** Those records are an expected migration outcome. Repeated presentation of an old credential must not reactivate it or flood audit history with false ownership failures.

**How to apply:** Distinguish retired unbound history from a bound credential whose persisted owner/session relationship is inconsistent; only the latter merits a meaningful failure event.