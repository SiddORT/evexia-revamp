---
name: Post-merge verification
description: Setup reconciliation success is not proof that restarted services are healthy.
---

After post-merge setup reports success, verify API readiness and inspect workflow logs before declaring recovery complete.

**Why:** Reconciliation reported success even though the newly merged API crashed on an uninstalled Python dependency. A later successful restart also briefly returned HTTP 502 while starting.

**How to apply:** Treat setup success and application readiness as separate checks. Allow a short bounded startup interval for health probes; investigate persistent failures rather than rerunning otherwise successful setup.
