---
name: Post-merge verification
description: Setup reconciliation success is not proof that restarted services are healthy.
---

After post-merge setup reports success, verify API readiness and inspect workflow logs before declaring recovery complete.

**Why:** Reconciliation reported success even though the newly merged API crashed on an uninstalled Python dependency. A later successful restart also briefly returned HTTP 502 while starting.

**How to apply:** Treat setup success and application readiness as separate checks. Allow a short bounded startup interval for health probes; investigate persistent failures rather than rerunning otherwise successful setup.

An older unmanaged process can survive a restart and keep serving outdated API routes while the managed workflow fails with “address already in use.”

**Why:** After a backend merge, the new route returned 404 despite being registered in current code; stale API and portal processes still occupied the configured ports.

**How to apply:** On bind conflicts, identify the actual process and its working directory before stopping it. Stop only confirmed stale service processes, restart the managed workflows, and verify the new route responds with the expected authorization boundary.
