# Kits & Consumables saved orders

Admin Kits is a protected Super Admin supply-order workflow. Staff grants, MR
and Doctor portals, Immunotherapy, SPT and Lupin retain their existing boundaries.
No stock, financial ledger, invoice, payment collection, clinical history or
implicit master creation is performed. Payment status is an explicit order
classification only; Paid is not proof of a payment transaction.

## Persistence and historical data

`0062_kits_orders` is an additive successor of `0061_immunotherapy_orders`.
It follows the current automatic migration policy. Development source pins are
regenerated, not migration execution evidence. Existing applied migrations are
unchanged. The production fresh-install catalog remains at its previously
reproduced target: no new catalog fingerprint can honestly be produced without
a real PostgreSQL reproduction. This source-only implementation does not claim
new production installation/release evidence.

The API is `/api/v1/admin/kits-orders`: list/create, detail, bounded real-master
references, upload policy/attachments, complete export, import review/commit.
UUID operational Doctor, optional MR and optional Patient references are stored
separately from encrypted historical documents. Doctor billing is mandatory.
Patient is optional; a newly selected Patient must belong to the current Doctor.
An explicitly selected MR must match the Doctor's current assignment. MR orders
and MR shipping require an MR; supply orders never require a Patient.

Snapshots retain only identity/contact/address information needed for supplies,
the authored shipping recipient, kit configuration, remarks, status, payment
classification and attachment details. Birth dates, demographics, dosage and
treatment history are not captured. Unchanged associations retain saved
identities when masters are renamed, reassigned or unavailable. Changed
combinations are validated against eligible current records. Saved dates are
immutable. Create uses server sequence numbering (`KIT-`), audit attribution and
actor-bound durable idempotency; imports update only with current ID/number/version.

Document, retry and filename ciphertext uses existing Directory keys with
authenticated `evexia:kits:v1` domains for orders, requests and file names. No
plaintext snapshots or request bodies are logged. Keep old keys until an
authorized offline rotation has completed and verified all domains. Directory
rotation explicitly includes Kits orders, durable retry documents and private
file names at this revision; predecessor inventories remain unchanged.

## Listing and transfers

List/search uses finite UUID keysets (25 default, 100 maximum), scans at most
500 encrypted candidates per section, and has a five-second budget. Continuation
may be necessary even when a search section has no matches. Operational filters
(date range, Doctor, MR, Patient, order-for, status and payment classification)
are SQL predicates. Sensitive historical search runs only after authorization
and decryption. Search counts are unknown until a complete scan, not fabricated
from the visible section. Reference selectors read bounded sections and hydrate
one selected current UUID, never auto-traverse a master directory.

Export reads all matching saved orders or fails above 10,000 candidates, 8 MB
of document data, 30 seconds, or the final file/workbook limits. CSV and XLSX
preserve one captured date-preference context and historical people, shipping,
billing and optional Patient details. Formula-safe cells use existing portable
escaping. File bytes and download URLs are never exported. Browser handoffs use
the existing durable metadata-only Download Logs mechanism.

The eight-column `evexia.kits-orders/1` format has Schema, Order type, Date
context JSON, Order ID, Order number, Order date, Order details JSON, Patient
snapshot JSON. The template is blank. For new records leave ID/number blank,
and supply `doctorId`, optional `mrId`/`patientId`, `orderFor`, `kit`,
`lancets`, `applicators`, `tray`, `shipping`, `other`, `remarks`, `status`,
`paymentStatus`. Configuration and counts are strings; blank means omitted.
Kit properties are `product`, `custom`, `volume`, `quantity`; non-custom kits
have blank `custom`. Other recipients have `name`, `phone` and `address`
(`line1`, `line2`, `landmark`, `country`, `state`, `city`, `pincode`).
Use ISO dates or retain the declared export context.

Up to 500 CSV/XLSX records / 8 MB are parsed locally into at most 1 MiB of JSON
for server review; the actual ingress JSON limit remains 1 MiB. Review returns
server-resolved before/after documents and an actor-bound authenticated digest.
Confirmation revalidates everything in one transaction, including current
references and versions. Updates require explicit confirmation. External
names/snapshots are informational, not master authority; metadata cannot
attach or restore files. Imports retain the saved file set and new imported
orders have no uploads. An ambiguous commit locks the original review and
retains its stable retry identity; do not create a replacement batch.

## Private files and failure custody

The existing private object lifecycle supports a distinct `kits/<actor UUID>/`
document owner. No fictitious Patient or MR owner is created. Permission is
checked before parsing multipart data or constructing storage. Only the
protected Super Admin can use this owner type; MR patient-file permissions are
unchanged. Original file names are separately encrypted; file metadata stores
only a generic `attachment.ext`. Existing object storage adapters, type/byte
verification, scanner quarantine, operation leases and integrity-checked
downloads are reused.

Orders attach at most ten PDF/JPEG/PNG/WebP files, each nonempty and no more
than 10 MiB (or the smaller configured upload limit). Only verified clean files
uploaded by the actor may be newly associated, once, with a saved Kits order.
Historical file sets can be retained by reviewed updates. Linked files cannot
be deleted, replaced or reassigned behind the order; database guards back this
restriction. Downloads remain authorized, private and no-store.

Files selected in Add Order remain in the mounted draft and upload on Save.
Successfully uploaded IDs are reused when retrying a rejected order save.
Ambiguous order submissions retain the identical payload/key and disable edits.
Failed/interrupted uploads leave explicit reservations or pending cleanup;
quarantined files are never attached or represented as successfully restored.
As in the shared file lifecycle, abandoned verified uploads are retained, not
silently deleted on an invented retention schedule. Their actor/UUID metadata
allows authorized inspection and explicit DELETE cleanup through `/files`.
`/files/{id}/reconcile` handles interrupted and quarantined reservations.
Never delete an apparent orphan solely because a browser response was lost;
confirm that no saved Kits association exists first (also enforced server-side).

## Verification boundary

### Kits save error investigation

Source tracing confirms that selected native files upload before the create
request. The later supplied screenshot explicitly identifies attachment upload
as the failed stage and includes a request reference. It does not establish the
HTTP status, safe service code or failing backend source location. The earlier
Immunotherapy screenshot shows a generic internal-server error during
prescription upload. No correlated sanitized serving-process error record was
available in the supplied evidence or the inspected local log locations.
Failed duplicate-startup logs, if supplied later, must not be treated as
evidence of the configuration/revision of the process actually serving uploads.

The earlier filename fix catches internally constructed `UploadRequest`
validation errors as 422; it is **not** an established explanation or resolution
of this incident. The same metadata boundary is now handled for prescriptions.

The confirmed shared source defect was lazy storage adapter construction
outside the upload error handler. Missing local-root configuration, unsafe root
permissions or another adapter initialization exception could escape to the
generic HTTP 500 middleware even for a valid selected file. That boundary now
returns 503 `storage_unavailable` and attempts a recoverable reservation
transition, without changing storage configuration or selecting another backend.
Storage writes separately return `storage_write_failed`; unreadable upload
streams return `upload_read_failed`. This corrects failure handling, not the
underlying absence of an operational dependency.

Both order multipart routes require clean verification before a successful
response. A missing scanner returns 503 `scanner_unavailable`; failed scanning
returns 503 `scanner_failed`. The already stored object stays private and
quarantined. Infection returns 415 `file_scan_rejected` with rejected state.
No scanner response is fabricated. Generic private-file and Lupin publication
contracts are not changed by this order-specific response gate.

Cleanup cannot replace the initial upload/publication error. Cleanup row locks
are non-waiting, unchanged file states release their transactions, and operation
leases release acquired advisory locks or invalidate their held connection if
unlocking fails. A failed cleanup retains a durable reservation for authorized
reconciliation and logs only its fixed failure category and request reference.
No stored bytes are automatically deleted by these changes.

The Kits form now distinguishes upload, order-validation and order-save
failures. It displays allowlisted guidance and a UUID-shaped request reference
when provided, not arbitrary server exception text. Native files and verified
uploads stay in the mounted draft. A create response without a usable order ID
is treated as uncertain, retaining the original payload/key rather than clearing
it and navigating to an unidentified order. Retry conflicts likewise retain
that original identity. Kits and prescription transport failures now use
allowlisted messages/codes and UUID-shaped request/file references, including
malformed/non-JSON responses. Arbitrary server error strings are not displayed.
Prescriptions retain native files on failure; a failed storage reservation does
not trap Retry in repeated metadata requests for an unusable ID. Quarantined or
uncertain uploads retain their ID for an availability check, not automatic
re-upload or fake verification.

Patient remains optional in both the Kits client payload and server schema;
authenticated MR ownership, Doctor/Patient/shipping relationships, encrypted
Kits names, size/type validation and clean-scanner requirements are unchanged.
Immunotherapy still requires a verified prescription for its selected patient.
No successful upload or order persistence is claimed as verified.

The declared development defaults are `STORAGE_BACKEND=local`,
`LOCAL_STORAGE_ROOT` unset and `SCANNER_BACKEND=unavailable`. The development
launcher does not provision or override those dependencies. Startup and policy
availability therefore do not prove upload readiness. This source inspection
did not inspect secret values or establish the actual serving process's effective
configuration. Successful verification requires an explicitly approved private
local root (application-owned 0700, normalized absolute path) or an explicitly
configured durable S3 backend, plus a reachable maintained real clamd scanner.
Changing configuration/storage location, installing a scanner, reconciling files
or restarting services requires separate operational approval; none was done.

To identify the original incident, obtain only the failing operation
(`POST /api/v1/admin/kits-orders/attachments` for the later screenshot), HTTP
status, safe error code and
`X-Request-ID`/`error.request_id`, then correlate that reference with the actual
serving process's existing sanitized error record. If it is only a generic
unhandled-error record, an operator will still need a sanitized exception class
and failing source location. Do not collect filenames, file contents, payloads,
credentials, SQL parameters or raw tracebacks.

This investigation and correction used source inspection only. No tests were
added, changed or run; no builds, type checks, browser/manual scenarios, runtime
probes, release/validation wrappers, restarts, migrations or deployments ran.

No code generation or development-metadata generation was run for this upload
correction. Runtime behavior remains unverified.
