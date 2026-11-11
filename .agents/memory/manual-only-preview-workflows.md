---
name: Manual-only work and preview workflows
description: Avoid accidentally starting preconfigured release checks while restoring a preview.
---

For manual-only work, use an isolated listener for disposable CRUD rather than
restoring managed preview services solely to obtain verification evidence.
Inspect configured workflow states before and after any preview restoration.
An app-preview screenshot can itself restore all managed workflows when they
are stopped; it is not a read-only request to an isolated listener. For work
that forbids release checks, capture an isolated listener directly instead.
Stop unexpected release checks immediately and disclose the observed execution;
do not claim no suites ran merely because none were intentionally invoked.

**Why:** Restoring a frontend preview coincided with automatic startup of every
configured release workflow and the API's original-target migration lifecycle,
despite the task explicitly prohibiting automated verification.
This also occurred from an app-preview screenshot without an explicit workflow
start call.

**How to apply:** Keep isolated CRUD/schema-generation evidence separate from
managed startup observations. Do not bypass identity checks or claim an isolated
fork's results establish post-merge runtime alignment.
