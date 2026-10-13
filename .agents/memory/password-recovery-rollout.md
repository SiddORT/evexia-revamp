---
name: Password recovery rollout
description: User-approved email delivery and production activation boundaries
---

The user chose an existing SMTP server for password-recovery email, not a new
transactional-email integration.

**Why:** The user explicitly selected SMTP after reviewing the alternatives.

**How to apply:** Keep recovery delivery compatible with the existing SMTP
deployment; do not replace it with another provider without asking.

For this recovery rollout, UAT access is permitted when needed, but database
migrations and production-impacting actions require reporting the exact action
and its risks first. A code push must not implicitly authorize deployment.

**Why:** The user explicitly separated Git commit/push permission from
production-impacting changes.

**How to apply:** Push recovery changes to a review branch to avoid main's
deployment trigger. Before deployed SMTP configuration, real-mail tests,
container restarts or deployment, report the exact proposed action and risks.
