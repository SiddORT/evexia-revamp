---
name: Completion gate runtime
description: Distinguish release test failures from termination by the completion checker's waiting limit.
---

The completion checker has a bounded polling budget. An oversized full release
suite can exhaust it and receive Hangup while tests are still passing. This is
not evidence that the remaining checks passed, nor an application test failure.

**Why:** A full multi-engine release run exceeded the checker's 1,800-poll budget
and its shell was terminated during later fixture groups after successful
earlier groups. Repeating the whole suite can reproduce the same cutoff.

**How to apply:** Inspect the actual shell log and terminal state. Fix concrete
assertion failures separately. Do not repeatedly rerun an unchanged oversized
gate or weaken its assertions. Prefer operator-approved splitting into smaller
named validation steps. If the current completion infrastructure genuinely
cannot finish the configured gate, preserve scoped test evidence and explicitly
audit that limitation; never claim the unfinished full gate passed.

The tester's shell command may hit its timeout during slow isolated fixture
startup, before any Playwright results exist. Detached shell launches there
are not reliably retained. Use the main agent's supported background shell
facility with a retained log when setup needs longer than the foreground limit.

Task completion can create a local implementation commit even when a later
required validation fails. Commit creation, task acceptance and pushing are
separate states.

**Why:** A completion attempt passed code review and recorded the local changes,
but the broader release command failed and the task remained incomplete.

**How to apply:** After a failed completion attempt, inspect Git status and the
latest local commit before reporting commit/push status. Do not infer that no
commit exists from the failed task status, and never infer that a local commit
was pushed or deployed.

Completion synchronization may rebase local task commits onto newer project
changes, rewriting their hashes without changing their intended contents.

**Why:** Concurrent project changes caused completion-time conflict resolution
and new hashes for already recorded implementation commits.

**How to apply:** If the user requires preserving an exact local commit, retain
it with a named local backup ref before completing synchronization. Report the
original preserved ref separately from the rebased task history; do not claim
the original hash remains an ancestor when it is only retained on that ref.

**Why:** A timed-out setup and detached-launch attempts produced no test
results, whereas the supported background task retained the process through
slow PostgreSQL/browser setup.

**How to apply:** First confirm the earlier harness process ended and no specs
ran. Continue the same intended test pass through a tracked background task;
do not start duplicate fixtures or mistake absent output for a passing test.
