# MR Immunotherapy and Kits & Consumables

## Scope

The existing EVEXIA MR shell now uses the same authenticated server order
services and shared screens as Admin for Immunotherapy and Kits & Consumables.
SPT/Lupin work is independent. Dashboard, Targets and Payments remain fictional
session-only features; live order/Doctor IDs are not passed into their mutations.
No fictional records are migrated.

MR UI paths are `/mr/orders/immunotherapy` and
`/mr/orders/kits-consumables`, with their corresponding `new`, detail, and
Immunotherapy-only `edit` paths. The shared API paths retain their existing
`/api/v1/admin/immunotherapy-orders` and `/api/v1/admin/kits-orders` prefixes
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

MRs cannot delete, replace or recover private files, detach saved prescriptions,
or remove saved attachment associations through imports. New eligible
prescriptions may be added. Changing an order's Patient while retaining
patient-bound prescriptions is rejected.

CSV/XLSX use the existing templates, reviews, explicit matching-update
confirmation, date preferences and uncertain-commit recovery. MR Immunotherapy
imports reject legacy fictional-session transfer schemas. Kits browser-download
evidence accepts only its existing CSV/XLSX template/export metadata for an
authorized MR; global reports and other download sources remain denied. Both
transfer adapters bind preparation, review, commit and download release to the
initiating account.

## Delivery evidence

**Source review only. Untested at the user's request.** No automated tests,
browser/manual scenarios, smoke requests, builds, typechecks, release checks,
test-triggering wrappers, service restarts, runtime verification, migrations,
production deployment or live data writes were performed for this work.
OpenAPI export, direct client/schema generation and generated-source formatting
were performed without their usual validation wrapper. Runtime behavior remains
unverified; source completion is not operational acceptance.
