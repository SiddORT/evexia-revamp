---
name: Development runtime subprocess imports
description: Test managed startup from its actual working directory without inherited harness import paths.
---

Validate child-process import availability separately from parent and standalone
preflight success. Managed startup tests must use the artifact working directory
and remove inherited test-harness import paths.

**Why:** A standalone preflight passed while the running API stayed blocked:
Uvicorn's app-directory setting affected its parent interpreter only, and the
test harness's inherited Python path had masked the child's import failure.

**How to apply:** Keep readiness fail-closed. Supply a server-owned backend import
path to runtime children and test the real launcher from its managed working
directory; do not treat a source/candidate pass as proof of running readiness.

Verify the browser-facing portal route as well as direct API requests during
activation. Exercise every standard fetch input form in compatibility wrappers.

**Why:** Direct API verification with the required contract header passed while
browser portal resolution failed: the new wrapper misclassified URL objects and
therefore omitted the header. A passing candidate/runtime identity check alone
did not cover that integration.

**How to apply:** Cover strings, URL objects and Requests without changing
same-origin restrictions or bypassing the contract guard. Use a rendered public
route to check the bootstrap path, not just direct authenticated API calls.
