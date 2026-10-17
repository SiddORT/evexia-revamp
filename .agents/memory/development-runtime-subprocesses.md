---
name: Development runtime subprocess imports
description: Test managed startup from its actual working directory without inherited harness import paths.
---

Validate child-process import availability separately from parent and standalone
preflight success. Managed startup tests must use the artifact working directory
and remove inherited test-harness import paths.

**Why:** Under the former automatic gate, a standalone preflight passed while the running API stayed blocked:
Uvicorn's app-directory setting affected its parent interpreter only, and the
test harness's inherited Python path had masked the child's import failure.

**How to apply:** Supply a server-owned backend import path to manual diagnostic
children and test the real launcher from its managed working directory. A
source/candidate pass is not proof of loaded-process compatibility. The former
automatic gate and browser contract wrapper have been removed; do not restore
them as a workaround for diagnostic import failures.
