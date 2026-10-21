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

### Focused runtime-recovery handoff

On 2026-10-21, the isolated task workspace had already run the managed API
startup before inspection. Its startup log reported automatic application of
`0053_email_invitations`; the API process started at 07:03:37 UTC, after the
email schema source update at 06:37:21 UTC. The predecessor process reported in
the original workspace was not accessible here, so its mismatch was not
independently reproduced or repaired.

Read-only observations in this fork confirmed:

- Actual `alembic_version`, application schema, development contract and loaded
  `/api/v1/version` schema were all `0053_email_invitations`.
- Normal same-origin `/api/v1/health/readiness` returned JSON `{"status":"ready"}`.
- Live OpenAPI advertised both `password_recovery` and `account_invitation`,
  `/api/v1/auth/set-password`, and the protected invitation route.
- Both required saved records were present, protected and valid under current
  source validation. This does not establish preservation of original-workspace
  edits across the fork's already-completed migration.
- Unauthenticated listing returned 401. No authenticated original-workspace
  listing or browser acceptance is implied by these observations.

The API was subsequently restarted through that same managed workflow. Startup
reported `READY` at `0053_email_invitations` with no additional migrations.
Private before/after comparisons confirmed that all saved template source,
identity, assignment and version values were unchanged across this restart.
Readiness and the current live OpenAPI contract were reconfirmed at the normal
same-origin ingress. The portal workflow also restarted cleanly. A screenshot
of the protected Settings route reached sign-in, not the template screen; it
does not verify authenticated listing or previews. All 13 focused source checks
below passed, including event-variable preview checks using deterministic hooks,
not a browser session.

Preconfigured release workflows were already running on entry and were stopped
when discovered; the coverage registration audit had already finished, and an
interrupted role-URL check showed failures without a final result. No release
workflow was intentionally started or rerun for this task, and those unrelated
outputs are not acceptance evidence. No real email was sent.

After merge, in the **bound original workspace**, restart only the managed
`artifacts/api-server: API Server` workflow, which uses
`scripts/start-development-api.sh`. Do not run release workflows or compatibility
suites. Normal startup performs automatic migration under its existing target,
lock, integrity and transaction guards. Stop and report a historical guard or
readiness failure; do not stamp, reset templates, change keys or replay a
reported committed migration.

Before restarting, keep any mounted editor draft open and record only private
in-memory comparisons of saved content if authorized access is available.
After startup, read the actual database revision independently and compare it
with the contract and loaded version endpoint. Through the usual same-origin
preview, verify readiness and the OpenAPI event enum/routes, then use the
existing authorized Super Admin session to **Load latest** in Settings →
Email & SMS Templates. Both protected templates must load without the invalid
response banner. Open each read-only preview and verify its event-specific
variables, fictional sample substitution and inert links; do not save or send.
Compare saved content before/after without recording template bodies or
token-bearing links. If no authorized session is available, report that
authenticated listing and screen acceptance remain unverified.

Focused source checks (no backend sends, live writes or broad suite):

```sh
node --test artifacts/evexia-portal/src/services/emailTemplates.feature.test.js artifacts/evexia-portal/src/services/emailTemplates.state.test.js
```

These cover the two-event catalog, rejection of HTTP-200 predecessor snapshots,
retained mounted/typed drafts after failed loads/saves/reconciliation, and
event-specific offline preview controls. They are not live acceptance evidence.
