---
name: Authenticated navigation evidence
description: Wait for terminal authenticated pages before persistence reads or negative-control assertions.
---

Authenticated persistence tests must wait for the terminal list route after a
save, not just a URL containing the list prefix.

**Why:** Add/Edit routes share that prefix. A prefix-only assertion can succeed
while the write is still pending, so a direct list lookup can observe the
pre-commit snapshot and falsely report a lost record.

**How to apply:** Assert the actual destination pathname (allowing its feedback
query), then inspect saved data. Request completion logs alone do not prove the
read began after the commit.

Negative capability tests must also require a visible protected page before
asserting that controls are absent. After denied navigation, wait for the
terminal authenticated destination, not just a URL that differs from the
forbidden one.

**Why:** Zero matching buttons can pass on a loading screen. Advancing through
full navigations before restoration completes can interrupt refresh-cookie
rotation after the server consumes the previous credential, leaving later
steps signed out. A valid intermediate redirect is not evidence of completion.

**How to apply:** Require a visible protected heading after initial restoration
and after redirects, then make negative capability assertions or navigate
again. Do not weaken single-use refresh behavior or staff permission checks to
compensate for test timing.
