---
name: Docker initialization CI boundary
description: Distinguish local Docker evidence from canonical installation evidence on a hosted runner.
---

Keep canonical installation-path checks and isolated-runner restrictions intact
when adding Docker installation coverage.

**Why:** The Replit Docker daemon can build images and start containers while
`docker exec` fails at namespace entry and the canonical `/var/www` location is
read-only. A working Docker client alone does not establish that the complete
installation harness can run locally.

**How to apply:** Use a disposable GitHub-hosted runner for the unchanged
canonical-path harness. If local diagnostic runs adapt the fixture path or use
networked tool containers instead of `exec`, disclose those narrower checks;
never weaken production guards or call that an exact CI run.
