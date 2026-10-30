---
name: Communication preview boundary
description: Why Communication metadata endpoints exclude every query string and fragment.
---

Communication configuration storage is shared, encrypted and Super Admin-only, including write-only credentials. This explicitly supersedes the former browser-local metadata-only preview boundary. Saving/selecting defaults does not itself connect or send; explicit template tests and invitations are the approved saved-SMTP actions described below. The Platform option does not activate delivery. Endpoint values exclude all query strings and fragments, not just known secret parameter names.

**Why:** The initial storage approval excluded sending and transport changes; later explicit approvals expanded saved-SMTP selection as described below. Provider credential names are not standardized; query-name denylists would allow credentials under unknown aliases.

**How to apply:** Keep credentials write-only through the dedicated encrypted configuration API, never in localStorage or returned to editors. Do not migrate or delete legacy browser demo records. Delivery, key rotation and shared migration execution require separate approval. Revisit URL requirements explicitly rather than weakening validation with a short denylist.

Database email authoring is not approval to change recovery's SMTP selection or
import existing local email records. Recovery event delivery may use stored
template content while keeping environment-configured SMTP; SMS persistence and
delivery remain separate.

**Why:** The user explicitly separated database email templates and real recovery
content selection from transport changes, local-record migration and SMS backend
work.

**How to apply:** Keep those permissions separate when extending templates or
planning activation; do not broaden an additive template rollout to pending
unrelated migrations.

MR/eligible staff password recovery, explicit template test submissions and Staff/MR invitations are approved to use
the saved default Email SMTP configuration and encrypted credential, without
environment or alternate-server fallback. Recovery and invitations still need an
independently approved trusted HTTPS reset URL. API/Platform defaults and security
`none` must not send.

**Why:** The user explicitly superseded the earlier environment-only recovery
policy after selecting saved Communication SMTP for forgot-password emails.

**How to apply:** Keep fictional token-free template tests separate from real
invitation tokens, eligibility and trusted URL validation. Missing, unreadable or
invalid saved settings must fail closed with safe Settings → Communication
guidance; do not infer approval for other channels,
credential repair or live-mail verification.

For Communication recovery, confirm candidate provenance before treating a
supplied key as historical recovery evidence. Re-running a random-key generation
command produces new material, even if the same key ID is used.

**Why:** A supplied recovery candidate was later confirmed to have been newly
generated. Correcting its hex/base64 representation made it valid but could not
make it the original key; its authentication failure did not diagnose corruption.

**How to apply:** Keep candidates separate from active keys, never print material,
and verify the original custody source before repair. Encoding correction is not
key recovery, and a failed new candidate does not justify deleting saved records.