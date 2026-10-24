# Admin Immunotherapy orders

## Super Admin review, suborders and audit metadata (source only)

This section supersedes older bottle-MRP editing/pricing descriptions below.
MR still submits unpriced Confirmed orders. Admin reviews the clinical details,
private prescriptions and one INR rate per allergen occurrence, with saved
patient/Doctor/MR/shipping/billing facts at the side and PO/decision actions at
the bottom. Approval needs complete rates and a verified patient-associated
prescription. Rejection does not need invented prices. All writes and imports
still need a verified prescription; old fileless records remain readable.
PO number is optional for saving, approval and permitted fulfillment transitions.
It may be cleared; empty/whitespace-only input becomes null in the handwritten
client and the shared authoritative input schema (direct write/import review/
import commit). Nonblank values retain the existing 1–100 character bounds.
PO-only changes do not force an unchanged historical fulfillment order to
convert its pricing basis. Missing saved values remain “Not recorded.”

New orders use `pricingBasis: "allergen_rates"`; their total is the exact
minor-unit sum of all occurrence rates, bounded by the existing ₹10 crore cap.
Any missing rate makes the total unavailable/“Awaiting pricing,” never zero.
Bottle MRP is not a second editable amount. Existing orders without a basis are
`legacy_bottle_mrp`. Their saved total and saved prices remain authoritative on
read, export and print. An Admin must explicitly choose rate-based repricing
and enter every required rate to change that basis on a supported save.
Returning to legacy pricing is not allowed after that save.

`groups[].items[].suborderId` is an order-local server-issued `SUB-000001` style
identity, separate from the unchanged internal group ID. A version-checked,
idempotent write alone issues missing identities. It retains IDs by the saved
group/allergen occurrence and keeps an encrypted high-water mark so removal
does not recycle identities. Reordering does not reassign IDs. Client-supplied
replacement, moved or foreign IDs are rejected. Read/import-review/export
never issue or persist IDs; old occurrences can remain “Not assigned” until a
supported explicit write. Older transfer payloads can omit optional fields;
existing saved occurrence IDs and financial basis are retained authoritatively.
Retry comparison treats absent/null additive default fields equivalently so a
pre-upgrade frozen submission can recover its saved result without reapplying
the mutation. Non-null replacement IDs/bases still change the request identity.
Import preview deliberately shows unissued IDs rather than promising numbers
that have not yet been committed.

The shared Admin/MR prescription viewer reuses the authenticated private-file
Blob loader. PDFs use pinned local PDF.js and its matching bundled worker, not
the browser-native iframe. Only one page is rendered at a time, with page/zoom
controls and bounded canvas dimensions/area. No PDF scripting manager, forms,
XFA, annotation layer, links or embedded-file actions are created. Worker fetch
and WASM decoding are disabled. A binary-resource factory accepts only bundled
font/CMap filenames, never PDF-selected URLs; notices are bundled as inert text.
Raster images use temporary URLs. Loading, retry/restricted/unsupported states,
Download, Close and existing focus return remain shared across callers.

“Open in new tab” creates an application-controlled blank tab, immediately
removes its opener and renders the same privately fetched bytes as canvas/image
content, never as an executable PDF. The URL carries no file identifier,
credentials or private bytes. A restrictive CSP permits only image Blob URLs
and local presentation styles in that tab. Blocked popups have an actionable
message and the original authenticated Download fallback. Each separate view
owns its renderer, worker/image resources, close handling and session
subscription independently of the dialog: closing the dialog does not close the
tab. Known sign-out/account change or departure from the parent portal disposes
separate views, including backgrounded views. No browser storage is used.
No signed/public storage URL is exposed; file viewing never mutates an order.

The historical-pricing explanation and explicit **Enable rate editing / Reprice**
action are beside the allergen fields, backed by the same draft basis as the
side-card control. Rates remain read-only until this action; conversion remains
unsaved until an explicit successful save with every rate. Discard/cancel retains
the saved historical basis/total. Side-card children, facts, totals and long
actions have scoped wrapping/shrink rules rather than global button changes.

### Unconfirmed saves and source investigation

Source tracing covers the editor, handwritten wire-payload preparation,
authenticated dispatch/JSON decoding, authorized response projection and the
encrypted advisory-lock-protected idempotency record. No live/read-only failure
logs or runtime requests were used. The screenshot establishes an unknown
outcome, not a particular transaction failure, PO validation failure or
development-update cause; its specific cause cannot be established here.

Two source-evidenced recovery weaknesses are addressed: retries previously
reconstructed wire fields from session/form state, and a failed same-key
attempt had no durable rejection to prevent a delayed original from committing
afterwards. The editor now captures the exact wire payload, expected version,
owner, route and key once. The nearby recovery panel retries only that request
and preserves the locked mounted draft. Auth/permission errors, unreadable
responses and server/transport failures during recovery do not clear unknown.

For direct saves the server serializes by the original advisory lock, checks
owner/payload equality and replays committed operations without repeating
updates, audit events or occurrence issuance. Definitive service-level 4xx
rejections roll back attempted changes in a savepoint and commit an encrypted
rejection under that same lock/key. Only these committed failures carry
`X-Immunotherapy-Outcome: rejected`; subsequent identical requests replay the
failure. Pre-service schema/auth errors and missing retry records do not provide
this evidence. A terminal rejection permits correction while preserving the
draft; stale-version rejection retains explicit compare/rebase handling.

The actual authorized/redacted direct-save response is validated and serialized
against `ImmRecord` **before commit**, avoiding the previous post-commit-only
FastAPI validation boundary. This is hardening of an identifiable failure window,
not evidence that response serialization caused the screenshot. If the response
is still lost, same-key replay recovers the result. No schema migration or
public file endpoint is introduced. Import approval/fulfillment policy shares
the optional-PO rule; import mutation recovery is otherwise unchanged.

This revision is source/diff-reviewed only. No tests were added, modified or run;
no builds, browser/manual runtime checks, validation/release wrappers, workflow
changes, probes, service restarts, migration commands or deployments were run.
Dependency resolution/lockfile updates used ignored lifecycle scripts. Local
worker/asset packaging, PDF fidelity, popup lifecycle and save recovery remain
unverified at runtime.

All four Admin order listings expose `audit.createdBy`, `createdAt`,
`updatedBy`, and `updatedAt`, rendered with portal timestamp preferences.
Creator/updater labels are resolved from server-owned user references through
encrypted account usernames, in bounded batches without loading credentials.
MR responses do not disclose these labels. Imported display labels/order dates
never control attribution. Missing identity or timestamp evidence is explicitly
unavailable. Existing Kits/SPT/Lupin timestamps remain unchanged.

### Unapplied schema and operational boundary

`0071_order_review_audit` adds nullable Immunotherapy `created_at`/`updated_at`.
It assigns no suborder IDs and does not decrypt or reprice historical orders.
It recovers creation time only from exactly one matching successful durable
creation event and matching creator. Only a never-edited version-1 row with
matching actors and no update events may also inherit that time as update time;
legacy later update times have no reliable mutation-version evidence and stay
unavailable. Subsequent successful explicit writes stamp server UTC update
time and never replace the original creator/creation time.

The source schema declaration and readiness successor inherit the prior
readiness chain and add nullable audit-column probes. The existing development
migration review manifest has **not** been refreshed or approved: a later
operator must review the migration source and activation before starting this
revision. No migration command, startup hook or service restart was run here.
The incoming main-branch generated API contract is retained during merge;
regeneration of optional suborder/pricing-basis/audit declarations and generated
clients is deferred because generation is not permitted under the source-only
restriction. The authoritative Python schemas and the portal's handwritten
service payloads/consumers contain these additive fields.

**Verification is source/diff review only. No tests were added, changed or run.
No builds, browser/manual runtime checks, release/validation wrappers, service
restarts, workflow changes, runtime probes, migrations or deployments were
performed. Runtime behavior, migration execution and browser PDF rendering
remain unverified.**

## Current MR/Admin form refinement (source-reviewed only)

The shared form now omits the duplicate reaction hints while retaining the mm
labels and required result validation. New bottles use `BOT-001` style IDs.
The editor reserves every existing and newly issued ID for its lifetime,
including removed bottles; moving allergens never changes bottle IDs.
Historical IDs remain in the draft, save payload and CSV/XLSX details unchanged.
Only their form presentation uses a short “Saved bottle” label.

Saving requires at least one actual verified prescription for the selected
patient. The form counts only server-loaded saved associations and successful
verified, clean-scanned upload/recovery responses, never local file metadata.
The shared server resolver rejects empty attachment lists during direct writes,
import review and import commit, and continues to lock/check every FileRecord
for patient, uploader, state, scan and size. Existing fileless orders remain
readable/exportable but cannot be saved or reviewed for import until a
prescription is attached through the order form. MR saved-file retention and
scope checks are unchanged. Unchanged idempotent retries still recover the
original result rather than performing another write.

The transfer UI does not upload files or trust exported attachment claims.
Consequently, create new orders through the form first; the transfer UI updates
saved orders retaining their authoritative file associations. This supersedes
the original blank-ID import-creation instructions below. A direct API import
must also supply real qualifying file IDs; metadata cannot satisfy the rule.

### Invalid-request investigation

Source tracing compared `save()` → `saveOrder()` → `orderInput()` →
`purchaseOrderRequest()` / JSON serialization with `ImmWrite` / `ImmInput` /
`ImmBottle` / `ImmItem` and the shared validation handler:

- The pictured PD choice is accepted. UUID-shaped bottle IDs also already meet
  the string ID contract. No confirmed serialization/schema mismatch was found,
  so dosage, number formats, reference/ownership rules and schema strictness
  were not relaxed.
- The confirmed defect was missing form preflight plus loss of the API's
  field/code errors: new bottles start with empty MRP/items, the form previously
  sent them directly to the strict API, the API emits a generic “Invalid request”
  plus structured locations, and the transport/form discarded those locations.
- The supplied screenshot shows only the upper form. Its two ₹0.00 billing rows
  are not evidence of valid zero MRPs: billing deliberately treats blank/invalid
  prices as zero. There is no captured rejected JSON body or 422 field response
  identifying the exact lower-form field in that historical submission.
  No particular hidden field is claimed to be its proven cause.
- Preflight now identifies incomplete/invalid result, MRP and bottle fields
  before submission. Rejected server schema errors map known structural paths
  to the submitted bottle/result controls and actionable static messages.
  Relationship, total and prescription errors also target relevant fields.
  Unknown paths/codes remain generic; no invalid values, arbitrary property names
  or validator messages are echoed. The server sanitizes locations for direct
  and nested import requests before sending them.
- Rejections preserve the mounted draft. Unconfirmed saves keep their frozen
  payload/key and editing lock for the existing explicit safe retry; they are
  never reported as saved.

This refinement was inspected in source only. **No tests, builds, automated
browser checks, runtime requests, service restarts, release/validation wrappers,
migrations, deployments or live-data writes were run. Runtime behavior remains
unverified.** Public schema shapes are unchanged; the minimum-file rule is a
shared write/import service rule rather than a read-record schema restriction.

## Delivery boundary

This change implements **source only**. No tests, builds, smoke scripts, browser
or manual scenarios, live database/API checks, service restarts, migrations or
runtime acceptance checks were run. API contract/client generation and
source-only schema metadata generation were performed. A generated contract is
not evidence that a running service provides it.

The coordinated development declaration advances to `0061_immunotherapy_orders`
under the existing automatic-development migration policy. Activation belongs
to the authorized normal development lifecycle after merge. This work does not
deploy production, change secrets, seed orders or convert other order types.

## Persistence and authorization

The existing protected Super Admin authorization is revalidated on every
operation; no Staff, Doctor or MR order access is added. Orders use PostgreSQL
foreign keys to the real Patient, Doctor and MR directories. Item references
point to real allergens and attachment associations point to private files.
Soft deletion of a master does not remove these references.

Historical patient identity/contact/address, DOB/age/gender, Doctor identity,
registration/business numbers and contact/address, MR identity/employee code and
contact/address, shipping recipient, bottle composition, concentration, measured
results, exact MRP, remarks and attachment display metadata are encrypted using
the configured directory keyring. The AES-GCM AAD domain is
`evexia:immunotherapy:v1:{orders|requests}:{UUID}`, separate from directory
fields. Durable retry payloads **and responses** are encrypted too. Audits
contain actor/session/resource/action metadata, not personal snapshots.

Plaintext operational columns are order UUID/number/date/status/version, master
and file UUID references, bottle positions and creator/updater UUIDs. No
passwords, account authentication fields or clinical administration history are
copied. Directory key maintenance includes both new ciphertext tables without
altering historical directory field inventories. Old keys must remain available
until maintenance authenticates and re-encrypts every dependent envelope.

## Snapshot and mutation rules

- Ordinary edits retain original master and recipient snapshots.
- Replacing a relationship resolves and locks its eligible real master.
  New Patient/Doctor/MR combinations must match the existing directory assignment
  policy and Patient owner assignment. No directory record is silently changed.
- Changing the shipping recipient resolves its current eligible master; the
  resulting recipient snapshot is distinct from retained billing/identity data.
- Retained allergens keep their captured names/concentrations. Added allergens
  must be active, non-deleted references. Mix/No Mix does not restrict a bottle.
- Dosage is chosen explicitly: optional PD/DD, then ordered B1–B8 without wrap.
  Status is never evidence of an administered dose.
- Results are required non-negative decimal strings with at most two fractional
  digits. MRPs are validated as exact strings before numeric conversion. Totals
  are integer paise, capped at ₹10 crore. Bounds are 100 bottles, 100 allergens
  per bottle, 1,000 items across the order and 10 attached files.
- `IT-` order numbers are allocated by a database sequence; gaps are possible.
  The current Admin review form includes an optional Immunotherapy PO-number
  field; it is not a prerequisite for approval or fulfillment.
- Updates require the saved version. Conflicts keep the mounted draft and offer
  explicit comparison/reconciliation with the latest saved version.
- Mutations serialize their request UUID and atomically persist both the order
  and encrypted retry result. An unchanged retry recovers the committed result;
  reusing a key for another actor/payload is rejected. The UI keeps an unconfirmed
  submission unchanged and offers an explicit same-key retry.

## Reads and selectors

`/api/v1/admin/immunotherapy-orders` exposes list/create, detail and versioned
edit, bounded references, upload policy, prescription upload, complete export,
and reviewed import/commit. The authoritative API schema and generated
consumers describe the public contract.

List searches scan at most 500 ordered candidates per request, returning up to
100 matches (UI requests 25). UUID continuation permits empty matching sections
without falsely reporting the end of the directory. Ordinary status/date
filters have server counts; encrypted substring searches do not invent exact
global match counts. Explicit refresh restarts the cursor and clears selections.
Printing re-fetches selected orders and requires every one still be In process.
Labels and exports use each order's own historical snapshot, not master joins.

Reference searches examine at most 500 candidates and return a requested finite
section plus at most one selected eligible reference. Search and explicit
continuation have loading, empty, unavailable and retry states. Selecting a
Patient does not infer dosage. Inline registration calls the existing Patient
Master API with real DOB, language and Doctor assignment validation; it is a
separate committed operation and is not undone by cancelling an order.

## Private prescriptions

The picker reuses the existing themed upload presentation. Each file is sent
as bounded multipart data to the protected Immunotherapy prescription endpoint,
then through the established private object-storage, parser and malware-scanner
lifecycle. Supported formats are PDF, JPEG, PNG and WebP. The displayed maximum
is `min(configured upload maximum, 10 MiB)`, enforced on the server; multipart
overhead is bounded separately. Empty, incorrectly typed, malformed or
oversized contents do not become attachments.

Only clean-scanned verified uploads for the selected patient can be linked.
New associations also require the current uploader. Quarantined, unavailable,
failed and incomplete uploads remain explicitly **not attached**. Availability
checks never bypass scanning. Private downloads reauthorize the file after
reload. A missing scanner intentionally leaves files quarantined; this source
delivery does not claim that scanner/storage configuration is active.

### Shared upload failure handling (source-only)

Prescription uploads share Kits' private reservation/storage/verification path.
Lazy adapter initialization failures now return safe 503 `storage_unavailable`
instead of escaping as a generic 500; write/read failures have separate safe
codes. Internally constructed filename metadata validation is a safe 422.
No configuration, storage location or scanner security policy was changed.

The order multipart endpoints return 503 `scanner_unavailable` or
`scanner_failed` only after persisting the private quarantined state; infection
returns 415 `file_scan_rejected`. Only verified/clean results are successful.
The file ID remains available for an authorized metadata/reconciliation path.
Retrying availability does not itself rescan a file or make it eligible.
The picker retains the native File and draft; known failed storage reservations
can be retried with the selected original file rather than repeatedly reading
an unusable ID. Uncertain or quarantined outcomes keep their ID for inspection.
Already verified prescriptions and the selected-patient requirement are retained.
Safe allowlisted errors include UUID-shaped request references where supplied;
arbitrary server/provider messages are not displayed.

See [the shared incident evidence and prerequisites](kits-orders.md#kits-save-error-investigation).
The screenshot's incident cause and actual serving-process storage/scanner
configuration remain unestablished. Explicit private storage and a real,
reachable clean-scanning service are prerequisites, not supplied by this fix.
No tests were added/edited/run; no builds, regression/release checks, runtime
requests, manual/browser scenarios, restarts, migrations or deployments were
performed for this source-only correction.

Removing a picker selection does not delete stored bytes. Saving detaches the
association. The file service and database guard block destructive replacement,
state/owner/content changes or cleanup while any saved order still references
the file. Unattached reservations remain under the existing recoverable file
lifecycle; metadata alone is never treated as an upload.

## CSV / Excel

The eight-column toolbar/review UI is retained. Immunotherapy alone uses a server
adapter; SPT, Kits and Lupin keep their independent session stores.

Exports fetch a complete bounded authoritative filtered set before generating
CSV/XLSX with one captured date-preference context. Limits are 10,000 candidate
records and an 8 MB final file; exceeding the limit fails instead of exporting a
partial set. No file bytes or storage URLs are exported. The new schema marker is
`evexia.immunotherapy-orders/1`; the column names/order remain compatible.

Imports accept the current marker and legacy `evexia.session-orders/1` only for
Immunotherapy. Legacy PO numbers and external identity/recipient/allergen-name
snapshots are ignored, not persisted or trusted. Fictional IDs cannot resolve
to real masters and are rejected. Neither identity snapshots nor the legacy
patient-dependency column create or modify masters.

New records leave Order ID and Order number blank. Details JSON requires
`patientId`, `doctorId`, `mrId`, `dosage`, `histamine`, `saline`, `groups`,
`remarks`, `shipping`, and `status`. Each group has `id`, decimal-string `mrp`
and nonempty `items`; items have real `allergenId` UUIDs and decimal-string
`result`. The date is read from the canonical/date-context column. Use exports
as a concrete saved-order example; the downloadable template has headers only
and contains no fictional patients or orders.

Matching updates require real order ID, unchanged number/date and the exported
`version` in details JSON. Review validates and captures current authorized
references; commit revalidates the review token and all versions and applies the
entire batch transactionally. Changed matching orders require explicit
confirmation; unchanged rows do not increment versions. Limits are 500 orders,
8 MB source file and 1 MiB validated JSON request. Failure rolls back the batch.
Confirmed retries reuse the exact batch UUID.

Attachment metadata cannot restore uploads. Imports retain existing saved
associations for matching orders and attach no files to new orders. A patient
replacement cannot carry files belonging to the prior patient. Attachments must
be deliberately managed through real uploads in the order form.
