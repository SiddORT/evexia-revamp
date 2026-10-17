# Database email templates

## Storage and management

Email templates now use protected APIs under `/api/v1/admin/email-templates`:

- `GET ""`: bounded snapshot (at most 100 templates), including event metadata.
- `GET /events`: implemented backend events and available variables.
- `GET /{id}`: current detail for direct editing or preview.
- `POST ""`: create unassigned content with a client-generated `creation_id` UUID.
- `POST /{id}/edit`: replace editable fields with an expected integer `version`.
- `POST /{id}/delete`: delete an eligible unassigned record with its `version`.

All operations require a currently verified Super Admin; writes repeat live
identity/session validation. No endpoint accepts recipients, rendered token values,
transport configuration or a send instruction. Source fields are name, description,
subject, HTML, plain text and optional allowlisted `event_key`. Unknown properties,
control characters, invalid sizes and invalid markup/variables are rejected.
Names are database-unique ignoring case. Transactional audit records contain
only actor/session/request identifiers, action, resource and outcome—not content.
The migration seed has explicitly machine-owned creation provenance; edits record
the verified updater without inventing or overwriting its creator.

Only the branded **Forgot password** template is seeded. Its protected identity is
`e7e80000-0000-4000-8000-000000000001`, assigned to **`password_recovery`**.
Its subject/design/plain-text alternative use real recovery wording. Its content
and display name can be edited directly. Its identity/event cannot be deleted,
disabled or reassigned. No order/payment/invitation event is implemented.
New templates remain **Unassigned — not triggered**; the UI never offers
executable custom events. There is no Copy to draft action in either channel.

## Event rendering and delivery

The only available email variables are:

| Variable | Server-owned value |
| --- | --- |
| `{{recipient_name}}` | Safe neutral greeting, currently `there`; no extra directory decryption |
| `{{company_name}}` | `EVEXIA LIFE SCIENCES` |
| `{{reset_url}}` | Approved environment recovery URL plus fragment-only recovery token |
| `{{expiry_minutes}}` | `15`, matching the token's 900-second lifetime |

Substitution is literal, single pass and never executes template code. Unknown,
malformed or unavailable variables are rejected. HTML source is retained as
authored, but delivery uses a separately validated/reconstructed allowlist of
formatting/table elements and inline style properties. No scripts, handlers,
forms, frames, remote resources or arbitrary image URLs are permitted.
Every anchor must use exactly `href="{{reset_url}}"`; author-supplied recovery
URLs are rejected. Both text and visible HTML must contain expiry and the fallback
URL, with an actual reset link in HTML. Variables cannot appear in formatting
attributes; dynamic HTML text and the trusted URL attribute are escaped.
Subject/header control characters are rejected before save and after rendering.
The fixed `/images/evexia-logo.png` source identity is converted to
`cid:evexia-logo@evexia` for delivery and attached as a bundled PNG MIME part.
It does not depend on a reachable frontend image or external host.

Existing eligible staff and MR recovery requests resolve the stored event
template in their background flow. The source is validated and snapshotted before
releasing reads; network I/O happens without an open read transaction.
Mail is multipart plain text plus HTML, with the inline PNG related to HTML.
Missing, duplicated, wrongly assigned or invalid database content fails closed,
with only a fixed operator-investigation log; **there is no hardcoded fallback**.
Rendered content, addresses and tokens are not persisted or logged.

The existing environment-selected SMTP server, verified TLS/STARTTLS, approved
sender, trusted recovery origin, public generic response, eligibility checks,
Super Admin exclusion, throttling, recipient binding, expiry, single use and
session revocation remain the recovery boundary. Nothing here selects encrypted
Communication defaults, changes credentials, probes a provider or sends test mail.
A generic 202 means accepted for an attempt, not successful delivery.

## Browser behavior

Email list/detail/write operations are authenticated and asynchronous. Successful
saves replace the shared list; reopening retrieves fresh detail. Load latest and
remount provide cross-browser freshness. Version conflicts never overwrite newer
content. Failed reads and saves preserve the mounted draft. No email operation
falls back to localStorage or hardcoded examples.

An absent collection endpoint (or an unmatched detail/write route on an older
running API) reports API/release availability, never a deleted template. Only
the typed `email_template_not_found` response from an individual record operation
uses missing-record guidance. Storage failures remain distinct. The last valid
list and existing editor stay mounted on read failures; explicit reconciliation
does not silently replay a mutation or replace typed content.

Lost/invalid responses block another save until **Load latest to reconcile (keep
draft)**. Matching saved content confirms the outcome. Otherwise the draft stays
mounted and a version mismatch requires explicitly reopening latest. Creates use
the same stable `creation_id` after explicit reconciliation/retry, so a delayed
first write cannot produce a duplicate. Delete failures likewise require a fresh
read and explicit reconfirmation. No mutation is automatically replayed.

SMS stays on its existing browser-local service. Local emails are not exposed by
that service, and SMS writes preserve the hidden legacy email records in storage.
There is **no import, upload, migration or destructive cleanup** of local email
records. Preview samples stay visibly fictional, with a nonfunctional example
domain and no real token. Previews retain the sandbox/CSP, inert links and fixed
offline logo; delivery rules never relax the browser preview boundary.

## Migration and activation: NOT performed by this change

The explicit additive migration is **`0043_email_templates`**, with actual
predecessor **`0042_rate_hundredths`**, itself after `0041_location_geography`.
The source also contains the separately protected successor
`0044_purchase_received`; the coordinated application/development declaration
now targets 0044. Both successors remain **operator_only**. There is no startup `create_all`, auto-seed or
request-time repair.

This work does **not** approve or execute 0043 or any predecessor on a managed,
shared, original-development, UAT or production database. In particular, approval
for the new table is not approval for 0042's catalogue rounding. If 0042 is not
already present, stop: obtain its separate approval or a separately reviewed
migration plan. Do not stamp past it, edit historical revisions, or run an
unbounded `upgrade head`.

Existing signed/reviewed fresh-install catalog/review manifests have deliberately
not been regenerated or relabelled as verified. They describe the earlier tested
release. Fresh-install/deployment authorization remains fail-closed until separate
authorized rollout work rehearses the exact required path and refreshes the
catalog/review evidence. No release/compatibility validation or activation evidence
is claimed here. Do not bypass those controls to start this candidate.

Before activation, obtain exact database identity, predecessor and approval scope,
an independently restorable backup, the approved migration rehearsal and any
required release authorization. Then apply only the explicitly authorized path
and separately approve service activation. Until the table/migration and service
activation are complete, the new email APIs/recovery content are not operational
on that database. Do not restart services against an unmigrated database.

Use the single [development schema activation handoff](development-schema-activation.md)
for the existing activation task. It includes the complete current 0040→0044
path, not just the email table. The independent development source review fixes
the recurring production-review coupling; it does not execute this protected
path or resolve the live incident.

## Focused verification only

New cases are intentionally separate from the existing suites:

```sh
PYTHONPATH=artifacts/api-server/backend python3 -B -m pytest -q \
  artifacts/api-server/backend/feature_tests/test_email_templates_feature.py
node --test artifacts/evexia-portal/src/services/emailTemplates.feature.test.js
```

The Python fixture starts its own temporary socket-only UTF-8 PostgreSQL cluster,
creates minimal predecessor dependencies and executes **only the new migration**.
It does not replay the historical migration chain or read a shared database.
SMTP is captured in process, never delivered. Authentication boundary tests use
synthetic dependency fixtures, not live accounts or a full sign-in regression.
Node cases use mocked authenticated fetch, source checks and focused JSX parsing,
not a browser or application-wide build.

Authoritative OpenAPI export and Orval generation are generation steps only;
the package's aggregate codegen command is deliberately not used because it
chains broader checks. Existing regression, browser/end-to-end, release and
development compatibility suites were not run. Real SMTP acceptance/inbox
rendering, live shared persistence, full session-renewal UI/focus interactions,
the historical migration chain and managed rollout remain unverified here.

Implementation-session results: **24 new Python cases passed** and **6 new Node
cases passed**. OpenAPI export/Orval generation completed, and `git diff --check`
was clean. The static root preview capture reached a portal-lookup failure
(HTTP 502), not an authenticated template page; it does not verify the new UI.
No service was started/restarted or shared database changed to resolve that
unactivated runtime, in accordance with the separate-approval boundary.
