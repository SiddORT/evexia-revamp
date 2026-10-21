---
name: Migration child dependency evidence
description: External CI interpreters and Replit startup hooks can produce different subprocess import results.
---

Verify migration subprocess imports with an external interpreter and only the
explicit dependency exposure used by CI, not just the project's Python launcher.

**Why:** Replit Python startup hooks can make `.pythonlibs` available even after
a child replaces `PYTHONPATH`. This masked a CI-only failure where the backend's
migration directory became an `alembic` namespace package without `__main__`,
instead of resolving the installed Alembic distribution. A successful local
parent import or version probe with ambient startup hooks was misleading.

**How to apply:** Use synthetic disposable PostgreSQL for actual DDL checks and
remove Replit-only package startup hooks in CI-layout test environments. Keep
public operator diagnostics suppressed; inspect child errors only in synthetic
reproductions. Local equivalence is not an exact-commit GitHub release pass.
