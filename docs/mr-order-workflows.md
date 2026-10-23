# MR live order workflows

## Scope

The existing EVEXIA MR shell now uses the same authenticated server order
services and shared screens as Admin for Immunotherapy, Kits & Consumables,
SPT and Lupin. These four workflows are explicitly authorized for MRs.
Dashboard, Targets and Payments remain fictional
session-only features; live order/Doctor IDs are not passed into their mutations.
No fictional records are migrated.

MR UI paths are `/mr/orders/immunotherapy` and
`/mr/orders/kits-consumables`, `/mr/orders/spt` and `/mr/orders/lupin`,
with their corresponding `new` and detail paths. Immunotherapy and SPT also
accept `/:id/edit`; SPT detail resumes Drafts and reviews Saved orders.
Lupin detail remains read-only. Shared API paths retain their existing
`/api/v1/admin/{immunotherapy,kits,spt,lupin}-orders` prefixes
for compatibility. A path prefix is not the authorization boundary.

## Server boundary

- Only a protected Super Admin or revalidated MR account can use these order
  services. The shared Allergen/Master authorization gates are unchanged.
- MR authorization resolves the authenticated account's active MR profile,
  directory record and usable Zone. A missing/unusable identity is an error,
  not a name match or a browser demo fallback.
- Workflow authorization installs the request-session scope before any order
  query. Scope helpers reject use without authorization. MR ownership is added
  to SQL predicates before direct order lookup, decrypt/search, counts,
  pagination and export.
- Reference queries and selected-value hydration expose only the current MR,
  active associated Doctors and active associated Patients. Patient ownership
  and Doctor assignment must both agree. Allergen references are accessible
  only through the order workflow, not generic Allergen administration.
- Creates and relationship changes reject any MR assignment other than the
  verified account's MR ID. Existing historical relationships/snapshots are
  retained when unchanged; new combinations require current eligibility.
- Reviewed imports and confirmed commits share these same checks. Existing
  order IDs are scoped before reading their snapshots. Reviews remain bound to
  the actor, submitted values and resolved snapshots; retries retain original
  actor/payload checks and recheck current order ownership before releasing a
  saved result.

## Narrow inline Patient registration

`POST /api/v1/admin/immunotherapy-orders/patient-registration` is an MR-only
fresh, active Patient enrollment. It validates the owned active Doctor before
duplicate checks/enrollment, derives MR ownership through that Doctor, and
retains existing Patient validation, numbering, encryption and audit rules.
It does not promote old identities, grant generic master permissions or infer
clinical/administration history. A lost registration acknowledgement requires
searching the order's Patient choices before repeating an uncertain submission.

`GET /api/v1/admin/immunotherapy-orders/patient-languages` provides bounded,
name-only language assistance after order authorization. Generic Patient Master
endpoints remain unavailable to MRs. Kits Patient remains optional and does not
implicitly register anything.

## Files and transfers

Existing private upload limits, format verification, scanning, quarantine,
storage lifecycle, version checks and safe association rules are retained.
MR read/download is allowed for a file actually attached to an owned order,
including an Admin-uploaded historical attachment even if current Patient/Doctor
assignments later change. Own unattached uploads remain inspectable during
draft recovery; uploader identity alone does not grant access to files now
attached only to another MR's orders. MR profile-file policy is unchanged.

MRs cannot generically delete, replace or recover private files, detach saved prescriptions,
or remove saved attachment associations through imports. New eligible
prescriptions may be added. Changing an order's Patient while retaining
patient-bound prescriptions is rejected.

CSV/XLSX use the existing templates, reviews, explicit matching-update
confirmation, date preferences and uncertain-commit recovery. MR Immunotherapy
imports reject legacy fictional-session transfer schemas. Kits browser-download
evidence accepts only its existing CSV/XLSX template/export metadata for an
authorized MR; global reports and other download sources remain denied.
Immunotherapy and Kits transfer adapters bind preparation, review, commit and download release to the
initiating account.

## SPT registrations and historical membership

Every MR SPT write, including an incomplete Draft and every imported row,
requires the authenticated saved MR ID. SPT ownership is applied in SQL before
order lookup, candidate scanning/decryption, counts, paging and complete export;
there is no separate broadly authorized SPT lookup path.

Minimal inline registration remains SPT-owned persistence, never Patient Master
or account creation. New registrations record `owner_mr_id` from the verified
server identity. Search, selected-value hydration, direct selections, reuse and
import dependencies use that same explicit owner. Old registrations and new
Admin-created registrations have no inferred MR owner. Their snapshots remain
readable only as retained membership on an authorized assigned order; this does
not make their directory entries selectable or reusable on another MR order.
Existing Patient Master choices still require both MR and Doctor eligibility.
Unique patient membership, quoted exact amounts, server totals and immutable
Saved orders are unchanged.

The additive source migration `0066_spt_registration_owner` follows
`0065_lupin_orders`. It adds a nullable operational MR reference/index, with no
historical ownership backfill. Coordinated source declarations and explicitly
reviewed maintenance successors are updated; no migration was executed.
Ciphertext rotation retains the predecessor registration payload inventory;
historical schemas do not select the new ORM ownership column.
The application requires this forward schema before operational use.

## Lupin attachments and transfers

Lupin new orders use the authenticated MR without a selector. Count remains
manually entered and independent of optional existing Patient links; only
count × exact per-test price determines total. Historical people and existing
status/payment classifications are retained.

MR uploads use only the dedicated Lupin digest-bound reservation workflow.
Generic `/files` reservations cannot bypass its actor-bound retry/cancellation
record. Read/download allows a verified attachment on an actually owned order,
including Admin uploads. Own unattached upload recovery also checks the current
MR assignment against its saved retry envelope. A dedicated cancellation may
remove only an own unattached upload after a durable tombstone, with association
rechecks; it does not grant generic delete, replace or recovery powers.
Verification, clean scan, size/type limits and private storage are unchanged.

SPT and Lupin CSV/XLSX adapters preserve formats, versions, date preferences,
historical snapshots, reviewed atomic commits and unchanged uncertain retries.
Preparation, review, commit and browser handoff are account/MR-bound. Browser
download reporting admits only CSV/XLSX export/template events for these order
types (and the existing Kits events), not general MR reports. Server import
matching is scoped before projecting history; relationship changes revalidate
current eligibility. SPT/Lupin retry envelopes additionally bind the originating
MR assignment and recheck all returned order ownership before releasing a saved
result. Legacy Admin retry envelopes stay usable for Admin, not newly promoted
MR access. A reassigned order cannot be recovered through a stale retry.

## Delivery evidence

**Source review only. Untested at the user's request.** No automated tests,
browser/manual scenarios, smoke requests, builds, typechecks, release checks,
test-triggering wrappers, service restarts, runtime verification, migrations,
production deployment or live data writes were performed for this work.
For SPT/Lupin, source and diffs were inspected for authorization, registration,
reference hydration, transfer/retry, private-file and MR route boundaries.
No tests were created. Existing API wire schemas are unchanged; no application
imports, generation scripts, release/validation wrappers or runtime checks were
run. The new migration hash and coordinated schema declarations are source
metadata only. Runtime behavior remains unverified; source completion is not
operational acceptance or database activation.
