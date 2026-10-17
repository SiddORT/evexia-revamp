# Purchase Received server persistence

## Delivery versus activation

This code replaces the live PR routes' browser-local data source. It does not
import, clear, mirror or seed any legacy PR/PO/master browser storage. The legacy
service remains for old isolated consumers and historical tests, not as a live
fallback. Nothing posts inventory, changes PO tax/money, or sends notifications.

`0044_purchase_received` is additive and **operator-only**, descending from
`0043_email_templates`. It follows the independently merged email-template
migration to preserve a single migration head; neither feature is discarded.
No startup table creation or managed migration is
authorized by this delivery. Managed/shared/production migration execution,
independent PR key installation and deployment require separate explicit
approval. The currently pinned predecessor is not changed to auto-activate PR.
The exact successor is recognized by account runtime/readiness only; existing
ciphertext formats, historical inventories and installer/release protections
are not changed. Before activation, PR requests fail with an unavailable state,
not local data.

The operator must provision `PR_ENCRYPTION_KEYS` (a JSON object of distinct key
IDs to base64-encoded 32-byte AES keys) and `PR_ENCRYPTION_KEY_ID` (the active ID).
Use separately generated PR material, not Staff, Directory, Communication,
lookup-index, JWT or session secrets. Retain old PR key IDs as long as any
receipt/history/retry result uses them. There is no automatic rotation or
plaintext fallback. No real PR key is installed by these scripts.

## Persistence and privacy inventory

All descriptive receipt data is stored in one authenticated encrypted payload:
PO number/date and source labels; vendor name/contact/address/GST snapshot;
destination name; explicit receiver mode, staff ID and name or trimmed Other
name; each stable PO-line/product ID, product name, ordered/received/accepted/
rejected quantity, batch, expiry and historical post-balance; creation/update/
deletion timestamps and document source label. The authoritative names come
from the saved server PO and permitted staff lookup, never client labels.

The following operational duplicates remain queryable in plaintext:

| Table | Plaintext fields |
| --- | --- |
| purchase_receipts | receipt UUID, unique PR number, PO/vendor/location/staff FKs, receiver discriminator, received date, status, version, creation/update timestamps |
| purchase_receipt_sources | receipt, source PO-line and product FKs (retained even when a receipt line is removed) |
| purchase_receipt_history | audit-event and receipt FKs |
| purchase_receipt_requests | opaque request UUID, actual actor FK, keyed request digest |
| audit_events | standard successful mutation metadata: actor/session, action, resource type/UUID, outcome, request UUID, time |

Quantities and batch/expiry values are inside the encrypted payload, not separate
plaintext line JSON. No sensitive plaintext audit/history/retry copy is retained.
The full history event and its version snapshot are encrypted, as is the durable
successful retry result. Generic activity contains only typed mutation metadata;
the protected PR Activity endpoint decrypts the actor label and non-sensitive
line-count summary. Neither contains receiver names, batch details or contacts.

AES-256-GCM uses random 96-bit nonces and `v1:key-id:base64` envelopes, bound to
the PR domain, record/event/request UUID and payload purpose through AAD.
Swapping a receipt, history or retry ciphertext fails authentication.
Request fingerprints are HMACs using domain-separated PR key material; retries
can match retained keys after an active-key switch. SQL parameter logging is
refused for PR operations. Existing PO and other domains are **not** newly
encrypted by this work.

Authorized searches decrypt bounded candidates in memory only: at most 2,000
records in a date/PO/vendor scope, at most 2,000 staff or eligible-PO candidates,
and 2,000 history events per selected scope. A larger scope is rejected
explicitly, including exports—never presented as complete. Refine dates/PO
scope; reference selection supports selected-record hydration. Staff choices
contain only ID/name and no contact fields; active, non-deleted staff need no
staff-management permission. Historical unavailable staff can only be retained
on the same saved receipt, not selected afresh. Receiver filters key by staff
identity versus Others, preserving historical name labels.

## Integrity and recovery

Only the protected Super Admin with `admin.access` can read or mutate PRs.
Receiver identity is recorded metadata, separate from the authenticated saving
actor on the authoritative successful audit event.

Review and confirmation derive source snapshots server-side and check a keyed
review token. Mutations serialize on an idempotency advisory lock and then the
transaction-held source PO lock also used by PO edits/deletions. Confirmation
rechecks versions, staff eligibility, dates, batches, exact three-decimal
quantities and accepted balances from active receipts. Rejected units remain
outstanding. Duplicate product rows retain distinct source-line UUIDs.
Fulfillment is based on active accepted quantities: zero accepted means Open,
some accepted means Partially Received, every source line fully accepted means
Closed, independently of the PO's open/deleted lifecycle.

Active receipts block source edit/delete in backend and UI. Deleted receipt
history retains source-line FKs: removed PO lines are archived at negative
positions rather than physically removed, and excluded from current PO
projections. PO money/tax snapshots are otherwise untouched.

Edits have fixed source and expected version. Current capacity excludes the
edited receipt's own acceptance. Historical received quantities can be retained
or reduced after later receipts; increased receiving cannot exceed current
capacity. Saved post-balances are not rewritten by later mutations. An edit
uses its own historical pre-balance; if absent, or no longer representable,
post-balance remains unavailable rather than reconstructed.

Browser retry storage contains only account UUID, request UUID, operation and
optional receipt UUID. Sensitive drafts/reviews remain in mounted memory, not
local/session storage. Validation/request/session renewal errors retain that
draft. Source/list/reference requests reject stale responses. While a save is
unresolved, editing/source/navigation are blocked. After reload, reconcile the
opaque request against the server before starting another action. Reconciliation
takes the mutation's advisory lock; an absent request receives a cancellation
tombstone so a late original request cannot commit after “not committed” was
reported. The user can then explicitly re-review the kept draft/new draft.

Previews and on-device PDFs use the same saved snapshot and explicit current
Admin display-preference snapshot, never current master labels or reconstructed
balances. CSV enumerates all filtered matches or fails the explicit scope
limit; dates remain canonical and formula-looking cells are escaped.

## Verification boundary

`sh scripts/test-purchase-received-crud.sh` creates a private socket-only
PostgreSQL database, supplies synthetic independent keys, migrates that
disposable database, and runs **only**
`tests/test_purchase_received_crud.py`. Cases cover staff/Others create,
detail/list, edits and soft deletion, essential validation, FK/name snapshots,
encryption including history/retries, unavailable keys, resulting accepted
balances and request reconciliation. It does not activate managed persistence.

`sh scripts/start-pr-crud-preview.sh` is an optional private synthetic fixture
for a single narrow authenticated browser CRUD smoke. It never runs suites or
uses the configured database; terminate the fixture to delete its database.
No regression suites, release checks, development compatibility checks,
cross-browser/layout matrices, or standalone export/document/analytics/
concurrency tests are part of this task's verification.

### Actual delivery verification

- Focused disposable API run: **2 passed**, one existing Starlette TestClient
  deprecation warning, 4.34 seconds. An earlier attempt exposed the explicit
  account-revision compatibility requirement; the additive successor was then
  named without changing account encryption or accepting arbitrary revisions.
- One Chromium authenticated UI CRUD smoke passed: Others required-name
  validation, create/review/confirm, persisted detail after reload, listing,
  versioned name/batch edit, soft deletion, retained deleted detail and restored
  source acceptance capacity. No application runtime errors were observed.
  The optional second-browser-context check was not run.
- OpenAPI generation, generated-library TypeScript checking and direct portal
  Vite compilation passed. Vite reported its existing large-chunk advisory.
  Small subsequent paging/recovery changes received targeted JSX/Python syntax
  checks, not another browser or regression run.
- The managed preview API was already blocked at its startup protection; the
  public screenshot showed portal lookup unavailable. The web workflow itself
  starts cleanly. Managed persistence was not activated or claimed verified.
  Existing configured release-workflow logs were not rerun as part of this work.
- After integrating the email-template changes, PR was renumbered to
  `0044_purchase_received` after `0043_email_templates`. The migration graph has
  one head and both migrations remain operator-only. The regenerated API
  contract retains every path and schema from both sides. The same two focused
  disposable PR CRUD cases passed again (5.54 seconds, one existing deprecation
  warning); no additional browser, regression or release tests were run.
