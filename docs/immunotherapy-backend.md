# Admin Immunotherapy orders

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
  There is no Immunotherapy PO-number field.
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
