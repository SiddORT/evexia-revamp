# Database email templates

## Protected library

Settings → Email templates uses the existing authorized APIs under
`/api/v1/admin/email-templates`: bounded GET snapshot (102 records), event catalog,
GET detail, POST create/edit/delete with optimistic versions and request-bound
creation identities. Only a currently verified protected Super Admin can use
these endpoints. Saving content cannot send mail or configure transport. The
separate, explicit saved-version test action described below can send a test.
Staff business labels cannot grant access.

Three required assignments are protected in both the API and database:

| Template | Event | Required identity |
| --- | --- | --- |
| Forgot password | `password_recovery` | `e7e80000-0000-4000-8000-000000000001` |
| Invite staff member | `account_invitation` | `e7e80000-0000-4000-8000-000000000002` |
| Invite MR member | `mr_invitation` | `e7e80000-0000-4000-8000-000000000003` |

The existing invitation assignment now serves **staff / Admin workspace only**;
MR invitations use their own identity/event, subject, HTML, plain text and version.
The signed account-invitation token and delivery purpose remain
`account_invitation` for both kinds. The verified account identity chooses the
template, never preview values or caller-supplied portal text. There is no
fallback from MR to staff content if the MR assignment is missing.

There is no duplicate recovery seed. Forward `0054_modern_email_tests` preserves
all authored source, names, identities and versions, including existing required
template edits. Only exact untouched migration source at version 1, with no
administrator attribution and unchanged timestamps, gets the new role-specific
Modern default copy. A full prior 101-record library has room for the new MR row
under the 102-record bound. A name collision gives the MR seed a required suffix rather than renaming or
overwriting saved content. Required records can be edited, but not deleted,
unassigned, reassigned or truncated. Creator/creation provenance is immutable;
edits record the real authenticated updater without inventing a human creator.

## Content and rendering

The library stores only authored subject, HTML and plain text plus bounded
metadata. Names are case-insensitively unique. Limits are name 100, description
500, subject 200, HTML 100,000 and text 20,000 characters. No rendered bodies,
passwords, tokens, recipient data or transport credentials belong in templates.

Recovery variables: `recipient_name`, `company_name`, `reset_url`,
`expiry_minutes`. Invitations additionally provide `portal_name` and `login_id`.
For invitations, `reset_url` means the actual **set-password** link; it is never
a password value. Both events require a real link, visible fallback and accurate
expiry in HTML and text. Both invitation events also require visible company, portal and
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
fallback. Both text and HTML are sent with the owned inline MIME logo.
Explicit Staff/MR invitations use the saved default Email SMTP transport from
Settings → Communication, including its sender name and encrypted credential.
Password recovery alone retains the approved environment-configured TLS SMTP
transport. Invitation trusted URL validation remains independent of transport.

The shared persistent Email Logs lifecycle records pre-handoff failures and
truthful SMTP acceptance, not inbox delivery. Operational/audit evidence contains
only fixed event/category values and safe correlation identifiers, never bodies
or secret-bearing URLs. See [invitations and Email Logs](email-invitations.md)
for authorization, eligibility, encryption, state/count semantics and focused
verification. See [password recovery](password-recovery.md) for the unchanged
public recovery boundary.

## Modern presentation and authored content

Required defaults use fixed, email-safe Modern colours: sea green `#187368`,
lavender framing `#f0eaf5`, canvas `#f7f5fa`, white cards and text `#28263a`.
They include the unchanged official bundled EVEXIA logo, inline typography,
fluid table/card widths, a prominent teal action and visible URL/plain-text
fallbacks. They do not read browser theme variables or device dark mode.

Every saved template editor offers **Apply Modern layout**. This requires a
platform confirmation warning that authored HTML will be replaced, then loads
the role-appropriate HTML into the draft only. Identity, assignment, name,
subject and plain text stay unchanged. Required HTML variables remain present;
review all parts before the normal version-checked save. For unassigned content,
the generic Modern scaffold is not a new event assignment. Cancel/discard still
uses the existing draft protections. Neither delivered nor offline preview
HTML/CSS allowlists were broadened for styling.

## Explicit saved-version test emails

Each saved card and read-only preview offers **Send test email**. The accessible
dialog names the selected version and asks for one To address, with no display
name, recipient list, whitespace or control characters. Drafts must be saved
before a test; the editor itself cannot send unsaved content.

`POST /api/v1/admin/email-templates/{id}/test` accepts
`{"version": <saved version>, "recipient": "<one email address>"}`. It is
Super-Admin-only, origin-protected and limited to ten attempts per administrator
per 15 minutes across templates/recipients. A stale version is rejected before
an email attempt or SMTP submission. The service snapshots the selected source
under a row lock and commits encrypted recipient, template identity/version,
distinct `template_test` purpose and metadata-only audit evidence before SMTP.
Historical selections are not live foreign keys: deleting an unassigned tested
template does not remove its log ID/version. Required deletion guards stay active.

The separate test renderer has no caller-owned samples or URL override.
It uses fictional staff/Admin or MR samples and the reserved nonfunctional HTTPS
address `https://email-sample.invalid/not-an-account-action`, with no account
token, invitation query or recovery fragment. Subjects begin `[TEST — EVEXIA]`;
both bodies explain that the message is a test. It never provisions an identity,
creates an account token, changes passwords or calls live invitation/recovery
workflows. Live rendering still requires the trusted set-password/recovery URL
shape and the correct portal query.

Tests and explicit Staff/MR invitations use only the **default Email** configuration saved in
**Settings → Communication** when its type is SMTP. One server-only per-attempt
snapshot decrypts and validates the saved host, port, security, username, app
password, sender name and sender email. `starttls` requires verified STARTTLS;
`tls` requires implicit TLS with certificate/hostname verification. Security
`none`, missing/invalid/unreadable settings and API/Platform defaults fail closed
before network submission, with sanitized guidance and a recorded failure
category. There is no environment fallback, alternate SMTP selection, plaintext
credential cache or configuration lock held during network work.

Template tests do not require `PASSWORD_RECOVERY_URL` or environment SMTP
credentials. Invitations likewise do not require environment SMTP, but still
require the existing trusted recovery URL for their real set-password links.
Password recovery retains environment SMTP and recovery-URL validation.

Tests retain the same no-replay lifecycle as real mail.
Pending, SMTP-accepted, failed and uncertain results are reported honestly;
acceptance is not inbox delivery. An unreadable response, lost connection or
timeout blocks resubmission in the dialog and directs the administrator to
protected Email Logs. Nothing automatically retries. Email Logs include the
test purpose filter and selected version, without storing bodies, samples,
tokens, credentials or raw transport errors.

## Automatic development lifecycle

The coordinated schema now includes `0054_modern_email_tests`; all development
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

### Saved SMTP transport handoff — source only

The saved transport changes for template tests and explicit invitations were
inspected in source only. No tests (automated,
manual, browser, smoke or SMTP), runtime requests, builds, workflow restarts,
migrations, credential changes or email sends were performed. Runtime behavior
has not been tested, at the user's request. Historical verification elsewhere
does not validate this saved-SMTP path.

### Implementation handoff — untested

This change was implemented with source review only, as requested. No automated
tests, browser/manual scenarios, runtime requests, builds, migrations or live
test sends were executed. Offline OpenAPI/client generation and development
source-integrity generation do not establish runtime correctness.

The new forward migration and development declaration/source pins are supplied.
Fresh-install verification understands both historical seeds and the three new
frozen Modern seeds. **A real PostgreSQL 17 fresh-catalog reproduction for
`0054_modern_email_tests` is still required before production release metadata
can be regenerated with `scripts/review-schema-release.py --refresh`.**
The existing catalog/review evidence is deliberately not relabelled or
fabricated. That database exercise and release checks are not authorized by this
implementation request. No services were restarted from the task fork, because
startup can apply migrations. No repository push or deployment was performed.

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
