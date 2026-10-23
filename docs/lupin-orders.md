# Persisted Admin Lupin orders

## Scope and authorization

Lupin uses the existing protected Super Admin workflow at
`/api/v1/admin/lupin-orders`. No Staff, MR or Doctor portal grants are added.
Every read, reference search, export, upload, cancellation and mutation checks
the current session. No fictional browser fixtures are migrated. This work
does not add inventory, accounting, invoicing, payment collection, clinical
history, results, fulfilment or editable-order screens.

Confirmed / Unpaid is the initial classification, not evidence of payment,
clinical work or fulfilment. Reviewed transfers do not change classifications.
The existing Lupin statuses remain Confirmed, Approved, Shipped, Delivered,
Rejected and Returned; no status transition workflow is introduced.

## Independent count and real references

`patientCount` is a manually entered integer from 1 through 1,000,000.
It is the pricing quantity. `patientIds` is a separate ordered array of zero
through 200 unique, explicitly selected existing Patient UUIDs. Zero links is
valid for any valid positive count. Links never calculate, restrict or replace
the count, and counts never create Patient records.

Doctor and MR are required eligible real master references. New reference
combinations must match the Doctor's current MR assignment. Newly linked
Patients must belong to that Doctor. Changing Doctor/MR revalidates the
remaining combination. Removing or reordering links does not refresh retained
historical identities or calculate the quantity.

Historical snapshots contain only each selected person's ID and name, the
identity details used by this Lupin workflow. No contact/address, birth date,
gender, unrelated medical history, account details or credentials are copied.
An unchanged reference retains its historical identity even after master edits
or deactivation. New/changed references resolve on the server, never from
uploaded names or supplied snapshots.

`price` is positive exact INR decimal text, up to nine integer digits and two
fractional digits; excess precision is rejected, not silently rounded.
The server normalizes it to two decimals and computes `patientCount × price`
using Decimal. The client displays only an exact integer-minor-unit preview.
The authoritative saved total is returned by the server.

## Persistence and encryption

The additive migration `0065_lupin_orders` follows the merged source predecessor
`0064_procurement_documents`, which itself follows SPT. It adds orders, ordered optional Patient associations, unique
attachment associations and actor-bound encrypted retry documents, plus the
independent Lupin file owner/name columns and storage-domain constraints.
Existing applied migrations are not edited. Order numbering is a server
sequence (`LUP-00000001`); gaps are permitted. Saved dates are immutable.

Personal snapshots, remarks, original filenames and durable create/import/
upload-retry/cancellation documents use the existing managed Directory keyring.
AES-GCM AAD includes `evexia:lupin:v1`, document domain and record UUID. Filenames
in ordinary file metadata are generic `attachment.ext`; original names exist
only in encrypted filename/retry/order documents. Audit metadata records actors,
actions, IDs and outcomes, not personal payloads or filenames.

Supported offline Directory rotation includes Lupin orders, requests and file
names only at this new revision. Predecessor inventories retain their historical
field sets and content digests. File-name inventory projections exclude the
other domain's ciphertext so rotating one does not change the other's logical
content digest. Old keys must remain available until a separately authorized
rotation has completed its parity verification.

The application schema constant and development source metadata identify the
new source target. Migration classification continues under the existing
automatic policy. **A source target is not evidence that a database has been
migrated.** No new production catalog fingerprint or fresh-install evidence is
invented; existing catalog provenance is left unchanged.

## Private file lifecycle

Policy: at most 10 nonempty PDF, JPEG, PNG or WebP files, with matching verified
type/extension, at most the configured upload limit capped at 10 MiB per file.
Add Order requires at least one attachment. Multipart authorization and quota
precede parsing/storage; files use the existing private storage, byte verifier,
scanner, bounded operation leases, download authorization and cleanup services.
Only verified, scanner-clean files can be bound.

Files have an explicit Lupin actor owner, independent of Patient membership.
An uploaded file can belong to only one saved Lupin order, must belong to the
submitting actor and is locked during binding. Service checks and a database
guard prevent deletion/replacement of attached files while permitting encrypted
filename rotation. Saved review downloads actual authorized bytes; no public
URLs are added.

Each selected File has a stable upload UUID. Before storing bytes the server
durably records its actor-bound encrypted name/type/size/SHA-256 request and
reservation. Retrying the identical bytes recovers that reservation, including
a verified response lost in transit, rather than duplicating the upload.
In-progress leases return an explicit retryable conflict. Quarantined/rejected
files are not attached; users can remove them and choose the original again.
Storage failures and interrupted uploads retain the existing private cleanup
states.

Removal/discard first records an encrypted cancellation tombstone serialized
with reservation, even if no file is yet visible. A delayed original request
cannot subsequently reserve or bind that cancelled file. Known stored files
are then deleted through the existing private service; a cleanup failure keeps
the draft mounted for an explicit retry. A lost cleanup response is retryable.
The editor locks an uncertain order submission and preserves its key and body
for unchanged retry. A session-owner change clears local personal drafts rather
than transferring them to another actor.

Abrupt browser termination cannot promise immediate byte removal. Private
reservations/retry records remain recoverable under the existing file recovery
and retention operations; no public access or silent browser cleanup is claimed.
No automatic retention purge is introduced.

## Listing, transfers and limits

The listing uses authoritative applied search, date range, Doctor, MR, optional
linked Patient, order status and payment status filters. Draft filters do not
affect exports until Apply. Refresh reloads applied filters; Reset clears both
draft and applied state. Query changes reset pagination and abort stale reads.
Import/Export are grouped beside Add Order and use the shared master disclosure,
reset, reference-select and file-picker presentation.

List pages use UUID keysets, 25 rows by default, at most 100 results and 500
encrypted candidates per explicit section, with a five-second search budget.
The continuation may lead to another empty section for a rare encrypted search.
The UI does not call an incomplete search count a complete filtered total.
Complete export scans all applied-filter matches, across pagination, or rejects
more than 10,000 candidates, 8 MB or its 30-second application budget. Existing
database statement limits may reject earlier. No partial download is released.

CSV/XLSX share the versioned eight-column `evexia.lupin-orders/1` contract.
Exports capture saved date/time preferences once, declare their resolved date
context and use the existing safe spreadsheet cell encoding. Names/snapshots
are protected business exports, not evidence of live master values. Attachment
bytes, usable URLs, credentials and attachment references are excluded.

Review accepts 1–500 rows, up to 8 MB locally and 1 MiB validated JSON. It
validates real references on the server without saving orders. Confirmation is
atomic and actor-bound/idempotent, requires a current review token, and requires
explicit confirmation of updates. Updates need the exact saved ID, number and
version; stale records or changed relationships require review again. Input
names, totals and historical snapshot columns cannot overwrite server snapshots
or create masters.

Updates retain all saved file associations regardless of imported metadata.
Consistent with the established order transfer policy, new imported orders can
be file-less because transfers cannot restore private uploads. The UI explains
this allowance separately from Add Order's mandatory uploads. Missing rows do
not delete orders. Dates cannot change on existing orders.

## Verification status

This implementation was completed through source inspection only, as requested.
The API contract and clients were generated with the credential-isolated
OpenAPI exporter and direct Orval/constant-hoisting generation, without the
codegen script's chained type checks.

**No tests, builds, browser/manual scenarios, runtime probes, validation/release
wrappers, service restarts, migration execution, Git push or deployment were
performed.** No runtime, migration, storage/scanner, browser, accessibility,
concurrency, performance, import round-trip or encryption-rotation result is
claimed. All require separately authorized verification.
