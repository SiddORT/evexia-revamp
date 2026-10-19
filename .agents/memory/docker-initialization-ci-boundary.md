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

Confirm the exact commit and job logs before associating an error excerpt with
a run.

**Why:** A reported initialization 503 and stale schema assertion belonged to a
later run; the named earlier commit actually stopped on release-policy rejection.
Treating them as the same failure would hide the first guard's evidence.

**How to apply:** Record each run's SHA and failing step, then separate earlier
policy failures from later readiness failures. A retained maintenance message
does not by itself establish which schema or bootstrap state committed.
