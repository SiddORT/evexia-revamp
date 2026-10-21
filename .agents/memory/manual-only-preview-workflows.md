---
name: Manual-only work and preview workflows
description: Avoid accidentally starting preconfigured release checks while restoring a preview.
---

For manual-only work, use an isolated listener for disposable CRUD rather than
restoring managed preview services solely to obtain verification evidence.
Inspect configured workflow states before and after any preview restoration.
Stop unexpected release checks immediately and disclose the observed execution;
do not claim no suites ran merely because none were intentionally invoked.

**Why:** Restoring a frontend preview coincided with automatic startup of every
configured release workflow and the API's original-target migration lifecycle,
despite the task explicitly prohibiting automated verification.

**How to apply:** Keep isolated CRUD/schema-generation evidence separate from
managed startup observations. Do not bypass identity checks or claim an isolated
fork's results establish post-merge runtime alignment.
