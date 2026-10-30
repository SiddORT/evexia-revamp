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
