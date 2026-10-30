# Password recovery

## Invitation and Email Logs extension

The same transport, literal database template renderer and password-change
transaction now support a separate `account_invitation` purpose. Recovery still
uses only `password_recovery`, the original signing domain/audience and edited
Forgot password template. Super Admin remains excluded and public responses
remain generic and rate limited. MR Forgot password accepts the real MR identity,
sends the recovery event, and the new password signs into the MR portal.

All eligible recovery dispatches now pass through the encrypted persistent
Email Logs ledger before rendering/SMTP. An invalid trusted reset URL or saved default SMTP configuration gives
the same 503 for every identifier and records only an anonymous configuration
failure. No submitted unknown identifier is persisted as an outgoing recipient.
Pending/sending attempts interrupted beyond two minutes become unknown, never
automatically retried. SMTP acceptance means submission, not inbox delivery.
Passwords, reset URLs/tokens, rendered messages and SMTP secrets never enter
audit/operational evidence or browser storage.

New accounts with no chosen initial password require successful password setup;
recovery may satisfy that requirement without granting staff workspace access
or changing MR identity/eligibility. Both purposes revalidate eligibility and
atomically revoke old credentials/sessions on consumption. Wrong-purpose links
cannot be interchanged. See [invitations](email-invitations.md) for the current
schema, focused captured-mail evidence and explicit post-merge runtime boundary.
Historical verification/activation notes below do not override the current
automatic development migration policy.

Recovery does not enable public registration. Existing account encryption remains
required. Recovery email content now comes exclusively from the dedicated
`email_templates` table at `0043_email_templates`; see [Email templates](email-templates.md)
for its protected event assignment and separately approved migration requirements.
There is no hardcoded or browser-local email fallback. Recovery uses only the
default Email SMTP configuration saved in Settings → Communication, as invitations
and template tests do. This supersedes the former environment-only recovery policy.

## Operator configuration (not applied automatically)

The trusted action URL remains an independent operator setting, through the
existing backend environment/secret mechanism:

- `PASSWORD_RECOVERY_URL`: an explicitly approved HTTPS URL ending in
  `/reset-password`, with no credentials, query or fragment. It must be served
  by this frontend. Never derive it from incoming Host/Origin/returnTo.
- Existing signing and account/staff encryption keys remain required. No new
  reset signing secret is necessary: a domain-separated HMAC derives the key.

SMTP comes exclusively from exactly one saved default Email configuration of type
SMTP: host, port, verified TLS mode, username, encrypted credential, sender address
and sender name. STARTTLS is mandatory for `starttls`; `tls` uses implicit TLS.
Both verify certificates and hostnames. No plaintext, environment SMTP,
alternate saved configuration or credential-cache fallback is permitted.
Communication decryption keys and access to its saved records remain required.
The sender mailbox must be authorized by the selected server; SPF/DKIM/DMARC and
inbox placement are separate operational responsibilities.

### Preflight and protected diagnostics

After the existing IP/identifier throttles and before identity lookup, the public
handler validates the trusted URL, then resolves/validates the saved default
without contacting SMTP. It discards the decrypted preflight transport immediately;
background arguments contain no transport or decrypted SMTP credential. Each actual
dispatch revalidates the URL independently and resolves a fresh coherent saved
snapshot in one database statement. Changes between preflight and dispatch may
therefore block the attempt, never cause a fallback.

Configuration failures give the same generic 503 for every identifier. Within the
existing rate limits they create an anonymous ledger entry with no user/recipient
or submitted identifier. Only fixed categories enter operational diagnostics and
protected Super Admin Email Logs:

| Category | Action |
| --- | --- |
| `recovery_url_invalid` | Operator must configure an explicitly approved HTTPS `PASSWORD_RECOVERY_URL` ending in `/reset-password`, without credentials, query or fragment. |
| `saved_smtp_missing` | Save/select a default Email SMTP configuration in Settings → Communication. |
| `saved_smtp_unsupported` | Select SMTP rather than API/Platform as the Email default. |
| `saved_smtp_insecure` | Select verified STARTTLS or TLS, not security `none`. |
| `saved_smtp_invalid` | Review host, port, TLS mode, username, app password and sender fields; duplicate defaults also fail with this category and require operator integrity review to restore exactly one default. |
| `saved_smtp_unavailable` | Restore access to the saved encrypted configuration/credential with the operator; do not replace keys or credentials speculatively. |

The URL blocker is separate from saved SMTP: configuring one does not repair the
other. URL validation runs first; after an approved repair another blocker may
be reported. Never infer the URL from the preview address or incoming request,
and never disable TLS checks to pass preflight. Public responses never include
these protected configuration details. Do not print credentials, recipients,
tokens, rendered content or raw exceptions.

### Source-only handoff and remaining blockers

The saved-recovery SMTP change was inspected in source only. No tests, regression
or release checks (including wrappers), builds, browser/manual scenarios, runtime
requests, SMTP connections, real email, service restarts, migrations, deployment,
saved-setting/default/credential/key changes or environment changes were performed.
Historical environment preflight findings do not establish the current running
configuration. The legacy environment diagnostic in `recovery_mail.configuration_issues`
does not validate saved SMTP and is not the live recovery preflight.

An approved, valid trusted reset URL remains mandatory and its current runtime
presence has not been verified. Actual saved-default decryptability/validity,
running revision, DNS, SMTP authentication/acceptance and observed inbox delivery
also remain unverified. Obtain separate approval for runtime inspection,
configuration/activation or synthetic-mail verification. Source inspection proves
neither SMTP acceptance nor delivery.

A generic 202 means only accepted for processing; a browser network error means
the request did not complete, and 429 on reset means retry later. Check protected
Email Logs before a fresh explicit request after repairing a cause. Unknown or
interrupted submissions may already have reached SMTP and must never be replayed
automatically. A sanitized background-failure log is not delivery evidence.

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

## Historical isolated verification (not rerun for saved SMTP recovery)

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
These are historical isolated results, not validation of the changed saved-SMTP
recovery path and not live inbox-delivery evidence. The commands above are
reference only; none was run for this source-only change.
