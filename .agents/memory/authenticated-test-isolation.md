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

Authenticated browser fixtures must await the verified destination after each
hard navigation before issuing another hard navigation.

**Why:** Document load does not imply refresh-cookie restoration has completed.
Interrupting a rotating refresh can consume the server credential without
accepting its replacement cookie; the next load then correctly rejects replay.
This is distinct from testing SPA navigation or mounted-draft renewal.

**How to apply:** Wait for an authenticated screen element, not a fixed sleep or
only the navigation promise, when a fixture intentionally visits consecutive
protected documents. Keep replay rejection and single-session policy unchanged.

Cold synthetic previews can exceed short browser defaults when the workspace is
CPU-contended, even with correctly isolated listeners. Wait for authenticated
content and route data with bounded startup deadlines, without dropping exact
assertions or adding retries.

**Why:** A full release reached working loaders but exceeded five-second
readiness assertions and thirty-second multi-step budgets across changed and
unchanged pages. The same journeys passed under lower load.

**How to apply:** Distinguish loader/time-budget failures from authorization,
data or layout failures before changing production code. Increase only bounded
test readiness/time budgets, not accepted outcomes or security checks.

Long release suites should run through configured validation or a background
shell whose result is explicitly awaited, rather than a foreground shell
deadline that may end before the suite's summary.

**Why:** A progressing isolated release run exceeded the shell's execution
deadline before reporting its final result. Passing individual flows did not
prove that the entire release gate completed.

**How to apply:** Retain the isolated result paths and require a final suite
result. If one flow failed, verify only that failed or unverified remainder with
the existing tester; do not launch another broad browser pass for confidence.
