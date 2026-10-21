# Database email templates

## Protected library

Settings → Email templates uses the existing authorized APIs under
`/api/v1/admin/email-templates`: bounded GET snapshot (101 records), event catalog,
GET detail, POST create/edit/delete with optimistic versions and request-bound
creation identities. Only a currently verified protected Super Admin can use
these endpoints. Template management cannot send mail or configure transport.
Staff business labels cannot grant access.

Two required assignments are protected in both the API and database:

| Template | Event | Required identity |
| --- | --- | --- |
| Forgot password | `password_recovery` | `e7e80000-0000-4000-8000-000000000001` |
| Invite staff member | `account_invitation` | `e7e80000-0000-4000-8000-000000000002` |

The invitation template serves eligible saved staff **and** MR accounts.
There is no duplicate recovery seed. The forward invitation migration preserves
administrator recovery edits and all unassigned templates. A name collision
gives the new invitation seed a bounded required suffix rather than renaming or
overwriting saved content. Required records can be edited, but not deleted,
unassigned, reassigned or truncated. Creator/creation provenance is immutable;
edits record the real authenticated updater without inventing a human creator.

## Content and rendering

The library stores only authored subject, HTML and plain text plus bounded
metadata. Names are case-insensitively unique. Limits are name 100, description
500, subject 200, HTML 100,000 and text 20,000 characters. No rendered bodies,
passwords, tokens, recipient data or transport credentials belong in templates.

Recovery variables: `name`, `email`, `company_name`, `reset_url`,
`expiry_minutes`. Invitations additionally provide `portal_name` and `login_id`.
For invitations, `reset_url` means the actual **set-password** link; it is never
a password value. Both events require a real link, visible fallback and accurate
expiry in HTML and text. Invitations also require visible company, portal and
User ID variables in both parts. Only implemented event assignments and known
literal tokens are accepted. Substitution is single-pass; recipient text cannot
create another template expression. HTML substitutions are escaped.

The safe live-email subset supports branded table layouts, bounded inline styles,
the server-owned inline EVEXIA logo, and HTTPS links. Script, arbitrary image
sources, handlers, forms, nested template syntax, unsafe CSS and unsafe URLs are
rejected. Action URLs must be the trusted recovery path with a signed fragment;
only the server-owned invitation query context is additionally permitted.

Preview remains offline and inert after substitution: sanitized HTML in the
existing sandboxed iframe, no network images, navigation, forms or executable
content. Fictional preview values never become live credentials. Inbox layout
can differ from an inert preview; do not loosen preview isolation for fidelity.

## Live dispatch

The invitation and existing recovery senders snapshot/validate the latest
committed assigned template immediately before dispatch and record its identity
and version. Saved subject/HTML/text changes affect later sends. Invalid or
unavailable required content fails explicitly; there is no hardcoded-content
fallback. Both text and HTML are sent with the owned inline MIME logo through
the approved environment-configured TLS SMTP transport, never Communication
defaults or a newly selected provider.

The shared persistent Email Logs lifecycle records pre-handoff failures and
truthful SMTP acceptance, not inbox delivery. Operational/audit evidence contains
only fixed event/category values and safe correlation identifiers, never bodies
or secret-bearing URLs. See [invitations and Email Logs](email-invitations.md)
for authorization, eligibility, encryption, state/count semantics and focused
verification. See [password recovery](password-recovery.md) for the unchanged
public recovery boundary.

## Automatic development lifecycle

The coordinated schema now includes `0053_email_invitations`; all development
migrations follow the current automatic policy and retain existing target-binding,
locking, historical integrity and transaction safeguards. Old operator-only
activation instructions for the original template introduction are historical,
not a new manual migration approval requirement.

Source generation and a disposable catalog observation do not establish original
development activation or readiness. The existing bound original-workspace
post-merge/start lifecycle must apply the new revision, then independently verify
actual database/running API declaration equality and frontend/API readiness.
Do not migrate the original target from a task fork to obtain acceptance evidence.
No production activation or real-recipient test is implied.
