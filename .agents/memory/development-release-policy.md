---
name: Development release policy
description: User-approved boundary between seamless development updates, manual diagnostics, and protected production work.
---

Routine development updates must not require repeated human
approval. When verification is requested, verify actual running backend and
frontend versions, not just synchronized Git commits.

**Why:** The user explicitly requested seamless development synchronization and
pointed out that synchronized Git does not prove running containers are current.

**How to apply:** Follow the manual-only development compatibility policy in
`replit.md`; it supersedes the former unattended startup/update verification.
The current migration-automation scope is recorded in `replit.md`; it supersedes
the old additive/operator classification boundary. Keep synchronization separate
from compatibility diagnostics. Successful development checks never imply
permission to access or deploy to production.

Staged migrations can be merged ahead of the application's declared schema.
Such staged source must not implicitly advance the coordinated contract
or prevent restarting the already-compatible application.

**Why:** A staged operator migration made the production source-head invariant
block development setup even though the approved database needed no upgrade.

**How to apply:** Validate the complete source graph, classifications and hashes
before planning only the declared development ancestry. Reject unknown, tampered,
divergent or ahead-of-contract database states. Keep production's strict
source-head requirement unchanged; successful development setup is not release
approval or permission to deploy.

Routine development synchronization must not depend on the
freshness of unrelated production fresh-install review evidence.

**Why:** Stale production approval prevented even development database inspection,
concealing the actual protected pending path behind a generic installation failure.

**How to apply:** Keep an independent exact development integrity/ancestry review.
Preserve independent target binding and atomicity. Advancing the source target
does not prove the live database or running services have advanced.

For EVEXIA, a genuinely pristine database should have a single initialization
command, without external signed release/recovery files or a restoration
rehearsal. Routine patches should get their validation automatically from CI,
without separate signing-key provisioning. Keep embedded recovery requirements
for historical destructive existing-data work.

**Why:** The user explicitly approved simplifying installation after being
blocked for days by safeguards intended for populated legacy databases.

**How to apply:** Never reintroduce legacy retirement paperwork into the
empty-only path. Preserve real target/emptiness checks, atomic bootstrap,
authentication/encryption, exact-commit CI integrity and runtime verification.
