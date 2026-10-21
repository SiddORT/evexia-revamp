---
name: Post-merge verification
description: Setup reconciliation success is not proof that restarted services are healthy.
---

After post-merge setup reports success, verify API readiness and inspect workflow logs before declaring recovery complete.

An isolated task's readiness for merge and its original-development live
acceptance are separate stages. Keep mandatory original-database activation and
running-service alignment as post-merge acceptance conditions, not prerequisites
for submitting isolated source for merge.

**Why:** Requiring a task copy to prove original-database activation before
submitting its migration creates a circular dependency while its correct
workspace-identity guard prevents that activation.

**How to apply:** Let the task finish isolated implementation and permitted
checks with an explicit handoff of unverified live behavior. After merge, the
original workspace executes the authorized migration path and verifies actual
database/backend/frontend agreement before reporting full closure. Do not
equate merge readiness with successful live activation or bypass fork guards.

Keep shared release-check repairs with one active owner. If an isolated task
is already repairing its completion blockers, main must not start the same
repairs and test run in parallel.

**Why:** The user pointed out duplicated release-repair work between main and
an already active task agent.

**How to apply:** Check ownership before broadening a diagnostic into repairs.
Hand existing findings and patches to the active owner, stop overlapping runs,
and compare preserved changes at integration rather than discarding either
workspace's work.

Verify migration capabilities against the actual development PostgreSQL major,
not only the default disposable test engine.

**Why:** Unicode catalogue migration tests passed on PostgreSQL 17 while the
original development database used PostgreSQL 16 and lacked a newer builtin
collation. Transactional rollback correctly left the preceding schema intact.

**How to apply:** Check the real server version, exercise supported older-engine
upgrades in disposable clusters, and preserve Unicode uniqueness rather than
substituting ASCII behavior. Keep the separate PostgreSQL-17-only production
fresh-catalog review guard intact; development compatibility does not broaden
the production fresh-install contract.

Treat a new schema target as a runtime compatibility change as well as a
migration change. Review revision-gated crypto checks and retained feature
readiness together.

**Why:** An MR-only successor preserved account storage but failed a legacy
crypto revision allowlist; its new revision also skipped existing inventory
and opening-stock probes.

**How to apply:** Test the declared current schema as healthy, each inherited
feature as required, stale application pins as rejected, and unknown account
revisions as rejected. Update reviewed compatibility explicitly rather than
accepting arbitrary future revisions or bypassing readiness.

Workflow reconciliation can leave older development listeners outside the
new workflow's tracked process tree.

**Why:** Setup committed successfully while managed restarts failed on occupied
ports; the surviving API still reported its previous loaded schema identity.

**How to apply:** Identify port owners and verify their UID, working directory
and command before terminating only confirmed stale development listeners.
Restart the exact managed services, then verify loaded identity and ingress
readiness. Do not kill unrelated processes or change ports to hide the conflict.

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

Separate main-workspace activation evidence from task-fork observations.
Matching recorded host/database/cluster identifiers in a fork does not by itself
prove that the connection reaches the original resource rather than a copy.

**Why:** The main workspace completed a protected migration while a task fork
still reported its predecessor with the same stored target binding. Treating the
fork observation as failure of the main operation would encourage migration replay.

**How to apply:** When directed to use an updated main-workspace handoff, read
that version explicitly, label its evidence separately from local observations,
and never rerun a reported committed migration to make the fork resemble main.
Record inaccessible or non-JSON main-preview probes as unverified, not failed
application readiness or evidence of rollback.
