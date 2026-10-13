# Password recovery

Task 02 is complete. Recovery adds no tables or migrations, changes no migration
policy, and does not enable public registration. Existing account encryption and
application revision `0035_account_identifiers` are still required.

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

## Security and behavior

Both endpoints require the existing origin validation. Request accepts current
email/User ID and admin/MR portal intent; staff use their issued User ID and mail
goes to their encrypted staff contact. Active login eligibility is checked before
delivery and again under locks at reset. Missing email, disabled/deleted accounts,
wrong portal, unknown identifier and identifier throttling return the same 202.
Historical reservations never resolve recovery identities.

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
