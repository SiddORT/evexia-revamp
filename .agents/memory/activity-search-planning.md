---
name: Activity search planning
description: Performance pitfalls when combining safe search projections, literal matching, and pagination.
---

Benchmark broad searches, maximum offsets, and export ceiling probes as well
as rare searches before changing audit search predicates.

**Why:** A trigram candidate index made selective searches fast, but adding a
redundant CASE-projection recheck caused severe broad-query selectivity
underestimation and full-scan sorts. Expression statistics alone did not fix
the redundant predicate. Separately, an escaped literal percent made the actor
join estimate nearly every user as matching even when none did.

**How to apply:** Preserve the full safe matching contract, but prove redundant
checks unnecessary rather than retaining costly predicates automatically.
Inspect EXPLAIN estimates and actual rows for actor matches and common outcomes,
not only index usage for rare references. Use the synthetic profiling harness;
never profile real production history for this purpose.

Keep an indexed immutable sanitizer versioned; a changed projection requires
a rebuilt dependent index and refreshed statistics.

**Why:** PostgreSQL trusts an immutable function's existing index entries and
does not rebuild them automatically when its body changes. Editing that body
in place can silently produce incorrect search results.

**How to apply:** Introduce a new function/index version through a forward
migration when changing sanitizer semantics. Friendly UI labels should remain
explicit live aliases rather than being frozen into indexed text.

Exclude the outer schema from disposable migration-test search paths.

**Why:** Adding public as a fallback let Alembic discover the outer schema's
version table instead of creating an isolated one; a test downgrade then
removed shared test objects.

**How to apply:** Use only the disposable schema, and explicitly resolve
extension namespaces instead of adding public to the search path.

Do not reuse bounded top-K audit candidates for reports that promise exact totals.

**Why:** Audit pagination only needs enough candidates to establish `has_more`.
The download ledger must count every match and return that count and its page
from one snapshot. Truncating candidates can make a fast query silently lie
about history size.

**How to apply:** Treat exact-count reports as a different performance contract.
Benchmark count work separately from ordered page work, including broad,
zero-match and past-end requests. Do not trade exact totals for bounded latency
without an explicit product decision.
