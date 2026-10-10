---
name: Post-merge verification
description: Setup reconciliation success is not proof that restarted services are healthy.
---

After post-merge setup reports success, verify API readiness and inspect workflow logs before declaring recovery complete.

For staged security migrations, also reconcile the accepted migration graph
after synchronization and before freezing writers. Verify one forward head and
the exact staging revision, including upgrades from newly accepted operational
revisions; do not assume pre-merge migration evidence covers the merged graph.

**Why:** An independently accepted role migration created a second head beside
directory staging during completion synchronization. The individually passing
branches could not initialize or perform the combined operator rollout.

**How to apply:** Preserve already-applied migrations, place new unapplied stages
after them, and verify fresh initialization plus populated staged cutover in
disposable PostgreSQL. Never repair a shared revision graph by blindly stamping.

**Why:** Reconciliation reported success even though the newly merged API crashed on an uninstalled Python dependency. A later successful restart also briefly returned HTTP 502 while starting.

**How to apply:** Treat setup success and application readiness as separate checks. Allow a short bounded startup interval for health probes; investigate persistent failures rather than rerunning otherwise successful setup.

Verify browser-facing API recovery through the normal workspace ingress, not
only the standalone frontend server port.

**Why:** The workspace ingress can correctly mount the API while direct Vite
returns SPA HTML for the same request. A direct-port probe alone would
misdiagnose a routing failure and encourage an unnecessary proxy workaround.

**How to apply:** Probe the actual same-origin route and validate status,
content type and response shape. Preserve isolated test proxy overrides; do
not add a normal-development proxy when managed ingress already routes correctly.

Operational backup-and-migration sequences must fail closed at every step,
including commands issued outside the maintained setup script.

**Why:** A failed backup subprocess stopped its Python block but not the outer
shell, allowing a later migration command to run. A post-migration backup is not
a substitute for a verified pre-migration backup.

**How to apply:** Use a fail-fast shell and explicit success gating before any
database mutation. Do not call the migration if backup creation or verification
fails.

After rebasing a shared styling rename, repeat the consumer search against the
merged tree, even if the original search found no remaining uses.

**Why:** Incoming work can add consumers of removed CSS classes without causing
a textual conflict in the shared stylesheet. A clean merge and successful build
can then leave portalled menus without their palette or item styling.

**How to apply:** Search the full frontend for retired class names after the
merge, update newly introduced consumers while preserving their sizes and
behavior, and check affected surfaces rather than only the original page.
