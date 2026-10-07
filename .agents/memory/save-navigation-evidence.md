---
name: Authenticated save navigation evidence
description: Avoid false missing-record results when create and edit routes share the list route prefix.
---

Authenticated persistence tests must wait for the terminal list route after a
save, not just a URL containing the list prefix.

**Why:** Add/Edit routes share that prefix. A prefix-only assertion can succeed
while the write is still pending, so a direct list lookup can observe the
pre-commit snapshot and falsely report a lost record.

**How to apply:** Assert the actual destination pathname (allowing its feedback
query), then inspect saved data. Request completion logs alone do not prove the
read began after the commit.
