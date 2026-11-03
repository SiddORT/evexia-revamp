# Explicit order drafts

MR uses the existing Admin order editors under its own route/context, not a
second implementation. New Immunotherapy, Kits & Consumables and Lupin editors
offer **Save as Draft** separately from **Submit order**. The existing SPT
editor retains its durable Draft/Saved contract and now labels final submission
explicitly. Editing an already submitted order never offers conversion to a
draft.

## Storage and authorization

The additive `0082_order_drafts` migration introduces creator-private entry
documents, attachment associations and encrypted save-request receipts. No
historical submitted orders or existing SPT drafts are rewritten.

Every new-document endpoint revalidates the authenticated identity and the
existing order type's `add` permission under the normal policy/financial locks.
Reads, lists, saves and submission require the same immutable creator and
MR scope. Super Admin permission is not draft sharing/reassignment permission.
MRs cannot choose another MR, use foreign patient/file references or access
another creator's draft through an internal UUID. Staff permission changes
also apply to saved drafts and private file access.

Entry payloads allow unfinished text and empty selections. They still enforce
known field/container shapes, currently authorized selected references, a
256-KiB JSON payload limit, nesting/collection/string limits, ten verified
attachment references and bounded patient/allergen rows. A draft is not a
relaxed clinical-order schema.

Payloads, submission fingerprints and retry snapshots use directory-key AES-GCM
envelopes with distinct `entry_drafts` and `draft_requests` associated-data
domains. Internal UUIDs, ownership, versions and timestamps remain operational
metadata. The directory-key rotation inventory includes both new encrypted
tables at this head and all inherited order/settlement/notification domains;
historical rotation inventories are not changed.

## Explicit saves and conflicts

Each draft may be independently resumed from its order listing. Lists are
bounded/paginated and show server saved timestamps. Successful saves update
the editor's resume URL, so reload and later login read the same server
document. There is no autosave or browser-local persistence.

Save requests retain an exact encrypted idempotency receipt. Expected versions,
row locks and per-request/draft serialization reject stale tabs without
overwriting newer drafts. An uncertain save keeps its original key/body and
locks editing/final submission until the same save is confirmed. Failures keep
the working entries in the mounted editor; success/unknown states are announced
accessibly. New edits after a saved snapshot are explicitly marked unsaved.

Draft saves are confirmed against the draft ID, kind, positive integer version,
readable saved timestamp and editor payload shape, not Purchase Order numbering
or lines. Submission responses use the corresponding normal Immunotherapy,
Kits or Lupin order validator, including the Kits create UUID safeguard.
Malformed successes remain uncertain. Explicit retries retain the original
draft ID, authenticated owner, payload, expected version and request key; only a
valid confirmed response clears the draft-save lock and updates the resume URL.

The response-validation correction was source-only: no checks, builds, browser
or manual probes, service starts/restarts, migrations or deployments were run.
Runtime success and recovery of any particular user's draft remain unverified.
Previously reported release-log failures are separate, unverified blockers;
this correction neither repairs them nor establishes release readiness.

SPT retains the same records, source IDs, transfer contract and existing legacy
numbers. Newly created SPT drafts use an internal `DRAFT-<UUID>` reference rather
than incrementing the submitted-order sequence; the first final save allocates
their normal SPT number. Previously numbered SPT drafts keep their number,
including on submission. Draft amounts remain editable, but submitted MR
pricing restrictions remain unchanged. Default SPT listing/counts exclude
drafts; the explicit Drafts view and existing draft-capable transfers retain
them. Its saved timestamp is exposed without exposing staff audit identities.

## Private files

Only already verified, clean-scanned, supported document uploads owned by the
creator can be associated with a new draft. Immunotherapy files must belong to
the selected patient; Kits and Lupin uploads retain their existing owner/type
boundaries. File objects, pending/failed selections and unverified filenames
are never serialized as successful saved uploads.

Retained files cannot be deleted/replaced/cancelled as unattached uploads,
including Lupin's cancellation-tombstone path. Normal order create/edit/import
cannot steal a file retained by another draft. Draft submission is the only
authorized handoff of those associations into the submitted order. Removing a
file from the form changes retention only after an explicit successful draft
save. Existing private read/download permission and scanner checks still apply.

## Final submission

Submission uses each type's strict existing write schema and authoritative
creation service. It rechecks current identities, references/relationships,
verified files, prices, business rules and MR financial eligibility. SPT
Draft-to-Saved also resolves current selected people instead of treating draft
snapshots as protected submitted history. The ordinary MR eligibility/advisory
review is retained in the browser.

The normal order creation, numbering, notification intent, draft's resulting
order reference and removal of its attachment-retention links commit together.
An exact retry of a consumed draft reads the resulting normal order; a different
attempt, stale version or resumed consumed draft is rejected. A rejected
submission leaves the saved draft unchanged. Immunotherapy's existing terminal
rejection/reconciliation header remains recognized on the draft endpoint.

New entry documents have no operational order status or business/SUB number.
Existing review, shipment, settlement, exposure, reporting and Doctor history
consumers continue to read only their existing submitted-order sources. Draft
saves never enqueue placement notifications. SPT's existing exclusion from
clinical histories, review, financial eligibility and placement notifications
is retained.

## Delivery and verification limits

This implementation is source-only at the user's request. No regression/release
checks, automatic check suites, builds, service restarts/activation, migrations,
browser tests, notification sends or business-data mutations were run.
OpenAPI, generated TypeScript/Zod clients, and the coordinated development
schema/source-integrity metadata were regenerated using generation-only entry
points. Those operations are not runtime verification.

The migration has **not** been applied here, and save/resume, concurrency,
rollback, private-file handling and SPT compatibility have **not** been exercised.
Production fresh-install catalog/release evidence stays at its last actually
verified target; no catalog digest or passing release evidence was fabricated.
The existing automatic migration policy remains unchanged for an authorized
future activation, but this delivery does not authorize activation/deployment.
