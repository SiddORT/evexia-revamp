---
name: Orders scope
description: Admin SPT, Kits and Immunotherapy have separate backend authority; preserve unrelated order and portal boundaries.
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

Lupin is also a fictional, frontend-memory-only evaluation workflow. It has a patient count, not a patient registry or individual clinical records. Its attachment picker keeps metadata only, and its filtered CSV must remain local with no backend export or upload.

**Why:** The user explicitly requested a session-only Lupin mock and excluded live masters, processing, persistence and file transfer.

**How to apply:** Preserve this boundary when reusing shared infrastructure: the real download-reporting service is not appropriate for this deliberately offline demo. Adding live data or reporting requires separate requirements.

Admin Kits & Consumables now has separate authorization for shared persisted
supply orders, optional existing Patient references, encrypted historical
contacts and private uploads. This does not expand the SPT/Lupin or MR/Doctor
portal boundaries. Patient is not mandatory, and no clinical history is inferred.

**Why:** The user explicitly requested supply-order persistence while retaining
doctor/MR orders without a Patient and excluding clinical, stock and financial
processing.

**How to apply:** Keep Kits transfers and attachments server-backed. Never
silently migrate fictional session orders, create master records, or require a
Patient solely to give a file an owner.

An order-transfer confirmation is permission to update matching session orders,
not to reconcile divergent patient identity or administration history. Reject
conflicting existing session patients even when order updates are confirmed.

**Why:** A shared patient can affect orders absent from the imported file.
Silently replacing that patient would expand the user's reviewed order changes
and could change dose suggestions without new clinical evidence.

**How to apply:** Keep patient dependencies and order snapshots separate. Import
new explicit patient dependencies atomically with their orders, preserve existing
patient history, and never infer administration from order status.
