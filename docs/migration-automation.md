# Automatic migration policy

The project's standing policy is automatic migration execution in **both Replit
development and VPS deployment**. No separate human approval or per-revision
classification is required by the normal runners.

## What runs automatically

- Policy version 2 defaults every new, valid Alembic revision to `automatic`.
  Existing entries are all `automatic`. A revision must still exist in the
  literal migration graph; a typo, unknown database revision, dependency cycle
  or multiple source/database heads is an error.
- Normal execution is no longer limited to an AST allowlist of additive DDL.
  Data updates, seed inserts and destructive changes can execute automatically.
  **Review destructive changes before accepting the code. Automatic does not
  mean reversible or backed up.**
- Replit API startup and post-merge setup regenerate development source-integrity
  metadata, then synchronize the bound original development database to the
  schema declared in `development-contract.json`.
- VPS deployment runs the migration planner and executor before promoting the
  candidate. Exact-commit CI validation, artifact-integrity checks, deployment
  locks, maintenance-marker checks and actual-running-release checks remain.
  A migration error is a failed deployment, not an approval prompt or permission
  to promote an incompatible candidate.

Migration authors must update the coordinated schema declaration and generated
release/catalog metadata when changing the application schema. These are code
and reproducibility requirements, not human authorization evidence. The offline
generators are `scripts/review-development-schema.py --refresh` and
`scripts/review-schema-release.py --refresh`. The latter still requires a
reproduced catalog for a new fresh-install target; do not invent catalog hashes
or CI results. Do this as part of implementation, not as a separate user approval.

## Important historical limit

Changing the execution policy does **not** edit applied migrations or disable
guards inside them. In particular, organization retirement and historical
encryption transitions may still require genuine recovery evidence and write
exclusion on an older populated database. The automatic runner supplies no
retirement approval arguments and does not fabricate attestations.

Therefore an old database can still stop at an embedded safety guard. This is
an execution failure requiring the actual prerequisite to be satisfied, not a
remaining `operator_only` classification. Do not promise unattended success
through those historical transitions. Previously applied revisions never rerun.
Legacy version-1 policy files remain readable for historical/operator tooling
and tests; the active repository policy is version 2.

## What is unchanged

- Fresh databases use the documented one-command initializer, not the existing-
  database upgrade runner. Identity and genuinely pristine catalog checks remain.
- Existing databases are never stamped, recreated or treated as fresh.
- Development target identity checks and advisory locks remain. Migration errors
  roll back the development transaction; readiness and the exact final revision
  are checked before success. Production retains Alembic's transaction behavior;
  do not assume a failed multi-revision upgrade reverted all earlier work.
- Encryption validation, Super Admin protection, authentication and sessions are
  unchanged.
- A stale running backend/frontend is not made current merely by changing Git.
  Use the existing running-release verifier after restarting the intended
  development services; VPS deployment retains its running-release verification.
- This standing migration policy is not authorization for an agent to access the
  VPS, push code or deploy without permission for that operation.
