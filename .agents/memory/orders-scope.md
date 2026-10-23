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
and login identity. Saved is an immutable order status, never evidence of
payment or treatment; do not silently migrate fictional fixtures.

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

Shared order/reference/file infrastructure may legitimately support MR access
for other workflows. Reusing it does not authorize MR access to Lupin.

**Why:** The Lupin request explicitly excludes expansion of MR/Doctor grants;
authorization must not broaden indirectly when shared helpers gain MR support.

**How to apply:** Keep an explicit protected-Admin gate before shared reference
scope initialization, and keep Lupin private-file authorization independent
of saved-order access allowed for other order domains.

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

MR Immunotherapy and Kits & Consumables now have explicit authorization to reuse
their corresponding live Admin workflows, with the authenticated MR fixed and
all reads/mutations/transfers/files scoped to that MR. This supersedes the
earlier exclusion of these two types from the MR portal, not other workflows.

**Why:** The user requested these two saved workflows in the existing MR shell,
including Admin-entered assigned orders, while keeping Dashboard, Targets and
Payments fictional and SPT/Lupin backend work independent.

**How to apply:** Preserve historical order snapshots and narrow owned-Doctor
Patient registration. Do not infer broad Patient administration, cross-MR
reassignment, live financial/stock processing or other portal activation.

An order-transfer confirmation is permission to update matching session orders,
not to reconcile divergent patient identity or administration history. Reject
conflicting existing session patients even when order updates are confirmed.

**Why:** A shared patient can affect orders absent from the imported file.
Silently replacing that patient would expand the user's reviewed order changes
and could change dose suggestions without new clinical evidence.

**How to apply:** Keep patient dependencies and order snapshots separate. Import
new explicit patient dependencies atomically with their orders, preserve existing
patient history, and never infer administration from order status.
