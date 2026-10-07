---
name: Post-merge verification
description: Setup reconciliation success is not proof that restarted services are healthy.
---

After post-merge setup reports success, verify API readiness and inspect workflow logs before declaring recovery complete.

**Why:** Reconciliation reported success even though the newly merged API crashed on an uninstalled Python dependency. A later successful restart also briefly returned HTTP 502 while starting.

**How to apply:** Treat setup success and application readiness as separate checks. Allow a short bounded startup interval for health probes; investigate persistent failures rather than rerunning otherwise successful setup.

After rebasing a shared styling rename, repeat the consumer search against the
merged tree, even if the original search found no remaining uses.

**Why:** Incoming work can add consumers of removed CSS classes without causing
a textual conflict in the shared stylesheet. A clean merge and successful build
can then leave portalled menus without their palette or item styling.

**How to apply:** Search the full frontend for retired class names after the
merge, update newly introduced consumers while preserving their sizes and
behavior, and check affected surfaces rather than only the original page.

