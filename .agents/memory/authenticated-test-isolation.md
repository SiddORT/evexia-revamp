---
name: Authenticated test isolation
description: Concurrent portal validation must isolate API listeners and diagnostics as well as databases.
---

Give each authenticated browser-test run its own API and portal listeners, and
its own result directory. Readiness must confirm that the newly launched
service started, not merely that some listener returns a successful response.

**Why:** All fixtures intentionally use the same synthetic Super Admin account
and enforce a single active session. Two otherwise database-isolated fixtures
on fixed ports can accidentally connect to one API; their logins replace each
other's sessions and tests fail on the login page. Shared output directories
also let concurrent Playwright runs erase each other's failure evidence.

**How to apply:** Allocate distinct free ports per run, fail closed on occupied
explicit overrides, and preserve per-run diagnostics. Investigate session
replacement notices in failed browser tests before assuming chunk-loading
latency or raising all timeouts. This is test-fixture isolation, not a reason to
weaken the production single-session policy.
