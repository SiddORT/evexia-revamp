---
name: Orders scope
description: Independent order and portal authority, including Lupin's patient-count-versus-link rule.
---

Admin Immunotherapy now has explicit user authorization for authenticated backend orders, real master references, historical snapshots, private prescription uploads and server-validated transfers. This supersedes its earlier session-only boundary, but does not expand any other order type or portal.

**Why:** The user explicitly requested the Admin Immunotherapy backend conversion after the earlier mock-only work, while retaining separate scope for SPT, Kits, Lupin, procurement and Doctor/MR portals.

**How to apply:** Keep Immunotherapy clinical semantics limited to explicitly chosen order dosage/results/composition. Never infer administration from order status or add treatment administration, stock, payment, or other portal processing without new requirements.

The Doctor portal preview and the Admin immunotherapy order UI are separate workflows. An immunotherapy-branded hostname assigned to Doctor must still open the existing Doctor preview, not Admin order entry.

**Why:** The user explicitly separated hostname-based Doctor entry from the independently developing Admin immunotherapy workflow.

**How to apply:** Do not infer a new Doctor treatment or post-login route from the hostname's branding. Changes to Doctor authentication or workflows need separate requirements.

Admin SPT now has explicit authorization for authenticated persistent orders,
real Doctor/MR and existing Patient references, encrypted historical snapshots,
SPT-owned patient registrations and server-reviewed transfers. This supersedes
its earlier session-only restriction, but does not expand other order types or
MR/Doctor portal permissions.

**Why:** The user explicitly requested the Admin SPT backend conversion and
excluded Patient Master creation, account provisioning, treatment, payments
and fulfilment.

**How to apply:** Keep minimal SPT registration independent of Patient Master
and login identity. Saved is a submitted pending state, never evidence of
approval, payment or treatment; do not silently migrate fictional fixtures.

Admin Lupin now has explicit authorization for protected backend persistence,
real Doctor/MR references, optional existing Patient links, encrypted historical
identities, private attachments and server-reviewed transfers. This supersedes
its earlier mock-only boundary without expanding other portals or order types.
The manually entered patient count is independent of the optional Patient list:
zero links is valid for a positive count, and links must never calculate,
restrict or replace it. Never invent Patient records from a count.

**Why:** The user explicitly requested this Lupin backend conversion and
clarified that only count × per-test price determines pricing.

**How to apply:** Preserve the separation in create, review, filters and
transfers. Do not add master creation, medical history, financial or inventory
processing, or Doctor/MR portal grants without separate requirements.

Admin Kits & Consumables now has separate authorization for shared persisted
supply orders, optional existing Patient references, encrypted historical
contacts and private uploads. This does not expand other order or MR/Doctor
portal boundaries. Patient is not mandatory, and no clinical history is inferred.

**Why:** The user explicitly requested supply-order persistence while retaining
doctor/MR orders without a Patient and excluding clinical, stock and financial
processing.

**How to apply:** Keep Kits transfers and attachments server-backed. Never
silently migrate fictional session orders, create master records, or require a
Patient solely to give a file an owner.

Earlier Admin-only SPT/Lupin portal exclusions are superseded by the user's
explicit MR workflow authorization. Current portal scope is documented in
`docs/mr-order-workflows.md`; do not reinstate the old Lupin Admin-only gate.

**Why:** The user explicitly authorized MR SPT and Lupin alongside the existing
MR order types, without authorizing Doctor access or generic master administration.

**How to apply:** Treat historical membership and reusable SPT registration
ownership as distinct permissions. An Admin-created registration's snapshot
on an assigned MR order is reviewable, but that historical assignment must not
make the underlying registration globally selectable or reusable on new orders.

The user explicitly approved adding Admin approval to Kits and SPT so owning
MRs can edit all four sales-order types until approval. Submission is not
approval; payment and fulfilment are not substitutes for approval evidence.
Do not infer missing historical decisions or reopen terminal records.

Approval is a decision/history fact and advances a pending order directly to
In process, not a separate current Approved state. SPT Draft/Saved remain
pre-approval states. Kits, SPT and Lupin approval requires saved valid pricing;
rejection is separate and does not require pricing or a mandatory reason.
Kits decisions retain protected Super Admin authority.

**Why:** The user explicitly requested these decision semantics and priced-order
actions without expanding fulfilment transitions or staff permissions.

**How to apply:** Preserve existing approval meanings and actor-owned evidence.
Kits retains protected financial authority; pending MR edits must not erase
Admin-owned data merely to become editable.

Hiding MR Doctor creation and Doctor/order transfer controls is presentation
scope only, not revocation of the underlying routes or backend permissions.
Admin controls and MR Add Order remain independently available.

**Why:** The user explicitly requested a navigation/UI refinement, excluding
permission changes and workflow removal.

**How to apply:** Do not infer that a hidden MR listing action authorizes
deleting its route or changing server ownership and permission rules.

An order-transfer confirmation is permission to update matching session orders,
not to reconcile divergent patient identity or administration history. Reject
conflicting existing session patients even when order updates are confirmed.

**Why:** A shared patient can affect orders absent from the imported file.
Silently replacing that patient would expand the user's reviewed order changes
and could change dose suggestions without new clinical evidence.

**How to apply:** Keep patient dependencies and order snapshots separate. Import
new explicit patient dependencies atomically with their orders, preserve existing
patient history, and never infer administration from order status.
