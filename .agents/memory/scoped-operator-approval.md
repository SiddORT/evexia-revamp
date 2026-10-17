---
name: Scoped operator approval
description: Recovery evidence does not expand permission to execute a broader migration sequence.
---

Match operator approval to the entire reachable execution sequence, not just
its first migration. A valid recovery file is not permission for subsequent
retirement or other protected changes.

**Why:** A recovery gate before an additive predecessor can appear to provide a
targeted repair, even when the runner unconditionally continues into retirement.
The user required a separate reviewed narrow procedure rather than broader
approvals or weakening the existing full procedure.

**How to apply:** Review fixed-target reachability, recovery requirements and
postconditions separately. Preserve the existing full procedure, global migration
policy and application readiness boundary; report narrow success separately from
full-release or live-service recovery.

Pristine-catalog proof is not authorization of the target database. Never
auto-populate target-confirmation arguments from the connection being initialized
or its environment; that only confirms its own possibly incorrect configuration.

**Why:** Another empty database can satisfy every fresh-install catalog check.
Physical PostgreSQL replicas/clones can also share a cluster system identifier.

**How to apply:** Bind approval to independently reviewed server/network and
database identity. Keep target confirmation distinct from content checks and
recovery evidence; do not claim that an identifier alone verifies the host.

Reviewed fresh-install targets and manifests stay pinned when the application
schema advances beyond them; a new additive feature does not widen that approval.

**Why:** Fresh-install approval covers a specific reviewed migration sequence,
not every later repository head, even when the successor adds unrelated tables.

**How to apply:** Advance application readiness to its required head, classify
the successor explicitly, and require separate operator approval for activation
instead of silently updating an earlier runner's target or review hashes.

Explicit permission for code-only schema-review alignment allows a coordinated
review-target update only with catalog evidence from disposable PostgreSQL.
It does not authorize deployment, live data rewrites or protected migrations.

**Why:** The user separately approved code-only alignment after a pending
successor prevented the existing checksum review from running.

**How to apply:** Preserve the prior catalogs and migration classifications,
measure the real successor catalog rather than guessing from ORM metadata,
and retain independent live-activation and recovery approvals.

Routine validated automatic migrations and independently evidenced pristine
fresh installations should not require recurring human release approval.
Existing/populated protected changes still require their operator approval.

**Why:** The user explicitly requested removing the release-approval bottleneck
only for verified safe cases, not weakening protected existing-database gates.

**How to apply:** Preserve the distinction between release validation, independent
target/recovery authorization and existing-database operator approval. Never
replace those checks with a manifest status rename or treat passing tests as
production authorization.

The user confirmed the `admin-uat.allergyevexia.in` VPS checkout is active and
the `newuat.allergyevexia.in` checkout is old. Correcting filesystem references
does not authorize moving the checkout or changing portal hostname arguments,
URLs, DNS/TLS, Compose project identity or database resources.

**Why:** The user explicitly clarified that the active filesystem location and
the portal hostname are separate concerns.

**How to apply:** Keep checkout-path maintenance separate from hostname and
resource changes; obtain separate authorization for either of those operations.
