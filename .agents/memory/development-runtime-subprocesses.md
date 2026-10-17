---
name: Development runtime subprocess imports
description: Test managed startup from its actual working directory without inherited harness import paths.
---

For Docker operator tools that import the mounted repository's Python package,
set the container working directory to the mounted release root (or its backend
directory). `PYTHONPATH` alone does not override an image's `/app` package:
`python -m` places its current working directory before `PYTHONPATH`.

**Why:** Loading the image package instead of the mounted operator source can
break repository-relative manifests/guards even when the source mount is valid.

**How to apply:** Test both the emitted container workdir and package resolution
from the actual operator working directory, not only an in-process import.

Apply this rule to read-only operator inspections too, not just migration
execution. Do not import repository-dependent installation helpers through
`docker exec` in the running API image.

**Why:** A healthy image can import API configuration successfully while an
installation-helper import fails before any database check. Successful earlier
configuration queries do not prove the image supports repository tooling.

**How to apply:** Use a disposable tool container with the checkout mounted
read-only and the workdir set to that mount; verify the helper's resolved source
path before checking database state. Do not change runtime path guards to make
the flattened image layout work.

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
