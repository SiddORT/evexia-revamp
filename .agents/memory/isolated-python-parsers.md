---
name: Isolated Python parsers
description: Replit Python package availability differs between parent and isolated parser processes.
---

Resource-limited Python parser subprocesses must verify their own dependency
availability; successful imports in the parent do not prove the isolated child
can import the same packages.

**Why:** Replit-installed Python packages can be available through the parent's
configured search path while Python's isolated mode intentionally excludes it.
Disabling isolation or accepting unverified files is not a safe workaround.

**How to apply:** Keep parser isolation and fail-closed behavior. If the child
requires extra package locations, pass only server-vetted installed-package
locations, never request-controlled paths. Test the real child process and its
resource limits rather than only mocking the parent verification function.