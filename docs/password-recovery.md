# Password recovery

Recovery does not enable public registration. Existing account encryption remains
required. Recovery email content now comes exclusively from the dedicated
`email_templates` table at `0043_email_templates`; see [Email templates](email-templates.md)
for its protected event assignment and separately approved migration requirements.
There is no hardcoded or browser-local email fallback. This does **not** switch
delivery to encrypted Communication configuration defaults.

## Operator configuration (not applied automatically)

Use the existing backend environment/secret mechanism:

- `PASSWORD_RECOVERY_URL`: an explicitly approved HTTPS URL ending in
  `/reset-password`, with no credentials, query or fragment. It must be served
  by this frontend. Never derive it from incoming Host/Origin/returnTo.
- `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_FROM` (mailbox authorized by the
  mail server; configure SPF/DKIM/DMARC for delivery).
- `SMTP_IMPLICIT_TLS=false` for mandatory STARTTLS; `true` for implicit TLS,
  typically port 465. Certificate verification is mandatory in both modes.
- `SMTP_USERNAME` and `SMTP_PASSWORD` together for authenticated SMTP, or neither
  for a deliberately approved TLS relay. Store the password as a secret.
- Existing signing and account/staff encryption keys remain required. No new
  reset signing secret is necessary: a domain-separated HMAC derives the key.

Do not print credentials, tokens, recipient addresses or email bodies in logs.
Missing/invalid configuration gives the same 503 for every identifier.

### Sanitized investigation findings

The workspace failure was reproduced through the frontend's same-origin API
proxy: `POST /api/v1/auth/forgot-password` returned **503 service_unavailable**
for a synthetic unknown identifier. An offline preflight of the effective local
backend settings reported exactly these invalid/missing categories:

- `PASSWORD_RECOVERY_URL:missing_or_invalid`
- `SMTP_HOST:missing_or_invalid`
- `SMTP_FROM:missing_or_invalid`

The workspace configuration presence check confirmed these settings are absent,
not merely rejected URLs/mailboxes. Default port 587 and STARTTLS are not the
blocker; authentication settings are absent as a pair. No SMTP connection was
attempted. This explains the screenshot's unavailable condition in this
workspace, before identity lookup; it is not evidence of a bad staff User ID or
an SMTP transport error. Deployed/UAT configuration was not inspected or changed.
Missing approved URL and SMTP settings remain a **rollout blocker**.

The request handler now logs only fixed configuration category codes. An operator
can also run this offline command from `artifacts/api-server` in the intended
runtime, without printing settings or connecting to SMTP or the database:

```sh
PYTHONPATH=backend python -c 'from app.core.config import get_settings; from app.services.recovery_mail import configuration_issues; print(", ".join(configuration_issues(get_settings())) or "Recovery configuration valid; delivery not tested")'
```

It requires the normal backend environment. If settings fail to parse at startup
(for example a non-integer port), repair the setting through the normal secret/
environment mechanism; do not paste raw settings-validation exceptions into
reports, as they can contain supplied values.

For a 503, provide an explicitly approved reset URL and the selected existing
SMTP server's host and authorized sender, then check port, TLS mode and paired
authentication. Do not derive a trusted URL from a browser request or disable
TLS checks to pass preflight. Obtain separate approval before applying deployed
settings or restarting services. A successful offline preflight only establishes
configuration shape, not DNS, SMTP authentication, acceptance or inbox delivery.

Distinguish other failures: a browser network error means the request did not
complete; 429 on reset means retry later; a generic 202 means only accepted for
processing. A later sanitized `Password recovery delivery failed` log identifies
background processing/delivery failure, never proof of delivery. Investigate
privately with the existing SMTP operator, without enabling body/recipient/token
logging, and request a fresh link after repairing the cause.

## Security and behavior

Both endpoints require the existing origin validation. Request accepts current
email/User ID and admin/MR portal intent; staff use their issued User ID and mail
goes to their encrypted staff contact. Active login eligibility is checked before
delivery and again under locks at reset. Missing email, disabled/deleted accounts,
wrong portal, unknown identifier and identifier throttling return the same 202.
Historical reservations never resolve recovery identities.

**Super Admin is excluded from public self-service recovery**, both before
issuance and under the reset lock, including valid links issued by the old
policy. Eligibility uses persisted identity type/protection, not an email,
staff display-role label, client selection or portal name. The shared Admin
portal continues to support eligible staff using their issued User ID. Both its
sign-in entry and recovery page state:
“Super Admin: Contact the tech team to reset your password.”
Normal Super Admin sign-in is unchanged; there is no technical-team reset tool
in this feature.

Requests are throttled per keyed identifier and IP, with transactional advisory
locks. Account lookup and SMTP delivery run after sending the generic response,
preventing account/SMTP timing from disclosing existence. Background delivery is
best-effort in-process, **not a durable queue**. If a process stops or SMTP fails,
request a new link; no password/session changes occurred. Monitor the sanitized
delivery-failure log. If traffic needs reliable queued delivery, review that
separately rather than silently claiming delivery guarantees.

The emailed signed token contains no plaintext email/username and is confined
to a URL fragment, removed by the frontend on load and held only in memory.
It expires after 15 minutes. Purpose, issuer, audience, account/identity versions
and a keyed current-recipient binding are verified. Reset never automatically
logs a user in and never grants permission.

Single use is enforced by the existing monotonically increasing `token_version`
under the user row lock: one successful reset consumes **all** links issued for
that credential version. Password changes/resets invalidate older links; recipient
or identity changes invalidate them too. Requests alone do not revoke sessions or
consume another person's links. A successful reset atomically changes the Argon2
password hash, increments version, revokes sessions and refresh chains, and records
the security audit event. Failure rolls back all those changes. Reusing the same
password is rejected without consuming the link.

## Rollout and smoke checks

No UAT access/configuration, migration, real email or deployment was performed
by implementation tests. Obtain operator approval before changing deployed SMTP
configuration/restarting containers or merging a deployment-triggering branch.
Risks: wrong recipient configuration or DNS can prevent recovery; wrong link URL
can send users to the wrong site; enabling SMTP sends real mail.

After deliberate configuration and deployment, test only an approved synthetic
account/mailbox: request → receive → reset → new-password login; old links,
old password, access JWT and refresh cookies must fail. Verify unknown-account
response is identical and public registration stays 403. Never share the link.
Rollback the application release if needed; already reset passwords/sessions
are security changes and should not be restored from an old database snapshot.

## Isolated verification

```sh
sh scripts/test-api-foundation.sh tests/test_password_recovery.py
node --test artifacts/evexia-portal/src/services/passwordRecovery.test.js
sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/password-recovery.preview.spec.mjs
pnpm --filter @workspace/evexia-portal run build
```

The browser recovery spec must run alone through that harness. It initializes
only a new private socket-only PostgreSQL fixture, synthetic identities and keys,
and separate API/frontend listeners. Its guarded test-only application wrapper
intercepts SMTP transport, exercising actual message and trusted-link
construction with verified-TLS sequencing but making **no network SMTP call**.
The private fixture and intercepted outbox are removed on exit. There are no
test-only routes, delivery captures or overrides in the normal application.
Traces, videos and automatic screenshots are disabled for these tests so
passwords and fragments do not enter test diagnostics.

Coverage includes Super Admin issuance exclusion and valid old-token refusal
without password/session changes; staff current encrypted recipient and
disabled/deleted/changed-email rejection; MR success; expiry/single use,
concurrent consumption, old password/access/refresh invalidation and new login;
missing/malformed links, mismatch, same-password guidance, loading, success,
temporary failure/retry, stale-response suppression, keyboard submission and
centered layouts without horizontal overflow at 320, 375, 768 and 1440px.
These are isolated results, not live inbox-delivery evidence.
