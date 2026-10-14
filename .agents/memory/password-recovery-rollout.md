---
name: Password recovery rollout
description: User-approved email delivery and production activation boundaries
---

The user chose an existing SMTP server for password-recovery email, not a new
transactional-email integration.

**Why:** The user explicitly selected SMTP after reviewing the alternatives.

**How to apply:** Keep recovery delivery compatible with the existing SMTP
deployment; do not replace it with another provider without asking.

Public self-service recovery is for eligible staff and existing MR accounts,
never Super Admin. The shared Admin entry must retain staff recovery even
though Super Admin also signs in there.

**Why:** The user explicitly required technical-team-only Super Admin password
recovery, including refusal of previously issued public links.

**How to apply:** Preserve that policy across issuance and consumption changes;
do not treat an Admin portal selection or a staff display-role label as an
authoritative identity type.

On the shared Admin sign-in page, show recovery guidance only after clicking
Forgot password, without leaving the page. Use exactly “Super Admin: Contact
the tech team to reset your password.” and a separate staff recovery link.

**Why:** The user confirmed that interaction; the entered identifier must not
determine the recovery guidance or disclose account type.

**How to apply:** Keep guidance independent from login errors and preserve the
existing MR recovery navigation.

For this recovery rollout, UAT access is permitted when needed, but database
migrations and production-impacting actions require reporting the exact action
and its risks first. A code push must not implicitly authorize deployment.

**Why:** The user explicitly separated Git commit/push permission from
production-impacting changes.

**How to apply:** Push recovery changes to a review branch to avoid main's
deployment trigger. Before deployed SMTP configuration, real-mail tests,
container restarts or deployment, report the exact proposed action and risks.
