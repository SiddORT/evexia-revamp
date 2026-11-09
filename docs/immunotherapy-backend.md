# Admin Immunotherapy orders

## Dose- and count-specific Extract & Dilution (source-only delivery)

Super Admin configures **Settings → Immunotherapy → Extract & Dilution**.
The category picker searches/paginates saved nondeleted Product Categories,
including inactive categories, by name; persistence uses the category UUID.
Each category/dosage has six independent ordered extract/dilution pairs:
Single rank 1, Double ranks 1–2, Triple ranks 1–3. Dosages are the canonical
PD, DD and B1–B8 choices; no numeric dose-category mapping is inferred.
All pairs use the existing
exact ml string contract: up to six whole digits and three fractional digits,
nonnegative; entered zero is valid and distinct from absent/null. There are no
sample clinical defaults, dose/ratio calculations or concentration interpretations.

`GET /api/v1/admin/immunotherapy-extract-settings/categories` accepts `query`,
`offset` and `limit`; GET `/{category_id}?dosage=PD` reads one category/dosage;
POST `/{category_id}` saves the explicitly supplied dosage.
Both configuration reads and writes require the existing protected Super Admin
operational-settings authorization, not general order or master permissions.
MRs and ordinary staff cannot configure values. POST sends policy
`category_dosage_count_rank_v2`, canonical `dosage`, exactly six `rows` with
explicit `compositionSize` and `rank`, and `expected_version`.
Rows must follow the Single/Double/Triple rank order. Old three-row write
contracts are rejected with 422, never converted into the new policy.
Absence is version 0 with null quantities, not a seeded
clinical formulation. First save creates version 1. A version mismatch rejects
with `imm_extract_stale`; failed/conflicting/unknown saves retain the UI draft.
The editor blocks uncertain resaves until an explicit reload, keeps edits for
comparison, displays last-loaded saved rows and only reports save success after
a matching category/dosage/version/row acknowledgement. Category and dosage
switches share the unsaved-edit guard and response invalidation.

The encrypted payload is a strict schemaVersion-2 envelope with all ten dosage
slots explicitly present, each null or a versioned six-row block. The existing
category-keyed table and encryption domain are unchanged; no new migration or
readiness revision is needed for this expansion. The table's version remains a
category storage revision; optimistic concurrency uses the selected dosage
block's version. An exclusive settings lock reads/modifies/reseals the latest
envelope, preserving every other dosage, including concurrent unrelated saves.
Conflicting saves to the same dosage fail instead of overwriting.

Original three-row encrypted lists are read as legacy evidence only. Their rows
and original category revision appear as read-only `legacyRows`/`legacyVersion`;
the first explicit dosage save retains them inside the envelope. No legacy rows
are cloned into any dosage/count block. Unreadable legacy or new payloads fail
explicitly, even when the selected dosage is not configured. The existing
directory key-rotation domain rotates the whole envelope without interpretation.

The additive `0086_immunotherapy_extract` migration creates the empty
`immunotherapy_extract_settings` table. It follows the independently merged
`0086_it_pricing_rules` revision in the linear migration graph; the distinct
revision IDs remain authoritative despite their shared numeric prefix. The
existing Pricing Rules migration is unchanged. Values are encrypted using the existing
Immunotherapy envelope/keyring, bound to the category UUID and a distinct
`extract-settings` domain. Directory maintenance includes this domain only at
the new revision, preserving historical inventories. Readiness inherits all
predecessor probes and checks the new table/columns. Missing schema, unreadable
ciphertext or invalid stored rows fail explicitly; storage errors are not treated
as unconfigured values.

### Placement and history boundary

Only new authoritative MR category/Mix final placements receive assignment,
including successful final submission of a resumable incomplete draft:

- First form membership using the existing grouping policy and issue its original
  SUB identities; never globally sort/repack or change bottle order.
- Within each resulting bottle sort children by exact `Decimal(result)`,
  descending. Stable sort retains equal-result relative order.
- Use the authoritative saved order dosage and category UUID, then the actual
  child count in **each formed bottle**, then the rank. Three children use
  Triple, two use Double, one uses Single. Four same-category Mix occurrences
  therefore use Triple and Single for their existing three-item and overflow
  bottles, never an order-wide count. No Mix uses Single. Values may coincide
  but never implicitly fall back across counts, categories or dosages.
- Under one shared transaction-level configuration lock, load each effective
  category version once and copy the actual optional values into the child.
  All setting writes use the corresponding exclusive lock, including initial
  insertion, so a placement cannot mix configurations changed mid-placement.
- Persist immutable per-child `clinicalAssignment` evidence: policy
  `category_dosage_count_rank_v2`, category UUID, saved dosage, composition size,
  dosage configuration version, assigned rank and both original assigned optional
  values. Version 0 identifies a missing category/dosage configuration; blank values
  remain null and are identified for Admin completion.

Assignment occurs in the final order transaction, not eligibility previews,
import reviews, incomplete draft saves or reads. No draft reserves SUBs or
freezes settings. The existing owner/request-bound retry record is checked
before placement; a committed retry reads the saved order rather than consulting
new settings. Configuration failure rolls back placement rather than partially
committing clinical values.

Admin editor/summary iterate the same saved child order and values, show
placement evidence and retain normal manual editing and explicit approval.
Existing completeness checks still require a header MRP, every child's extract
and dilution, and a verified patient prescription. Defaults never approve an order.
Manual overrides retain original placement evidence; it is not a claim that
current edited values still equal the original assignment.

Ordinary MR corrections continue to omit Admin-owned clinical fields; the server
retains saved quantities by SUB/allergen occurrence and retains Admin review
protections. MR portable exports omit those fields and assignment provenance
so unchanged exports can be used for permitted corrections without submitting
clinical authority. Admin transfers carry quantities normally; incoming
provenance is never authoritative. No setting changes, saved edits, imports,
master changes or historical reads reapply defaults or reorder saved children.
New children in an existing SUB require ordinary Admin completion, not automatic
reapplication. Historical conversions and unrelated Admin-created compositions
retain their previous policy and quantities.

### Source trace and verification limits

Source/diff inspection traced three/two/one-child bottles, distinct categories,
overflow, No Mix, numeric versus lexical order, stable ties, absent/partial
configuration, all ten dosage choices, legacy recovery, distinct count blocks,
version-0 concurrent insertion and dosage-local version conflicts, consistent
placement reads, draft/final submission, owner-bound retries, manual overrides,
MR direct/import corrections, historical reads and approval completeness.

OpenAPI and generated client/Zod source were regenerated using the contract
exporter and direct generators/formatting, **without** the codegen script's
typecheck wrapper. Pre-existing unrelated Pricing Rules contract/generator
differences were excluded from this change. No regression/release checks, builds, typechecks, browser
tests/screenshots, smoke requests, service restarts, live clinical writes,
deployments or migrations were run. This dosage/count expansion adds **no schema
migration** and does not apply the existing `0086_immunotherapy_extract`
migration or any other pending schema work. Its existing table is still required
and fails closed when absent. Runtime persistence,
authorization, locking, placement/retry and responsive/accessibility behavior
remain unverified; source completion is not operational acceptance. Production
fresh-install catalog evidence has not been fabricated or advanced.

## Order Batch No (source-only delivery)

New final placements issue a server-owned `orderBatchNo`, for example
`E | PD | 11 | 0002`. The dosage segment is the actual placement dosage
(`PD`, `DD`, or `B1`–`B8`), not a new clinical choice. Spaces around each pipe
are intentional. Month is two digits; ordinal padding is a **minimum** of four
digits, so 9999 is followed by 10000 without wrap or truncation.

One counter is shared by every Immunotherapy placement in a full calendar
year/month, regardless of dosage, MR or placing actor. The authoritative saved
order date selects the month, using the existing Asia/Kolkata date convention
when no explicit permitted order date was supplied. The first committed
placement in each month starts at 0001; January and the same month in a later
year have independent counters. No year appears in the label: identical labels
in different years are expected and never replace UUID or IT order identity.

The new `immunotherapy_batch_counters` table stores only a first-of-month date
and an integral positive NUMERIC high-water mark. An atomic PostgreSQL
`INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` serializes competing
placements on the same month until transaction completion. Counter increments,
order snapshots, existing SUB issuance, attachment associations, audit events,
notifications and retry outcomes share the existing transaction. Failed writes
roll back the increment; no increment commits without its placement. There is
no dosage/actor partition or reuse of the IT, SUB, PR or inventory counters.

The encrypted order snapshot stores `orderBatch` with the exact issued label,
full year/month, ordinal string and placement dosage. Public `ImmRecord`
projects the saved label as optional nullable `orderBatchNo`. Strict write and
import schemas do not accept either generated field, and the handwritten
client explicitly allowlists writable inputs. Existing orders without this
envelope project null and display **Unavailable**; reads and legacy edits
never allocate or fabricate it. Subsequent dosage changes do not rename an
issued batch. Approval/rejection and shipment operations retain the original
encrypted snapshot envelope.

The final creation boundary is the shared `immunotherapy.apply()` path:
direct Admin/MR placement, final submission of a creator-private draft, and
permitted new import commits all reach it after their existing checks.
Incomplete draft persistence and import review never reach issuance. Direct
unchanged retries recover the current saved order under the existing
actor/key/payload lock before calling placement again. Draft submission links
its saved order inside the same transaction and reopens that linked order on
retry. Import retries likewise recover their existing saved orders. Nothing
changes prescription, ownership, category/Mix grouping, pricing, approval,
order-date immutability or IT/SUB-number policy.

Existing authorized Admin/MR lists, saved editors and shared summaries use
the persisted response field. Unsaved/resumed draft editors say **Generated on
placement**, never preview an assumed ordinal or calculate a label from the
editable dosage/browser clock. No document template or notification payload
was changed.

### Prepared migration and source review limits

Forward migration `0083_immunotherapy_batches`, after `0082_order_drafts`,
creates the empty counter table only. Applied migration sources are unchanged.
There is no historical backfill, saved-order rewrite or sequence initialization
from historical orders. Downgrade refuses to discard issued high-water marks.
The coordinated development declaration, automatic migration classification,
source-byte integrity metadata and explicit account/directory compatibility
are updated. Readiness inherits the complete predecessor probe chain and adds
the counter-table probe. Source pins were updated directly from source hashes;
no metadata/check wrapper or application module was executed. The additive
OpenAPI response declaration and checked-in client response types/Zod readers
were edited directly without running code generation.

Static tracing covered shared month scope, full-year separation, December/
January boundaries, backdated permitted imports, mixed dosages/actors, atomic
counter conflict handling, unchanged retry recovery, failed transaction and
savepoint rollback, incomplete drafts, legacy reads/edits, dosage corrections,
approval/shipment snapshot retention, and ordinals above 9999. This is source
reasoning, **not evidence of successful execution**.

**No tests were added, changed or run; no builds, regression/release checks,
validation/completion wrappers, service starts/restarts, browser/manual runtime
probes, live data edits, migration execution or deployment were performed.**
The migration remains unapplied by this work, and running-schema, concurrency,
persistence, retry and UI behavior remain unverified. Production catalog and
release evidence retain their existing real targets; they were not fabricated
or relabeled. Activation belongs to the separately authorized normal lifecycle.

## Suborder-header review contract (current, source-only backend delivery)

This section supersedes all per-occurrence-rate editing and historical
repricing instructions below. MR initial saves remain unpriced submissions:
the server assigns a compact SUB number per initial allergen occurrence on
the first successful save. Saved `SUB001` and older `SUB-000001` spellings are
never changed. Admin adopts `pricingBasis: "suborder_mrp_v1"` explicitly in an
editable saved order, not by opening Edit. No historical backfill runs.

In that version, `groups` is the single writable canonical suborder list.
Each `groups[].id` is an exact previously issued SUB identity, with one
nullable `mrp` and `items` containing allergen reference, required skin-test
`result` (mm), and nullable `extract` / `dilution` (ml). Children have no
separate price or SUB identity. Quantities are decimal strings: nonnegative,
up to six whole digits and three fractional digits, separately validated from
mm results and two-decimal INR. Null stays not recorded, never zero.

Conversion requires all original SUBs separately, each retaining its original
allergen as its initial child; additional children can be appended to that
same SUB. An old occurrence rate can be the initial header MRP; bottle MRPs
are never distributed among SUBs. Header identity cannot be invented,
renumbered, merged or recycled. Removed SUBs cannot be reintroduced through
this editor. Conversion preserves full original groups, snapshots, rates and
bottle associations in server-owned encrypted `historicalGroups`, together
with `historicalPricingBasis` and `historicalTotalMinor`. These are read-only
provenance, not a second independently writable composition. Reads issue no
identities and perform no conversion.

The exact total is one MRP per header, independent of child count. Any missing
MRP means Awaiting pricing; zero is valid. The existing ₹10 crore cap applies
even to partially priced drafts. Approval requires the new basis, complete
header pricing, valid distinct children within each SUB, extract/dilution for
each child and a currently verified prescription associated with the patient.
The same allergen in different SUBs is legitimate. PO is optional. Incomplete
review drafts may be saved, and rejection does not require fabricated prices
or volumes. Approved/closed orders are read-only, including old completed
orders: reading them never requires conversion, new clinical values or
reapproval. Existing rejection/correction/resubmission evidence stays intact.

Direct writes and both import stages share the same authority boundary. MR
cannot adopt the basis or set MRP, rates, extract/dilution, PO or decisions.
MR corrections omit Admin fields and retain matching saved review values;
composition changes follow existing review invalidation. Admin does not edit
historical occurrence rates or bottle MRPs; explicit canonical adoption is
required for pricing changes. Persisted pre-upgrade retries compare absent
and null additive defaults equivalently and recover the original request
under its actor/key/version mechanism.

Each card Update uses the existing versioned atomic whole-order save, and
explicitly warns that other pending edits are saved too. Failed, stale or
ambiguous outcomes retain the mounted draft; ambiguous recovery keeps the
same frozen payload/key. Approval and rejection use their separate existing
version-bound actions. Summary/list/authorized print/CSV/XLSX consumers use
saved totals and canonical header counts. Imports of older exports retain
absent optional values for matching legacy records, but an older
occurrence-shaped export cannot overwrite an already-converted order.

There is no authorized inventory-to-allergen quantity mapping here; available
quantity is therefore Unavailable. No inventory allocation or stock movement
is performed. The existing operational item index uses the canonical header
ordinal and includes every child; historical bottle membership is recoverable
from the encrypted provenance. No SQL migration or bulk rewrite is authored
or applied for this additive encrypted-document change.

Verification was limited to disposable synthetic presentation fixtures of the
real changed editor and saved summary in Chromium at 1440, 768, 390 and 320px;
the editor also used actual doubled computed text sizes (16px to 32px for SUB
labels). Expanded/collapsed cards, multiple children, long names, a clinical
error, dropdown and Update/overall controls were inspected, with no page-wide
overflow. All API responses were synthetic; order mutations and unknown API
requests were denied. This is not evidence of backend persistence,
authorization, imports, prescription verification, approval, concurrency,
retry recovery or operational index behavior. No regression/release runners,
compatibility checks, live order writes, managed restarts, migrations or
deployment workflows were run. API contracts/clients were generated without
the codegen wrapper's broad typecheck step.

## Previous occurrence-rate model (historical documentation only)

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

## Approval status constraint correction (source only)

The application accepts `Approved`, but the original
`0061_immunotherapy_orders` database CHECK `ck_imm_status` omitted it. The
reported existing API logs showed three edit POSTs returning 503. Source tracing
shows that assigning `Approved` reaches `db.flush()`, where a CHECK violation
would be rolled back and translated from `SQLAlchemyError` to a generic 503.
The actual serving database constraint and underlying exception were not queried:
this is a confirmed source defect consistent with the observed 503s, not a
runtime-confirmed diagnosis of each request.

Forward revision `0072_imm_approved_status`, after `0071_order_review_audit`,
atomically replaces only this CHECK. It accepts exactly `Confirmed`, `Approved`,
`In process`, `Shipped`, `Delivered`, `Rejected`, and `Returned`; every prior
valid state remains valid and unsupported states remain excluded. The ORM
declares the same CHECK. Historical migrations remain unchanged. Fresh migration
chains converge on this same constraint. Downgrade refuses to narrow the
constraint rather than rewriting or deleting approved history.

This migration changes no saved rows, prices, snapshots, audit timestamps,
versions, prescription links, bottle IDs, suborder IDs or retry records.
Approval still requires verified patient prescriptions, valid rates, authoritative
permissions and the expected version; PO number remains optional. Order changes,
encrypted snapshots, success audit events and the encrypted request outcome
remain in one transaction.

The mounted unresolved editor must retain its exact frozen payload and UUID.
No unlock, reload, payload normalization change or replacement request identity
is part of this correction. Once the compatible backend/schema is active, the
existing **Recover this same save safely** action can submit that unchanged
request. A prior SQL failure rolls back the order and retry outcome together,
so an absent committed outcome can execute the original request subject to
current authorization, prescription and version checks. A committed outcome is
found under the actor/payload-bound key before mutation work and returns the
current authorized order without another approval, audit event or ID issuance.
Neither a 503 nor an absent response alone proves that nothing committed.

Delivery is source-only under the explicit no-tests restriction. No tests were
added, changed or executed; no builds, validation/release wrappers, browser
checks, runtime probes, live order mutations, service restarts, deployments or
manual migrations were performed. Development source-integrity metadata is
generated offline; this is not runtime validation or activation evidence.
The migration remains unapplied by this work, prepared for the existing
automatic startup/post-merge/deployment lifecycle. The serving schema was not
inspected, and approval success has not been runtime-verified. Do not reload
the unresolved editor as part of activation.

The PostgreSQL fresh-install catalog and production release-review pins remain
at their existing evidenced target. The release metadata generator requires a
reproduced catalog for the new head; obtaining one would violate this task's
no-execution restriction. Do not relabel an old catalog or fabricate a digest,
attestation or passing check. A separately authorized disposable catalog capture
and subsequent release metadata refresh are still required before fresh-install
release verification can claim coverage of this head. Existing release gates
remain fail-closed.

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

## New MR category/Mix grouping

New MR placements (including final submission of older incomplete drafts) now
start directly in `suborder_mrp_v1`. This narrowly supersedes unrestricted
composition for new MR placements only, not Admin creation or saved history.
Authorized bounded allergen references expose `categoryId` and boolean `mix`;
they expose no extra catalogue prices or storage details.

Placement resolves and locks the selected active masters, ignoring client group
identities and eligibility claims. Selection order within each category is
batched into up to three Mix children per SUB; a fourth starts another SUB.
Different category UUIDs never share a SUB, even when display names match.
Every No Mix occurrence is isolated. Existing per-group duplicate constraints
remain: distinct occurrences in different groups are retained, never deduplicated.
Repeated occurrences cannot share a header's child identity key.

Only final placement allocates parent-derived SUB headers (`IT-000001A`, etc.).
Children have no separately issued SUB identity or price. The relational item
index is written from reconstructed membership, not submitted grouping.
Existing version, transaction, idempotency/rejection and draft-submit locks are
unchanged. A lost-response retry keeps its exact request/key; a committed request
recovers the saved order without regrouping against subsequently changed masters
or repeating placement side effects.

Each new grouped header carries the server-owned encrypted
`compositionPolicy: mr_category_mix_v1`; each child retains its authoritative
`groupingBasis` (`categoryId`, `mix`). These are additive saved group data, not
writable request fields, historical allergen snapshot amendments, schema
migrations or backfills. Mere reads do not write or consult current masters.
Retained children keep their basis on edits; added/replaced membership resolves
current eligible master metadata. Applicable edits must still obey category,
three-child and No Mix limits, without silently merging, repacking, inventing,
recycling or renumbering saved headers. Removed headers are not reused.

MR and Admin consume the same saved headers and children. Admin reviews one MRP
per header; existing child extract/dilution, prescription and approval checks
remain mandatory. A grouped order is already canonical and never goes through
the historical per-occurrence conversion. Unmarked historical orders retain
their original prices, occurrences, identities and explicit conversion rules;
missing old metadata is never interpreted as evidence for this policy.
CSV/XLSX imports pass through the same policy and cannot submit grouping evidence.

Source/diff review covered same-category three-plus-one overflow, category
separation, No Mix isolation, duplicate occurrences, draft removal/repacking,
older draft metadata hydration, master changes, saved edits, totals, canonical
review and request/draft retry boundaries. **Runtime behavior is unverified.**
At the user's request no regression/release checks, tests, builds, typechecks,
smoke requests, browser checks, broad validation wrappers, service restarts,
migrations, live data edits or deployments were performed for this change.

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
