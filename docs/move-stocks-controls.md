# Move stocks controls and receipt-initialization prerequisite

## Listing and entry form

The listing uses the existing master toolbar and collapsible filter controls:
Refresh records, Search, and right-aligned Reset filters. Source, Destination
and multi-select Allergens combine with search on the server before pagination.
Reset clears all four criteria and returns to page one. Refresh retains them;
closing the disclosure does not clear them. Pagination counts remain visible.
The permanent committed-movement notice and matching-movements/lot-lines banner
are removed, not the append-only or exact-quantity rules.

Filter choices come from saved movements, not active-only catalogues. They
remain searchable and paged after catalogue renames, inactivation or deletion.
Location and allergen matching uses stable IDs; Unallocated explicitly matches
a NULL source, not an omitted source filter. Multiple allergens use any-selected
matching, combined with both location filters and search.

Assembly allergen matching uses the recipe snapshot retained on the moved lot.
Finished-product openings without a saved recipe do not acquire members from
today's catalogue. Unfiltered listings continue to include these movements.
Existing bounded encrypted scans fail explicitly rather than return partial
results when their scope is exceeded.

Only the entry form's Source and Destination result-count hints are hidden.
Their choice search, loading, retry and paging controls remain. Delivered by
uses the existing accessible info disclosure with the unchanged attribution
explanation. Draft, review, exact quantities and reconciliation rules remain.

## Read-only diagnosis

A read-only transaction against the **current workspace database**, using the
existing inventory coverage calculation and aggregate receipt/state counts,
reported:

- Server receipts: **1**
- Receipt initialization states: **0**
- Receipts missing a state: **1**
- Receipts with stale state versions: **0**
- Global pending receipts: **1**, complete: **false**

No receipt identifiers, content, tokens, connection details or keys are included
here. This establishes genuine missing initialization in the inspected
workspace, not the identity/state of the screenshot's database or production.
There is no evidence that the completeness guard incorrectly rejected this
database. No initialization, migration, data write, restoration or operator
attestation was performed.

The form recognizes `inventory_uninitialized` by its error code. It explains
the administrator/operator prerequisite instead of offering Retry as a fix.
Review and commit stay blocked and stale displayed balances are unavailable.
Mounted draft selections and quantities remain intact; keep the page open.
After the operator completes the work, Check initialization status reloads
balances through the guarded read endpoint. Ordinary transient errors retain
retry, and unknown save outcomes still require reconciliation.

## Controlled recovery remains a separate operation

An administrator must arrange an independently authorized operator review:

1. Use the protected read-only inventory initialization report to review
   eligibility and reconciliation privately, not just the aggregate counts.
2. Follow the controlled procedure in [Live inventory](live-inventory.md),
   using `scripts/initialize-inventory.py` only on its explicitly supported,
   independently confirmed development target and reviewed schema revision.
   Do not relax its revision or identity guards to make a report run.
3. Obtain separate approval, stop writers, and establish the required private
   backup, restoration/content evidence and independent key-recovery evidence
   before any reviewed initialization. Flags attest to evidence; they do not
   create it.
4. Retain private review/commit reports and continue controlled batches until
   global pending receipts reach zero. Recheck coverage before using inventory.

The UI cannot initialize receipts, and repeatedly refreshing cannot replace
this procedure. A schema mismatch, unavailable candidate or failed
reconciliation needs operator investigation, not partial/fabricated balances.

## Verification boundary

No tests or test files were added or modified, and no test commands were
launched for this work. Preconfigured release-check workflows were discovered
already running and stopped; this is not a claim that the environment ran no
checks. The API contract and generated clients/validators were synchronized
without invoking the codegen script's chained typecheck or any test suite.
The unauthenticated preview rendered the sign-in page, not the protected
Move stocks screens. Authenticated browser scenarios were not run.

The managed API was not restarted: its startup invokes automatic database
synchronization, prohibited by this task. Post-merge runtime alignment and
actual controlled receipt initialization are not established by these edits.
