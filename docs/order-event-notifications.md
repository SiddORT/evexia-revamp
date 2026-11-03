# Placement email enrichment — source only

The MR Immunotherapy placement email now includes `{{allergen_list}}` and
`{{order_details_url}}` in HTML and plain text. The original notification message
is retained. The Modern layout and Email Templates supported-token metadata use
the same additions. Fictional preview/test-render values use an `.invalid` order
destination, never a live order or account. Browser previews still sanitize
links into inert spans inside the existing offline sandbox; no outbound resource
or navigation permission was added.

New placement events capture ordered saved allergen-name occurrences and saved
group identifiers in the existing encrypted immutable payload. Repeated names
in different groups remain repeated, including historical names retained by the
saved order. No master lookup, deduplication, concentration unit, contact,
prescription or other clinical fact is added. Feed serialization explicitly
allowlists the original public facts; the Super Admin bell keeps its original
message and the placing MR's bell/response gains no allergen or URL facts.
SMS/WABA variables and authoring-only policy are unchanged.

The server constructs
`https://{admitted-primary-host}/admin/orders/immunotherapy/{saved-order-id}`
from the existing primary-domain configuration, requiring active, unexpired
ownership verification. Bootstrap admission is not a substitute for primary
verification. In development with managed-preview mode explicitly enabled, only
the configured `REPLIT_DEV_DOMAIN` under `.replit.dev` is used. Neither request
Host/forwarding headers, arbitrary CORS origins nor a hardcoded workspace host
are used. The captured URL remains encrypted and is checked again against the
current admitted origin before handoff. Missing/invalid configuration becomes
`trusted_portal_origin_required`; a changed captured origin becomes
`portal_origin_changed`. These are terminal delivery outcomes, not order-save
failures or a backlog to replay when configuration changes.

The destination is the existing protected Admin read view. The current Admin
boundary, safe login return path and saved-order permissions remain unchanged;
the email URL is not a token, grant or public order endpoint. HTML authoring
permits only an exact `href="{{order_details_url}}"` in this assigned email.
Recovery/invitation link validation still permits only its reset URL. Names
and URLs are escaped by single-pass literal substitution; allergen-list
newlines become HTML breaks only after escaping.

## Migration/configuration prerequisites

Forward-only `0085_placement_email_details` follows `0084_allergen_expiry` and is
prepared, **not executed**. It updates the authoritative assigned email row,
not just a default constant. It takes the editor's advisory lock and a row lock,
reads the latest authored HTML/text, adds only missing list/action/fallback
sections, enforces size/version limits and conditionally increments the saved
version. Name, description, subject, existing wording/styles, provenance and
administrator attribution are retained. An already enriched row is a no-op.
Existing content is not replaced with Modern or any other default layout.
No SMS/WABA records, historical events or delivery attempts are updated.
Pending older template versions remain subject to the existing version-mismatch
block; administrator drafts opened before the migration must reconcile with the
new saved version rather than overwrite it.

Old payloads/templates remain readable. Missing historical allergen facts are
never reconstructed; attempted old work is blocked as
`placement_facts_unavailable`. A readable legacy or subsequently edited template
that lacks the additions cannot silently deliver an incomplete email:
`placement_template_enrichment_required` blocks that attempt without replay.
Invalid source is `placement_template_invalid`. Automatic sending remains one
existing outbox intent to the protected Super Admin via saved default SMTP.

The coordinated development schema and source-byte metadata are prepared for
the successor. A valid primary domain (or explicitly configured development
managed-preview origin), assigned enriched email and the existing saved default
SMTP are prerequisites for future eligible sends. Normal migration policy is
unchanged, but this work did not activate it. Production catalog/release evidence
has not been fabricated or advanced without separately authorized reproduction.

Source changes were inspected only. No release/regression checks, tests, builds,
browser/runtime probes, verification emails, data mutations, migration execution,
service starts/restarts, deployment or runtime activation were performed.
Runtime delivery, protected navigation and inbox receipt were **not verified**.

# Independent allergen expiry digest

Allergen expiry uses its own lifecycle worker and daily claims, not sales-order
events or their recipients. It reuses the default saved SMTP transport and
protected Admin resolution without changing order-event behavior. See
[allergen-expiry-disposal.md](allergen-expiry-disposal.md).

# MR Immunotherapy placement: scoped Super Admin policy

This section overrides the generic recipient/channel/template rules below **only**
for `immunotherapy` + `order_placed` with an immutable placing-MR account/profile.
Other order kinds, lifecycle events and the placing MR's existing bell behavior
are unchanged.

## Source implementation

- The existing `placed` call runs inside the Immunotherapy save transaction.
  Failed/rolled-back saves cannot leave an event, alert or delivery behind.
  Existing source-key, alert-recipient and delivery-recipient uniqueness and
  serialized idempotency requests remain the only event/outbox mechanism.
- New scoped events capture the saved patient-name snapshot and creation
  calendar date alongside the existing placing-MR name. The date is derived
  from placement-event creation time in Asia/Kolkata as DD/MM/YYYY, not an editable/backdated
  order date, worker time, browser locale or a later directory lookup.
  These facts stay in the existing encrypted immutable event payload. Email-only
  saved allergen/group facts and the server-owned order URL are described above;
  they never enter the bell message or public event projection.
- Super Admin's bell renders the exact default message:

  > Notification: MR [Name] has placed an immunotherapy order for patient [Patient Name] on [DD/MM/YYYY].
  > Kindly note the same for your records.
  > – Team AllergyEvexia

  The placing MR still receives the original generic bell projection. Patient
  facts are removed before feed serialization for every actor; only the
  authorized Super Admin gets the scoped rendered message. Historical payloads
  lacking facts show the original generic item, without inventing a patient or
  placement date. Read/unread, retention and saved-order authorization remain
  unchanged.
- Only one external intent is created: email to the active protected Super
  Admin account, resolving its saved validated account mailbox. No MR, manager,
  Doctor, Patient or ordinary staff destination is substituted.
- The authoritative email source is the required `mr_immunotherapy_placed`
  record in **Email Templates**, not the cross-order `order_placed` record in
  Order event templates. Its subject defaults to
  `Notification: MR Immunotherapy order placed`. HTML and plain text carry the
  supplied wording and `{{mr_name}}`, `{{patient_name}}`, `{{placement_date}}`.
  The enrichment above additionally supplies the email-only `{{allergen_list}}`
  and `{{order_details_url}}`; the original three-variable bell/SMS/WABA contract
  is unchanged.
  The existing preview, edit, HTML source/preview, HTML import, Modern layout,
  literal substitution, concurrency and draft recovery controls are reused.
  Its explicit test-email action uses only fictional placement data and the
  existing protected saved-version/quota/default-SMTP path; it creates no order.
  **No test action was invoked during implementation.**
- The saved default Communication Email SMTP is the only transport. It must be
  readable, valid and use TLS/STARTTLS. No environment SMTP, provider or mailbox
  fallback is added. Existing protected **Order event templates → Channel
  attempts** reports terminal configuration/recipient failures and
  pending/accepted/failed/unknown outcomes. Acceptance is not inbox receipt.
- Shared SMS and WABA copies are discoverable under **SMS order templates
  (shared)** and **WABA templates** in Message templates (and the order-event
  authoring surface). They have the same three placeholders and exact text.
  They are permanently **template-only for this trigger**, regardless of
  enabled flags, saved providers, DLT IDs or WhatsApp metadata. Blank metadata
  can be saved; none is invented. Generic assignments retain their own rules.
- Scoped intent creation skips MR email and all SMS/WABA deliveries entirely.
  Worker and transport policy independently reject these destinations/channels
  before resolving providers or handing off. This also covers outstanding
  scoped `pending`/reclaimable `leased` attempts created by predecessor code.
  Old generic email intents cannot adopt the new template or missing facts.
  Already committed `sending` markers retain unknown-send safeguards, never a
  new send. A provider handoff already performed by old running code cannot be
  recalled by a source change.
- Template/configuration edits affect future eligible placements only. A changed
  pending version blocks; blocked/failed/unknown history is never replayed.
  Email failure happens after the order commit and cannot undo the order.
  The bell's fixed business notification is independent of authored email edits.

## Schema and lifecycle prerequisites — not activated or runtime verified

Forward-only `0081_immunotherapy_alerts` follows `0080_admin_email`. It extends
email assignment/provenance constraints and inserts one required email and two
template-only records. It never rewrites existing authored templates or
historical events/deliveries; colliding display names use a distinct system
suffix. Library bounds reserve room for these additions without evicting custom
records. There is no data backfill, notification replay or startup send hook.

Development declaration, source fingerprint and account/readiness successor
metadata are coordinated in source. Readiness resolves the new required email
record and inherits predecessor capability probes. Existing automatic migration
policy applies on a future normally authorized lifecycle; **no migration was
executed, no service started/restarted and no activation was performed here**.
Do not use a development wrapper as a source-review shortcut.

Before relying on this behavior, a separately authorized lifecycle must apply
the new schema and load the matching API/worker/frontend sources across all
processes. It must retain directory/account/Communication encryption access,
the active protected Super Admin with a valid saved mailbox, the required saved
template and a valid saved default SMTP. Their actual availability has **not**
been inspected. Production evidence/approval pins were not fabricated or
advanced, and this task does not authorize deployment.

Delivery was reviewed in source only. API/client source generation and source
formatting were performed; **no tests, builds, regression/release checks,
schema validation commands, browser/runtime/network probes, verification sends,
business-data mutations or manual migrations were run**. Neither an observed
SMTP submission nor working inbox delivery is claimed.

# Order event notifications

## Scope and recipients

This is a **source-only, unverified delivery**. No tests, builds, regression or
release checks, development-validation wrappers, browser/manual/runtime probes,
live messages, business mutations, migrations, service starts/restarts, production
access or deployments were performed. Only offline API/client generation,
formatting and development source-integrity metadata generation were used.

The protected Super Admin and the authenticated **placing MR**, not a reporting
manager, receive persistent order alerts. Ordinary staff, other MRs, Doctors and
Patients do not receive or administer this feed. No manager relationship is
queried for notifications.

An immutable origin binds the order creator's `users` identity to the explicitly
matching `MRProfile`/order MR identity. New orders bind this even while SPT is a
Draft. An Admin-created order is not attributed to its assigned MR. For a
pre-existing order receiving a new transition, creator + matching explicit MR
profile is required; there is no history backfill or guessed legacy mapping.
Later edits, assignment changes, manager changes, or editors do not replace
the placing identity. Inactive/deleted MR directories, inactive accounts/profiles
and unavailable destinations cannot receive external messages.

Origins retain the original saved placing-MR name. Event payloads contain only
order number, event status, that name and an explicit transaction allocation
amount (otherwise null). Type, immutable timestamp and target references are
stored separately. Directory-key AES-GCM with a separate AAD namespace protects
the payload and origin name. Prescriptions, clinical facts, Doctor/Patient
contacts, rejection reasons, credentials and uploaded documents never enter the
event payload. Notifications do not include document attachments.

Transaction amounts are also suppressed for an MR who no longer owns the saved
order. A historical bell never restores current financial/order access.
The feed and status APIs return `Cache-Control: no-store` through the existing
API middleware. Notification data is memory-only on the client and keyed by
account plus the local authenticated-session epoch.

## Events and atomicity

Stable keys (each has a distinct editable default in Email, SMS and WABA):

| Event | Boundary |
| --- | --- |
| `order_placed` | First submitted Immunotherapy/Lupin/Kits save; SPT first non-Draft save, including Draft → Saved |
| `order_confirmed` | Explicit successful approval; customer-facing **Confirmed**, without changing the business `In process`/legacy `Approved` lifecycle |
| `order_rejected` | Explicit rejection, not an edit of rejected content |
| `order_resubmitted` | Explicit MR resubmission after corrections |
| `order_shipped` | Existing saved shipment action |
| `order_delivered` | First actual delivery recording for a shipment, including a shipment saved with an actual delivery date |
| `order_returned` | Existing return transition |
| `order_transaction` | Each explicit per-order allocation of a successfully posted MR settlement |

Editing/replacing an already recorded delivery date does not create another
delivered event. Views, clicks, ordinary edits, old Paid/Partial/Unpaid flags,
rolled-back or rejected writes and durable idempotent reply recovery produce no
new logical event. Imports use the same write hooks; review-only imports do not
emit anything. Existing MR eligibility tests and financial posting/verification
semantics are unchanged.

All event/feed/delivery inserts run inside the existing business transaction
and under its existing locks. Stable natural source keys and database uniqueness
guard the logical event, per-user alert, and per-event/user/channel delivery.
The immutable origin is independent of feed retention. No network operation
runs in an order or settlement transaction.

## Templates and Settings

Settings → Message templates retains the shared recovery/invitation Email
library and the clearly labelled legacy browser-local SMS library. **Order
events (shared: Email, SMS, WABA)** adds the shared order library, event/channel
coverage, versioned authoring, enabled state, readiness and channel attempts.
It does not import or delete legacy local templates.

Each channel/event has at most one assignment. To replace an assignment, unassign
the old template explicitly, then assign another; competing edits return a 409
and preserve the draft. The total library is bounded to 100 templates. Deletes
and edits require the saved version; there is no silent last-write-wins update.
Recovered tab drafts retain their version warning and can load the latest
saved base without losing content.

Supported literal placeholders:

`order_number`, `order_type`, `event_name`, `status`, `mr_name`, `timestamp`,
`transaction_amount`, `company_name`.

Substitution is single-pass, not template-code evaluation. Email values are
escaped for HTML and require subject, formatting-only HTML and plain text.
Order emails have no authored links. Inert previews reuse the existing offline
sanitizer/sandbox; no remote content, live navigation or delivery occurs.

SMS has a name, text (up to 1,600 source characters) and per-template real numeric
DLT ID. WABA has a name, reference body, approved provider template name, approved
language code and an ordered list of supported placeholder names for positional
BODY parameters. Empty mapping is valid for a fixed-text approved provider
template. The reference body is preview content, not a claim about the provider's
approved wording. Header/media/button/named-parameter template variants are not
supported. Defaults intentionally contain **no invented DLT or provider IDs**.
The administrator must use the actual approved template and exact mapping.

Enabled templates can be saved without any configured provider or approval
metadata. Readiness describes why a channel cannot send; saving is never
reported as delivery. Readiness is configuration-level, not a guarantee that
each recipient has an eligible destination or that a provider will accept.

## Supported transports

### Email

Order events select only the saved default encrypted **Email SMTP**
configuration. The existing saved-SMTP resolver's validation and TLS transport
are reused. There is no environment SMTP, alternate saved server, API or Platform
fallback. Default selection and decryption use the same selected configuration
snapshot. Unreadable/insecure/unsupported defaults produce fixed safe categories.

Password recovery and invitation delivery purposes, events, flows and selection
rules are not changed by this feature. The existing resolver was only factored
to allow the worker to resolve its already-selected default snapshot.

### SMS

**No SMS vendor wire contract is currently supported.** A generic provider name,
sender ID and HTTPS endpoint do not specify authentication, payload, DLT handling
or acknowledgment semantics. The library and per-template DLT metadata are usable
now; configured SMS vendors remain `unsupported_provider` until an explicitly
reviewed adapter for the actual vendor contract exists. There are no guessed
requests, registrations, accounts or identifiers.

### WABA — Meta WhatsApp Cloud API

The supported adapter is the documented Meta Cloud API template-message
contract, not an arbitrary provider endpoint:

- Communication channel `waba`, type `api`, provider exactly `meta_cloud`
  (case-insensitive).
- Endpoint exactly `https://graph.facebook.com` (optional trailing slash).
- Real numeric business-account ID and phone-number ID, explicit API version
  such as the administrator's supported `vNN.N` version; no fabricated default.
- Encrypted credential is the real access token. It is sent only in the Bearer
  header, only to the fixed Meta host, with redirects and environment proxies
  disabled.
- `POST /{apiVersion}/{phoneNumberId}/messages`, `messaging_product: whatsapp`,
  `type: template`, E.164 destination digits, approved `template.name`,
  `template.language.code`, and optional positional `body` text parameters.
- A successful response must contain a message ID. This records **provider
  accepted**, not confirmed WhatsApp delivery/read status. There are no webhooks
  or invented delivery receipts.

Contract references:
https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
and https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates .
Provider account provisioning, template approval and Meta API-version lifecycle
remain the operator's responsibility. No live request was made for this delivery.

For Email, the validated placing account's email is used, not a manager or
unrelated directory address. For SMS/WABA, an active placing MR's directory phone
is normalized and validated with saved country metadata. The protected Admin's
phone is usable only if an actual active linked Staff profile supplies a valid
saved phone; no phone is inferred from email, environment variables or fictional
records. A protected Admin without such a phone is truthfully `missing_recipient`.
Duplicate user recipients and duplicate destination/channel submissions are
suppressed. Destination equality uses a domain-separated keyed index, never a
plaintext phone/email in attempt records.

## Worker, restart safety and activation

The API lifespan owns one serial bounded worker per API process. It claims at
most one channel attempt per two-second cycle with SQL `SKIP LOCKED`, a unique
lease token and expiry. Competing processes cannot send the same logical attempt.
It revalidates the template, enabled state, exact saved configuration/template
version and current authorized recipient before committing the sending marker.
Event-level locking also serializes destination deduplication across recipients.
No database lock is held during external I/O.

- Configuration and template readiness is evaluated **when the event occurs**.
  Missing, disabled, unsupported, unreadable or incomplete channels become
  terminal `blocked` records. They are not polled or requeued.
- Adding/changing a default or template activates **future eligible events**
  automatically. It never drains blocked history.
- A pending attempt cannot silently adopt another configuration or content
  version. A changed snapshot blocks it safely.
- A crashed pre-send lease can be reclaimed. Pending work older than 24 hours
  is blocked as `dispatch_window_expired`, not sent as a stale backlog burst.
- The worker commits `sending` **before** network handoff. A crash or uncertain
  external outcome becomes `unknown`, with no automatic replay. This deliberately
  favors avoiding duplicate external submissions over claiming guaranteed
  delivery. It is not an exactly-once external-delivery guarantee.
- Definite provider/SMTP rejection becomes `failed`; other post-handoff failures
  are `unknown`. Known acceptance becomes `accepted`. Provider bodies,
  credentials and destinations are not exposed in logs.
- Graceful shutdown lets the current bounded attempt finish. Interrupted
  sends remain recoverable as unknown, not as new pending sends.
- Each channel has its own attempt; email failure cannot suppress the bell,
  roll back an order, or roll back a successful transaction.

The bell fetches the most recent 25 retained events plus an indexed unread count,
polling every 45 seconds while visible and backing off to five minutes on errors.
Read/unread state persists on the server across reloads/devices. Opening an alert
reuses the saved-order authorization boundary before returning the target; the
actual destination page continues enforcing normal ownership. Missing/removed or
no-longer-authorized orders have an explicit unavailable result. Pending editor
drafts use the existing navigation guard, not an automatic reload.

Super Admin's bounded attempt table displays safe event/order/channel/recipient
role, pending/accepted/failed/unknown/blocked state, timestamps and fixed failure
category. It never labels acceptance as inbox/handset delivery.

## Retention and schema custody

Feed and attempts retain 180 days. A bounded maintenance pass deletes at most
100 expired finished events and their dependent alerts/attempts; unfinished
handoffs are settled before removal. Origins remain for the saved order's life
so retention cannot change placing identity. Event/origin updates are prohibited
by database triggers. The ordinary durable business retry records remain the
replay guard after event retention, and no maintenance process scans history to
create new events.

Forward `0079_order_notifications` follows `0078_reserve_movements`. Development
schema declaration, generated source-integrity metadata, explicit account
compatibility and inherited readiness probes are coordinated. Automatic
migration execution policy and historical guards are unchanged; this work did
**not execute** the migration or start/restart a service to activate it.

Fresh-install production catalog/release evidence for the new head cannot be
generated under the no-runtime restriction. Existing production review/catalog
pins are deliberately not advanced or fabricated. Normal production evidence
requirements may therefore block release until separately authorized reproduction.
This is not permission to bypass them.

Directory keys protecting notifications must remain available. Existing offline
directory-rotation tooling intentionally rejects this new head rather than
silently omitting encrypted origins/events or attempting to rewrite immutable
notification facts. Do not retire old directory keys based solely on a directory
rotation report; broader key-retirement coverage requires separate reviewed
maintenance support. No key was read, changed, rotated or retired here.
