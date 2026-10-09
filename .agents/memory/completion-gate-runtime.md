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

**Why:** A timed-out setup and detached-launch attempts produced no test
results, whereas the supported background task retained the process through
slow PostgreSQL/browser setup.

**How to apply:** First confirm the earlier harness process ended and no specs
ran. Continue the same intended test pass through a tracked background task;
do not start duplicate fixtures or mistake absent output for a passing test.
