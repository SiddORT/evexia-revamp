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

On the shared Admin sign-in page, Forgot password must navigate directly to
the recovery page, with no inline Super Admin guidance or separate staff link.
Show “Super Admin: Contact the tech team to reset your password.” only when
the known Super Admin email is entered on the recovery page. Other identifiers
keep the normal recovery flow. Preserve recovery theme support and background image.

**Why:** The user repeated this requirement after a merge restored the older
inline guidance and unconditional recovery-page message.

**How to apply:** Preserve this interaction during merges; do not introduce
an account-type lookup or weaken backend Super Admin recovery protection.

Invited MRs set their own password through an emailed setup link, then sign in
to the MR portal. The user requests the modern theme, a background image, and
show/hide eye controls for both password fields on that setup screen.

**Why:** The user explicitly requested this invitation experience.

**How to apply:** Preserve the dedicated invitation flow and its presentation
when merging login or recovery changes; do not send passwords in invitations.

For this recovery rollout, UAT access is permitted when needed, but database
migrations and production-impacting actions require reporting the exact action
and its risks first. A code push must not implicitly authorize deployment.

**Why:** The user explicitly separated Git commit/push permission from
production-impacting changes.

**How to apply:** Push recovery changes to a review branch to avoid main's
deployment trigger. Before deployed SMTP configuration, real-mail tests,
container restarts or deployment, report the exact proposed action and risks.
