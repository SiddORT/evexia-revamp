# Approved order IRNs — save only

Kits & Consumables, SPT, Lupin and Immunotherapy listings offer **Add IRN
number** to the same staff who may approve that family. Kits/Lupin remain
protected Super Admin-only; SPT/Immunotherapy use the existing Edit grant.
MR identities receive neither this capability nor the saved metadata.
Non-approving staff receive no IRN value or actor/time evidence.

The compact **IRN Number** dialog has one required labelled input, Save,
Close and close-icon controls, using the portal's existing modal and theme.
After recording, the row action becomes **View IRN** and the saved-order
summary shows **IRN Number**. The value is read-only, separate from the
server-owned **Invoice number**. No invoice is issued or verified by saving.

## Saved contract and authorization

Each existing `/api/v1/admin/{family}-orders/{record_id}/irn` endpoint accepts
POST with `number`, positive integer `expected_version` and UUID
`idempotencyKey`. The four families are `kits`, `spt`, `lupin`, `immunotherapy`.
The response is the family's normal authorized saved-order projection.

`irn` is optional saved metadata: `number`, server-owned `recordedAt`,
`recordedBy` and `recordVersion`. `irnCanRecord` is a server-derived,
authorization-filtered response capability, never an accepted write field.
Read paths do not save or adopt historical metadata.

The server revalidates approval authority, takes the existing transaction's
policy/identity locks and locks the owning order row. It requires saved
actor/time approval evidence, no rejection, and matching saved/relational
approved lifecycle states: Approved/In process, Shipped or Delivered.
Status alone does not establish approval. Draft, pending, Rejected, Returned,
cancelled or inconsistent orders cannot record an IRN.
Existing approval evidence may remain valid through shipping/delivery.

Text is trimmed identically in the UI and API, then limited to 1–256 Unicode
characters. Controls, formatting controls, unpaired surrogates, line separators
and angle-bracket markup are rejected. Letters, digits, spaces and ordinary
punctuation are permitted; no numeric-only or provider-specific IRN syntax,
cross-order uniqueness rule or external verification is imposed.

## Persistence, conflicts and retry recovery

IRN metadata lives in the owning order's existing encrypted snapshot. No new
table, plaintext search index, ledger or schema migration is needed.
Recording increments the order version once, updates normal actor/time
attribution and writes one metadata-only audit event. IRN text is not copied
into the ordinary audit event.

Each family's existing encrypted, actor/payload-bound request journal records
the operation. Exact retries recover before fresh eligibility/version checks
and return the current saved projection, including the same immutable IRN.
They do not increment the version or repeat the audit event. A fresh request
cannot replace, clear or re-record an existing field, even with identical text.
Access is revalidated before replay as well as the first attempt.

A stale first attempt returns a conflict rather than overwriting another
change. The dialog keeps the draft and offers explicit **Refresh saved order**.
If another actor recorded an IRN, that refresh opens its read-only saved value.
No background refresh replaces mounted dialog drafts.

While saving or recovering an unknown outcome, inputs/Close/Escape and in-app
navigation are blocked; tab close/reload uses the browser's native warning.
The dialog freezes the exact body/key for **Retry unchanged save**. A later
failed retry does not prove the earlier attempt failed. Only a matching saved
order, IRN, actor and recording version confirms success. Account changes
cannot submit or consume the original account's response. List refreshes keep
the dialog mounted; focus returns to the row action, or its listing panel if
background refresh replaced the button.

## Preservation and unchanged boundaries

Normal edit and import snapshot replacement preserves raw saved IRN metadata,
not a redacted transport projection. Those inputs do not accept IRNs. Shipment
and other lifecycle mutations retain the existing snapshot and its IRN.
Transfers exclude IRNs; bulk import/export, search and correction are not
part of this feature. Existing records without IRNs are not rewritten.

Recording does not change invoice authority/references, prices, GST, amounts,
approval evidence, inventory, settlements, credit notes, notifications or
reporting calculations. It does not call an approval, pricing, inventory or
notification writer. Invoice Details, Settings sample templates and procurement
PO/PR documents remain unchanged.

Live sales invoice generation/viewing/printing/download, IRNs on issued
invoices, provider integration, QR codes and tax submission are deferred.

## Delivery evidence and limits

Only source/diff inspection, scoped offline OpenAPI/client source generation
and generated-source formatting were performed. Existing unrelated contract
refinements and generated definitions were retained.
No tests, builds, typechecks, regression/release checks or their wrappers,
completion-validation commands, browser/runtime probes, service starts/restarts,
migrations, live data writes or deployments were run.
Runtime, persistence, concurrency, visual and accessibility behavior remain
unverified. No production activation or historical adoption was performed.
