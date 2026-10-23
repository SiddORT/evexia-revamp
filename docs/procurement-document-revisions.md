# Saved Purchase Order and Purchase Received documents

## Source-only delivery

This implementation has **not been verified by executing tests or runtime
scenarios**. No automated tests, type checks, builds, browser/manual scenarios,
smoke requests, release checks, service restarts, migrations, seeding, pushes or
deployments were performed for this delivery, as explicitly requested.

The FastAPI contract export, Orval source generation, literal-constant hoisting,
generated-source formatting and development schema metadata refresh were used
only to produce implementation files. The usual `codegen` wrapper was not used
because it also executes type checking. Generated source and metadata are not
evidence that the app, migration, PDF rendering or accessibility works.

## Mutation and storage contract

New PO and PR create/edit requests must include `documentContext` when reviewed.
It contains only the supported template identity, schema/renderer version and
validated date presentation (including the browser's resolved IANA time zone).
These values participate in the review token and durable retry digest. Actors,
timestamps, business values, prices, totals, tax components, vendors and receipt
balances are server-derived. The confirmed request reuses its captured context,
not subsequently changed Settings or browser preferences.

Every successful create/edit transaction appends one encrypted canonical document
to `procurement_documents`, linked to the existing authenticated audit event and
record version. It is an archived render model, not a PDF blob. The mutation,
document, audit evidence, inventory work (for PR) and retry result commit or roll
back together. Matching retries return the committed result without appending.
Rejected/stale requests create no document. PO line identities and the existing
PR inventory-before-PO lock order are unchanged.

Saved responses carry `documentRevision`; the same reference is retained in
durable retry/reconciliation results. Legacy retry responses without that field
remain recoverable and do not imply that a historical document exists.

PO before/after evidence is encrypted in the existing PO audit metadata. PR
continues to use its existing encrypted event ledger, with a trustworthy
pre-mutation snapshot included in new events; no second PR event ledger exists.
Archived documents and new PO evidence use the existing procurement/PR AES-GCM
keyring with distinct authenticated fields. Keep old procurement decryption keys
while any receipt, retry, history or document still needs them. These documents
are not covered by the separate directory/account rotation tools. The document
table rejects UPDATE/DELETE through its database trigger; any future re-encryption
procedure needs a specifically reviewed maintenance design, not an ordinary
application edit.

Document revision identifiers follow record versions. An existing legacy record
can therefore have its first archived document at a revision greater than one.
The current document is the highest archived document revision, **not** simply
the record's current version: deletion increments lifecycle version but does not
generate or rewrite a document.

## Defaults, frozen values and rendering

PO and PR template defaults remain independent, browser-local Settings. There is
no shared/global default administration. Each reviewed save captures its own
default once. Preference errors block that review; explicit Retry or a confirmed,
document-specific Reset recovers without unmounting the draft. Background storage
events do not silently dismiss the error.

Preview and PDF consume the same archived model, layout and date snapshot.
They do not consult current vendor/product masters, current preferences or later
receipt balances. PO amounts and GST components are the server's saved integer
paise, not the old browser invoice arithmetic. Supplementary vendor information
is retained from the preceding archive for the same vendor; first-time evidence
is captured for the new save, not attributed to an older document. The server
catalogue currently has no authoritative HSN field, so it is shown as unrecorded,
not borrowed from browser-local samples.

PR stays a quantity-based receipt with its saved receiver, batch, expiry and
historical post-receipt balance. It is **not** a financial/tax invoice. Missing or
unrepresentable historical balances remain unavailable.

`schemaVersion` and `rendererVersion` currently support version 1. Unknown
versions fail visibly and do not cause another business save. Future renderer
changes must preserve rendering for archived version 1 or introduce a separately
versioned compatible implementation; never reinterpret old canonical values or
silently substitute a new layout.

Each archived SVG/PDF page carries its revision and either `Current` or
`Superseded — not the latest version`, together with the latest revision number.
The accessible preview carries the same status. Filenames distinguish revisions
and current/superseded downloads. Download initiation refreshes status; a change
detected during PDF preparation blocks handoff and asks the user to retry. This
retains existing authenticated download logging and identity checks. Searchable
PR PDFs and the explicit image-only alternative are retained.

Status reflects the latest revision known when the app prepares/releases the
document. A subsequent save can supersede a document already downloaded or held
outside the app. **Previously downloaded files cannot be retroactively changed.**
Reopen/re-download through the app to obtain its current lifecycle label.

## Actions, history and legacy evidence

Saved PO/PR listing Actions and detail pages provide View document, Download PDF
and Changes history. Each read uses existing authenticated Admin authorization.
History pages are bounded (10 rows by default, maximum 50 on the API), oldest
first, and use the existing server audit events. The right-side native dialog
drawer returns focus on close, supports Escape, reports loading/errors and
isolates obsolete responses. Users can inspect field changes, added/removed/
modified/reordered lines, authenticated editor and timestamp, and open/download
known before/after documents. The PR recorded receiver is not presented as the
authenticated editor.

Existing PO audit actors/summaries and known PR event snapshots are retained.
No migration invents old invoices, historical template choices, exact layouts,
actors or prior values. Older PR snapshots can establish values, not their
original document layout. Unavailable evidence and documents are explicitly
labelled; simply reading legacy history never creates a revision. A successful
business save is not reported as unsaved because a later document read/render
fails; retry the document action, not a replacement business edit.

## Migration and activation

`0064_procurement_documents` is an additive successor to `0063_spt_orders`.
It adds the immutable encrypted document table, its constraints/indexes and
nullable encrypted PO audit evidence. It does not backfill documents or touch
stock-posting rules. The coordinated development declaration, schema constant,
automatic migration policy, source-integrity metadata and inherited
account/directory readiness boundaries are prepared.

**The migration has not been executed.** The new mutation/read paths require
the coordinated schema and procurement keys. Normal authorized activation must
apply this migration before using the feature. Source completion does not
authorize a service restart, live migration or deployment in this task.
