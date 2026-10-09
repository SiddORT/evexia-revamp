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

Commit synthetic ORM setup before invoking an API whose expected outcome is a
transaction rollback, even when the fixture itself is protected by an outer
disposable transaction.

**Why:** An API transaction can share the overridden fixture Session. An
expected failure correctly rolls back uncommitted setup as well as request
work, making later count assertions look like catalogue data loss.

**How to apply:** Establish the fixture's own safe commit/savepoint boundary
before error-path assertions. Do not change production rollback behavior to
retain test-only setup.

Authenticated browser fixtures must await the verified destination after each
hard navigation before issuing another hard navigation.

**Why:** Document load does not imply refresh-cookie restoration has completed.
Interrupting a rotating refresh can consume the server credential without
accepting its replacement cookie; the next load then correctly rejects replay.
This is distinct from testing SPA navigation or mounted-draft renewal.

**How to apply:** Wait for an authenticated screen element, not a fixed sleep or
only the navigation promise, when a fixture intentionally visits consecutive
protected documents. Keep replay rejection and single-session policy unchanged.

Synthetic authenticated API fixture identities must satisfy the real response
validation rules; an intentionally undeliverable reserved suffix is not
necessarily accepted by an email validator.

**Why:** A synthetic MR with an `.invalid` email authenticated internally but
failed the safe identity response's EmailStr validation, masking access-denial
tests with a server error. This is fixture validity, not authorization behavior.

**How to apply:** Use fictional addresses on a validator-supported example
domain for isolated identity fixtures, with no outbound mail/provider connection.
Do not weaken production email validation to accommodate synthetic tests.

Generate unique business identities on every fixture initialization, including
worker-level setup, rather than reuse a constant name/phone/date combination.

**Why:** Playwright restarts workers after a failed assertion while the isolated
API database remains alive. Repeated setup and subsequent engine projects can
then fail on business uniqueness before reaching the actual regression.

**How to apply:** Include a fresh synthetic tag in each seeded business identity;
do not erase records or relax production uniqueness to make later cases run.

Explicitly reselect a fixture's own record after reload when a directory resets
its selection, rather than assume the first row still belongs to that test.

**Why:** Sequential engine projects share the disposable database. A later
project can reload into an earlier project's alphabetically first role and
mistake that role's empty grants for failed permission persistence.

**How to apply:** Retain the created synthetic record's identity and verify its
selection before asserting persisted state. Do not clear other projects' data
just to force a predictable first row.

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

Shared browser fixture suites need explicit ordering of data-producing scenarios
relative to empty-state assertions. Do not assume the CLI spec argument order is
the execution order.

**Why:** A cross-master Staff selector scenario passed alone but seeded a staff
record before the existing empty-directory assertion in the full release.
Playwright sorted files independently of the supplied spec sequence.

**How to apply:** Keep uncleanable data-producing Staff scenarios after the
empty-directory assertion in the same spec, or use genuinely separate fixtures.
Do not weaken the empty-state assertion or add destructive cleanup endpoints.

Credential-producing suites must also isolate their actor/hour audit budgets.
Do not weaken production rate limits or erase protected credential history to
make a broad browser gate pass.

**Why:** Doctor fixtures and consuming workflows such as Opening Balance
legitimately provision server MR accounts. Sharing one synthetic actor's hourly
ledger across those workflows, Patient setup or MR reset scenarios can exhaust
the real credential budget despite each suite passing independently.

**How to apply:** Use a separate private database and listeners for credential
flows when combining suites; retain ordinary server provisioning and audit rules.
