# Invoice Details and MR invoice templates

## Delivery status: source only

This implementation has been read at source level only. The additive
`0089_invoice_settings` migration, coordinated declaration, migration integrity
metadata, readiness probes and maintenance compatibility are prepared, **not
executed**. The existing automatic-migration classification is retained; it does
not mean any database has been changed during this work.

No tests, regression/release suites, builds, typechecks, verification or
completion-validation commands, browser/runtime probes, managed service starts
or restarts, deployment or live business writes were performed. Offline FastAPI
contract export, direct Orval generation, literal-constant hoisting, source
formatting and scoped preservation of existing generated contracts were used.
The package codegen wrapper was not used because it chains a typecheck.
Persistence, authorization, concurrency, failure recovery, filesystem behavior,
schema activation and rendered accessibility/layout remain unverified at runtime.

## Invoice Details styling handoff

The editor now has a separate, locally scoped stylesheet,
`artifacts/evexia-portal/src/invoiceDetailsSettings.css`. It follows GST Settings:
13px text, 40px minimum single-line controls, 8px radii, 8px/10px control padding
and existing Admin surface, text, border, focus and error tokens. Fieldset,
paragraph, figure, saved-version and history spacing is explicit. Document
renderer styles and sample layouts are unchanged.

Responsive containment was reviewed in source: field grids shrink to their
available Settings column, narrow action rows stack by container width, QR
previews and file choices are bounded, and comparison/history tables scroll
inside their existing labelled, keyboard-focusable regions. Event handlers,
permissions, fields, validation, save/reconciliation, draft guards, private QR
loading and history paging were not changed.

Verification was source/diff review only for the changed page. One screenshot
of the already-running preview at `/admin/settings?tab=invoice-details`, at
390px width, reached the Admin sign-in screen, not an authorized editor.
No sign-in or settings write was attempted. Therefore the actual editor at
320/390, 768, 1024 and 1440px, Classic/Modern light/dark appearances, loaded
history, comparison states and QR dialogs remain **visually unverified**.
No automated tests, regression/release checks, completion-validation commands,
builds, typechecks, migrations, deployments, service starts/restarts or live
business writes were run for this styling work. A release-check process was
already present when inspected; it was not launched or used by this work.

## Scope and access

Settings → Invoice Details is shared durable configuration, restricted on every
API operation to the revalidated protected Super Admin account, role, permission
and session. The category is searchable and hidden from other identities.
Settings → Templates → **MR invoice** is a distinct, ninth browser-local style
preference. Other Admin identities can inspect its fictional styles, but never
fetch or receive shared issuer, statutory, banking, payment, legal or history
values. Backend authorization does not trust the selected Settings tab.

No live invoice, numbering, download, printing, order-row action, payment request,
collection, receipt, tax-policy selection or MR Accounts integration was added.
PO, PR, labels and the existing Immunotherapy documents retain their contracts.
The supplied PDF is a layout reference, not permission to seed its company,
address, legal clauses, bank account, UPI, QR, signature or regulatory marks.

## Configuration and editing

All values start blank and are optional:

- Issuer: company/legal name, multiline address, email, website, customer care.
- Statutory: multiline drug-license numbers, GSTIN and PAN.
- Bank/payment: **separate** bank name and account-holder name, account number,
  branch, IFSC, Payment on contact, UPI ID and optional QR image.
- Legal: declaration and newline-separated, ordered Terms of sale.

Ordinary text fields are limited to 200 characters; address 2,000, drug licenses
1,000, declaration 4,000 and terms 12,000. Text is rendered literally by React,
without HTML interpretation or clickable payment/website links. Clauses are
administrator-authored presentation content, not enforced sale, return,
interest, payment or tax rules. Clearing a value is a recorded change.

Explicit Save/Cancel, field errors, loading, retry and unavailable-storage
messages are provided. Drafts and selected images remain in component memory
only. Navigation/discard uses the existing platform confirmation and draft guard.
Mounted drafts survive same-owner session renewal; a different identity clears
protected state. Cancel/navigation are blocked while the save is unconfirmed.

## Versioning, atomic history and uncertain saves

The latest immutable revision **is** the saved configuration, so there is no
separately committed mutable current row. Each meaningful save creates one
encrypted snapshot with its authenticated actor ID, actor label, timestamp,
version, changed-field before/after strings and old/new QR evidence. A no-op
save returns the current version without a revision; an all-blank absent
configuration remains version zero. Database triggers reject UPDATE, DELETE
and TRUNCATE of history. Readiness retains predecessor probes and requires the
new table shapes and both append-only history triggers.

Writers, reconciliation and staging reclamation share one advisory transaction
lock. Expected-version checks reject stale saves without overwriting. The
editor keeps the draft, loads saved values and displays a comparison before the
administrator explicitly saves again; there is no automatic merge.

Each save has an actor-bound request UUID. A durable pending reservation precedes
any file publication. The final settings revision and committed request result
commit together. Request reuse is matched with encrypted keyed input digests.
A 5xx, network interruption, malformed response or session uncertainty blocks
saving and retains the immutable submission identity in memory.

“Check save outcome” never resubmits. Under the writer lock it returns a
committed result or durably cancels the identity, including an identity that has
not arrived yet. A delayed original submission then cannot commit. Reconciliation
returns the current saved configuration and the original committed version
separately, so a later edit in another session cannot masquerade as this save.
Any retry after a terminal outcome requires explicit review and a new UUID.
Request/cancellation evidence is retained; it is not deleted with a browser tab.

History uses descending version cursors, 10 items per UI page, at most 20 per
API response. Older/newer navigation replaces the current sensitive page rather
than accumulating unlimited plaintext history. Refresh starts from the latest
page; history has no edit/delete actions.

## Sensitive storage and QR lifecycle

Invoice snapshots, history values and request fingerprints use the existing
independent PR AES-GCM keyring with invoice-specific authenticated purposes.
Keep historical PR decryption keys; changing the active key does not re-encrypt
or permit deletion of immutable old evidence. Historical directory/account
encryption field inventories are unchanged.

Only PNG/JPEG raster selections are accepted, up to 512 KiB, a single frame and
32–2048 pixels on each side. MIME, decoding, dimensions and size are validated
server-side; pixels are re-encoded to remove EXIF/comments/trailing content.
The normalized image must also fit 512 KiB. The saved digest and byte size refer
to normalized pixels, not necessarily the selected original bytes. There are no
arbitrary remote image URLs, SVG, HTML, filenames or public image assets.

Normalized image JSON is encrypted before writing to the existing configured
private local/S3-compatible storage adapter. Logical keys use a dedicated
invoice-settings namespace, fixed configuration-owner UUID and owned request
UUID, ending in `.enc`. Only encrypted bytes are stored externally; database
snapshots contain encrypted object references and metadata, never image bytes.
No direct storage URLs or grants are returned. An authenticated configuration/
history-only JSON endpoint returns a specific saved image version, in memory.

Replacement files have a committed reservation before publication. A failed
final transaction leaves a tracked pending intent, never an unowned file.
Explicit reconciliation deletes only its pending file and closes the identity.
On subsequent authorized Invoice Details operations, a bounded pass reclaims up
to 20 pending intents older than 24 hours under the same lock, deleting their
staged files and retaining cancellation tombstones. No background service is
started. If the feature receives no further authorized access, pending files
remain privately tracked until that pass or explicit reconciliation; they are
not treated as committed QR evidence. Committed historical images are never
reclaimed by this process, even after replacement or explicit removal.

Generic audit metadata and application logs contain no invoice field values,
banking history, image bytes or sensitive request property names. Responses are
non-cacheable. The browser does not persist details, drafts, history or QR bytes.
Only the independent style ID preference is stored in localStorage.

## Sample documents

**Modern Professional** is the recommended first default: EVEXIA logo,
restrained teal/slate headings, thin rules, three aligned information panels and
a clear total. **Reference Classic** retains the reference’s bordered section
organization with cleaner typography. Both use a white A4-width portrait canvas,
contained scrollable enlarged previews and explicit sample labels. Long authored
legal content is retained and can extend the scrollable canvas; there is no
live print pagination or export engine.

One immutable saved Invoice Details snapshot supplies issuer, statutory,
bank/payment and legal sections in both cards and the enlarged preview. Reload
is explicit; unsaved editor drafts cannot become the document source.
Unconfigured or unavailable details show guidance, not fallback real data.
Optional blanks are omitted or deliberately shown as “Not set”.

Doctor, patient, invoice/order numbers, dates, products, HSN/batch examples and
amounts are fictional. The sample uses integer-paise illustrative arithmetic,
with matching subtotal, tax, discount, round-off, total and amount in words.
These figures do not define production GST or pricing rules.

The document contains the reference’s branded header, doctor/patient/invoice
panels, finished-products table, financial summary, amount in words, licenses,
bank/PAN/payment/UPI, unsigned signatory, declaration and ordered sale terms.
It has no newly claimed signature or regulatory mark, browser URL, current
print timestamp or browser-page chrome.

Protected bank and UPI **text** may appear, but the document QR is always a
hatched, non-scannable sample placeholder. Actual saved QR bytes are inspectable
only in protected configuration/history, never in either invoice renderer.
“Sample · Not an issued invoice” remains explicit throughout. Defaults follow
existing independent preference subscription, retry and confirmed-reset
conventions; no existing document preference key is changed.
