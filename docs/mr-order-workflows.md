# MR live order workflows

## Immunotherapy Order Batch No

Final placement, including explicit submission of a saved incomplete draft,
issues the same persisted read-only batch shown in the authorized Admin and MR
lists, editors and summaries: `E | PD | 11 | 0002` (or the actual placement
dosage, including B1–B8). The sequence starts at 0001 each full year/month,
shared across all dosages and actors; the month comes from the saved order date
under the existing Asia/Kolkata convention. Four-digit padding is a minimum,
not a maximum. There is deliberately no visible year, so the label is not a
globally unique order identity.

Drafts say **Generated on placement** and allocate nothing. Legacy orders say
**Unavailable**; no historical batch is inferred or backfilled. Saved batch
labels retain their placement dosage even after a permitted dosage edit.
Unchanged final-placement retries reuse the same saved order and label.
Existing IT/SUB numbering, MR ownership, grouping, prescription verification
and financial/review behavior are unchanged.

This delivery is source-reviewed only. Migration `0083_immunotherapy_batches`
is prepared but unapplied by this work. No tests, regression/release checks,
validation/completion wrappers, services, runtime/browser probes or deployments
were run. See [the backend contract and limitations](immunotherapy-backend.md#order-batch-no-source-only-delivery).

## Scope

The existing EVEXIA MR shell now uses the same authenticated server order
services and shared screens as Admin for Immunotherapy, Kits & Consumables,
SPT and Lupin. These four workflows are explicitly authorized for MRs.
Dashboard, Targets and Payments remain fictional
session-only features; live order/Doctor IDs are not passed into their mutations.
No fictional records are migrated.

MR UI paths are `/mr/orders/immunotherapy` and
`/mr/orders/kits-consumables`, `/mr/orders/spt` and `/mr/orders/lupin`,
with their corresponding `new` and read-only detail paths. All four also
accept `/:id/edit` for eligible owned orders; Draft Resume is a separate action.
Shared API paths retain their existing
`/api/v1/admin/{immunotherapy,kits,spt,lupin}-orders` prefixes
for compatibility. A path prefix is not the authorization boundary.

## Server boundary

- Order services require existing Admin-side resource authority or a revalidated
  owning MR account. Protected Kits administration remains Super-Admin-only.
  The shared Allergen/Master authorization gates are unchanged.
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
Unique patient membership, quoted exact amounts and server totals are unchanged.
Saved means submitted, not approved; incomplete Drafts cannot be approved.

## Owning-MR corrections and explicit review cycles

- Pending is Confirmed for Immunotherapy/Lupin/Kits and submitted Saved for
  SPT. SPT Draft is not submitted. Approval records actor/time and advances the
  current lifecycle directly to In process; Approved is decision evidence, not
  an additional lifecycle status or summary card.
- A genuinely Rejected order without approval evidence permits owning-MR
  corrections on the existing edit route. Saving retains Rejected and its
  reason, business number, identity and owner. It never implicitly resubmits.
  Approved and fulfilled orders remain MR read-only.
- All four types expose separate saved-version Approve/Reject endpoints.
  Rejection requires a nonblank plain-text reason of at most 2,000 characters,
  independently of completed pricing. The reason and per-cycle history stay
  inside encrypted snapshots and encrypted retry state. Audit events contain
  only operation/resource evidence; exports omit reasons and history.
- Only the owning MR can explicitly resubmit a saved correction, with its
  current expected version and original owner-bound retry key. The normal
  reference, patient, attachment and submission-completeness rules are applied
  before the row atomically becomes Confirmed (or SPT Saved). Active decision
  markers are cleared, not history. Each new rejection needs a fresh reason.
- Legacy Rejected records remain readable even without decision/reason data.
  Missing reasons are explicitly unavailable. They use the same authorized
  correction-save/resubmit boundary; no historical decision is fabricated.
- Approval actor/time lives in the existing authenticated encrypted snapshot and
  is accompanied by a protected audit event. No new table/column, readiness
  migration or historical approval backfill is needed. Missing evidence is
  represented as absent, including historical terminal orders.
- Kits approval retains protected Super Admin authority. Other approvals
  requires existing Admin-side edit authority, revalidated on the server; MR
  authority is explicitly rejected regardless of the displayed portal.
- Direct writes and import review/commit cannot change review status or inject
  server-owned history. Exact actor-bound retries retain operation, reason,
  version and key, do not replay mutations, and reproject the latest authorized
  saved state rather than returning a superseded pending snapshot. A stale
  draft never overwrites a newer save or decision.
- Saved MR files cannot be detached/replaced. Additional files use existing
  private upload verification/scanning; Immunotherapy writes still require a
  verified prescription for the selected Patient.
- MR edits retain Immunotherapy PO/basis/retained rates, Kits pricing/PO/Business
  Parking, Lupin saved unit price and existing SPT patient amounts. Changed
  pricing bases retain protected data but mark approval pricing as needing
  Admin review; new occurrences do not inherit invented rates. Admin must save
  current valid pricing before approval. Issued occurrence IDs stay historical.
- On View and Edit, Admin decision controls show ineligibility for drafts,
  rejected, already decided and fulfilled records. Dirty editors must save
  first, then approve the resulting saved version. Rejection against the saved
  submission requires a separate explicit choice when unsaved edits exist;
  those edits remain mounted and are not silently rebased onto a newer version.
- Both portals render current status, recorded approval with In process,
  Awaiting review, rejection reasons and encrypted history as React text.
  Rejected list rows direct the reader to View for the reason/correction path.
  Confirmed writes refresh authoritative lists/counts through navigation,
  same-browser change signals, focus/visibility refresh and a finite polling
  interval. Editors do not subscribe to background replacement of drafts.

### Source-only delivery review

No tests, automated browser checks, builds, release/validation wrappers,
workflows, migrations, uploads, order decisions or production operations were
run for this refinement. Generated API contracts are source artifacts only.
Only offline contract export, client/schema source generation and formatting
were performed; the normal codegen wrapper's typecheck was not run.
No new database migration is needed by this review cycle: it extends the
existing encrypted snapshots and uses already-declared statuses. No database
schema was inspected or changed, and services were not restarted.

The source/diff review traced all four types through:

| Path | Source-level boundary reviewed |
| --- | --- |
| Submit and approve | Existing role grants; Kits protected authority; saved-version row lock; saved pricing and document checks; In process plus fresh evidence |
| Reject and cancel | Required bounded reason; no pricing prerequisites; no request on cancellation; encrypted reason/history; version increment in the same transaction |
| Correct and save | Owning-MR SQL scope; immutable identity/number; retained files/protected pricing; Rejected and current reason retained |
| Explicit resubmit | Saved-correction marker; exact expected version; normal submission validation; pending state restored while preserving prior-cycle history |
| Later approval/rejection | Pending eligibility ignores archived decisions; fresh approval evidence or newly required reason; approval closes MR editing |
| Conflict and lost response | Serialized owner/key fingerprint; latest authorized reprojection; frozen retry payload; no early success; unsaved values remain mounted |
| Legacy and direct/import writes | Missing reasons unavailable; explicit legacy correction path; no review transition or financial-field bypass |

These are source-level conclusions, not exercised transitions. Runtime
transaction behavior, active schema compatibility, generated client compilation,
focus/keyboard behavior, cross-tab refresh and provider-backed file checks remain
unverified. Nothing in this delivery establishes that a save or transition ran.

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

## Immunotherapy grouping at new MR placement

Shared Super Admin **Immunotherapy → Extract & Dilution** settings now assign
explicit saved category/rank pairs at new final MR placement only. After the
existing category/Mix membership is formed, each bottle's children are sorted by
numeric Skin Test Result descending with stable ties. Rank restarts within each
bottle, including overflow and No Mix: one child uses row 1; two use rows 1–2;
three use rows 1–3. No medical quantities are invented, seeded or calculated.
Missing pairs stay unrecorded for Admin completion. Values and original
category/version/rank evidence are persisted with the order in its placement
transaction. Drafts do not capture settings or issue SUBs; committed placement
retries do not apply later configurations.

MR corrections cannot supply these clinical values; saved quantities and review
protections remain server-owned. MR exports omit Admin-owned quantities so
permitted corrections remain importable; Admin saved editors/summaries use the
same persisted order and values with manual overrides and explicit approval.
Neither settings changes nor ordinary edits/reads reapply or reorder history.
See the shared category-ranked section in `immunotherapy-backend.md` for API,
concurrency and the unapplied migration/runtime verification limits.

The new MR entry form proposes same-category Mix groups of up to three selected
allergens, with a fourth in another group; No Mix selections are always alone.
All selected occurrences and entered skin-test results are preserved. Incomplete
draft saves/resumes retain this working composition and any unfinished picker
entries without allocating real SUB identities. Older incomplete drafts hydrate
only their selected references with bounded concurrency when grouping metadata
is missing. Unavailable metadata is explicit, not assumed Mix or assigned to a
fictional category. Removal can repack proposed groups, never saved SUBs.

Final placement reconstructs groups using authoritative locked master metadata,
not draft/client flags, and immediately issues one parent-derived SUB per actual
group. A grouped SUB is priced once in Admin review, with its children retaining
their individual test results and existing clinical review requirements.
The MR and Admin saved editor/summary use identical stored IDs/membership.
Future master changes do not regroup saved orders. Saved composition changes
validate the saved basis for retained children and current metadata for added
membership, without automatically merging, repacking or renumbering SUBs.
Existing historical orders and unrelated Admin creation retain their policy.
See `immunotherapy-backend.md` for persistence and retry boundaries.

This addition was reviewed in source/diffs only. No checks, wrappers, browser
verification, service restarts, live writes or deployment were run.

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
