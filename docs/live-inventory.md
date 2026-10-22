# Live Stock Inventory — merge handoff

Opening Stock extends this same ledger with opening-source allergen and
finished-product lots and a genuine Unallocated bucket. Its append-only,
allocation, import/retry, exact-rate and successor-migration contracts are in
[`opening-stock.md`](opening-stock.md). Older implementation observations below
are historical, not evidence of the new successor's runtime activation.

## Current supported receipt initialization: reviewed release 0054

The development receipt initializer is explicitly reviewed for **exactly
`0054_modern_email_tests`**. It no longer accepts `0053_email_invitations` or
the original `0046_live_inventory` release. No older, multiple-head, or unknown
future revision is accepted, even if a future release manifest is updated.
The initializer never migrates, stamps, starts/stops services or restores backups.

Compatibility review: `0054` follows `0053_email_invitations` and changes
`email_templates` constraints/seed content and `email_attempts` constraints/
template foreign-key retention only. It does not change receipt ciphertext or
versioning, PO-line provenance, inventory lots/ledger/state, the shared inventory
lock, or the protected ownership anchor. The current
`app/services/inventory.py` still validates retained receipt/line/location
evidence, checks the keyed review token, reconciles ledger quantities, and makes
already-current receipts safe to resume. Opening Stock and stock-enabled
products remain separate sources; initializing receipts does not rebuild their
stock or infer historical recipes.

The checked-in `scripts/development-schema-review.json` already reviews `0054`;
its checksums and migration policy are unchanged by this tooling update.
Before connecting, the initializer requires its fixed revision to match that
review, `development-contract.json`, and the API source revision. It checks the
complete migration inventory by declared revision ID and checksum, including
historical files with nonmatching filenames. A missing, added or modified
migration blocks execution. Each database transaction independently checks the
actual target identity and exact single database revision.

**Source/tooling support is not execution approval or live acceptance.** This
update performs no database initialization, migration, service restart, recovery
execution, or live alignment verification. An authorized operator must obtain
separate approval for the exact target and batch, independently confirmed
workspace/network/database identity, stopped writers, a current privately
restored backup, and recoverable keys. Use the
[controlled procedure below](#controlled-receipt-initialization-operator-procedure).
Do not execute the historical activation commands retained below.

<details>
<summary>Historical initial merge handoff — not current operator instructions</summary>

## Original handoff: automatic migration, final acceptance after merge

The latest main-workspace source has been integrated. Inventory is the single
`0046_live_inventory` successor to accepted `0045_pr_batch_numbers`, using main's
version-2 default-automatic policy, startup and post-merge lifecycle. No historical
migration or encryption inventory was changed. Main's existing fresh-install
review evidence remains pinned and is not presented as inventory evidence.
The redundant inventory-only manual schema activation runner has been removed.

The current task handoff explicitly makes original-development live acceptance
**post-merge**, not a requirement to migrate the original target from a fork
before submitting source. Ready for merge does **not** mean live acceptance.
The main workspace owns automatic activation, restart and the checks below.

Main independently reported original target `heliumdb`, cluster
`7689828272860483604`, OID `16384`, at `0045_pr_batch_numbers`, all three batch
tables and their expected initial Manual marker, readiness 200 and matching
API/frontend source `f6054e246de3a2c632b379ba1ecd5987e0159d1bff8471ff9a6bb8b8d1ea53bb`.
These are main-reported **predecessor** observations, not inventory acceptance
and not observations made from this fork.

After merge, automatically apply only the successor to the verified original
target and restart managed owners. Re-read actual `alembic_version` after commit.
Routed `/api/v1/version`, `/api/v1/health/readiness` and
`/__development-release` must show database/API/frontend agreement on
**`0046_live_inventory`**, matching source identity, and readiness 200. Then
review/initialize existing receipts with the bounded procedure below and retain
reconciliation/coverage evidence. Never stamp, bypass fork identity, weaken real
key/historical guards, or claim source-only agreement as live success.

**Pending and unverified:** original-development activation, live UI/save flows,
reviewed receipt initialization and final three-way alignment. The fork's earlier
`0044`/API-502 observations below are historical, not the current original target.
No original database migration or receipt initialization was run from this task.

</details>

<details>
<summary>Historical pre-handoff observations — superseded, not current activation instructions</summary>

## Status and evidence

The source successor is **`0046_live_inventory`**, immediately after accepted
`0045_pr_batch_numbers`, which remains immediately after `0044_purchase_received`.
No predecessor migration, batch allocation rule, historical crypto inventory,
production pin or protected approval was changed.

**This feature is not activated and is not fully complete.** A read-only
development database observation in this workspace returned
**`0044_purchase_received`**, including a fresh read after the approved source
handoff/restart attempt. `/api/v1/version` and `/api/v1/health/readiness` return
**HTTP 502**. After frontend restart, routed `/__development-release` returns
**HTTP 200**, explicitly serving **`0046_live_inventory`**. There is no running
backend identity/readiness evidence and no three-way matching live revision.

### Latest policy update: automatic-migration source is not in this fork

The user reports that all migrations have been made automatic and requested
continuation. This fork still contains the previous synchronizer and
`operator_only` classifications for both pending successors. A fresh permitted
database revision observation returned `0044_purchase_received`; the managed
backend restart again returned `OPERATOR_MIGRATION_REQUIRED`, ordered pending
`[0045_pr_batch_numbers,0046_live_inventory]`, and `migrations_applied: 0`.

The available main-workspace tracking snapshot also predates the reported
automatic-migration change. Fetching the newer main-workspace source was denied.
The intended automatic implementation must be synchronized or supplied as a
patch before continuing. No replacement migration policy was invented here,
no guard was bypassed, and no new tests were run. Earlier operator-only
instructions below describe the still-present implementation, not a rejection
of the user's new policy. Live three-way alignment remains a completion blocker.

### Latest operator attempt: original-workspace guard blocked

The user independently confirmed the documented original target and private
recovery custody of every current encryption/signing key. A private target JSON
was then created from those **user-confirmed literal values**, not from the
connection/environment. Managed API/frontend writers were stopped; process
ownership observation found no running API worker. The existing release owners
were already stopped/finished and were not invoked.

The scoped operator command returned:

```
ACTIVATION_BLOCKED: Original development workspace required; cloned targets need separate authorization/tooling
```

This task runtime is a fork, not the independently approved original workspace.
The command stopped **before database connection, backup creation, App Storage
access, restoration, migration or initialization**. No approval/identity guard
was changed. A subsequent permitted read-only database observation still returned
**`0044_purchase_received`**. The frontend owner was restarted to restore the
preview; the API remains stopped at its protected successor gate.

**Next action:** an authorized operator must run the documented fixed-path
command, with these reviewed source changes available, from the confirmed original
development workspace. Its independent target/key confirmations remain required,
and the command must establish a new full private archive and actual restoration
evidence there before live DDL. Then restart the managed owners, prove the exact
three-way `0046` agreement and review/initialize existing receipts. The fork's
copied host/database names or predecessor revision do not authorize it as a
replacement target. Do not replace the pinned workspace ID with the runtime ID.
The task remains **not fully complete**.

The user separately authorized the gated handoff, source-review generation and
managed restarts. The established
`python3 -B scripts/review-development-schema.py --refresh` operation now passes
`DEVELOPMENT_SCHEMA_CONSISTENT: source only; no activation authorization`.
The canonical declaration, generated application constant and development review
name `0046_live_inventory`. No manifest checksums were hand-edited.
Production/fresh-install evidence and operator-only classifications are unchanged.

The managed API command invokes `scripts/development-sync.py` before Uvicorn.
The authorized API restart stopped at its existing protection:
`OPERATOR_MIGRATION_REQUIRED`, current `0044`, pending/operator-only `[0045,0046]`,
**migrations_applied: 0**. The frontend owner restarted successfully. No startup
command was changed to bypass the gate and no replacement listener was started.
The static public screenshot shows portal lookup unavailable because the API
is down; it does not verify either authenticated inventory page.

The existing release workflows were observed already running in the environment
and were stopped. They were not invoked as this task's verification, and none of
their output is counted as inventory evidence.

</details>

## Focused CRUD evidence and unverified behavior

Focused synthetic CRUD only:

```
sh scripts/test-inventory-crud.sh
```

Latest result: **7 passed**, including the two directly affected receipt CRUD
cases. The runner creates a disposable private-socket PostgreSQL database and
synthetic independent keys, explicitly names only
`tests/test_inventory_crud.py` and `tests/test_purchase_received_crud.py`, and
does not inherit a managed database or use fixture caching. The one reported
warning is Starlette's existing TestClient/httpx deprecation.

These cases cover receipt create/read/edit/soft-delete posting, exact
three-place quantities, distinct same-batch provenance, movement creation/read,
snapshot retention, minimal Staff choices, denied/invalid creates, duplicate
requests, absent-request cancellation, stale reviews, attempted edit/delete of
committed moves, rejection of receipt changes that overdraw transferred stock,
reviewed historical-receipt initialization, exactly-once reruns and unavailable
initialization evidence. They are not live activation or broad behavior tests.

The FastAPI contract and clients were regenerated with the exporter, direct
Orval generation and generated-constant hoisting only. The package's `codegen`
wrapper was not used because it also runs a typecheck.

**Unverified:** inventory browser layout, keyboard/focus/escape, text enlargement,
cross-browser behavior, session-renewal draft retention, real downloads/print,
multi-browser freshness, concurrent committed writers, actual operator CLI
execution/recovery, key rotation and managed schema activation. No build,
typecheck, release, validation, regression, default harness or browser automation
was invoked for this task. No concurrency, migration or initialization-operator suite was run.
Other behavior was inspected statically only.

## Quantity and provenance contract

- Source stock is **accepted server Purchase Received quantity**, at that
  receipt's retained Storage Location ID. Rejections, unreceived orders,
  catalogue location hints, local/demo receipts and sales samples do not post.
- Initial units are **procurement quantity units**, exactly matching the
  receipt/PO contract: at most three fractional digits, 0–1,000,000 accepted
  per receipt line, positive 0.001–1,000,000 per movement item. The catalogue has
  no authoritative quantity-unit/pack conversion metadata. No vial/bottle/kit
  inference or conversion is introduced.
- Lot identity is the retained pair `(receipt UUID, original PO-line UUID)`;
  the internal UUID is deterministic from those IDs. Supplier batch text is
  descriptive, never unique. Two receipts/lines with the same supplier batch
  remain distinct.
- Quantities use PostgreSQL unconstrained NUMERIC with scale/range CHECKs,
  Pydantic string inputs and string outputs, Python Decimal, and frontend
  decimal text/BigInt operations. No inventory quantity crosses floating point.
- Product on-hand is lifetime receipt acceptance plus paired transfers, across
  all financial years. The UTC history period filters **posting times only**,
  never the current balance. Initialization posts now while retaining the
  original receipt creation/received dates; it does not invent a past posting.
- Real pre-system openings and all sales/customer-order/reservation/manufacturing
  activity are **outside coverage**, not measured zero activity.

## Atomicity, history and authorization

Every request is protected by `admin.access`, and every service operation
revalidates the live protected singleton under User/session locks. Staff grants,
business designations and MR identities cannot manage stock.

Lock order for inventory writes is User/session → shared inventory advisory
transaction lock `145573` → PO (for receipt writes) / ordered active Storage
Locations (for transfers) → Staff / lot balances. Receipt create/edit/delete,
transfer creation and initialization share the inventory lock. It serializes
even first destination-balance insertions and absent retry keys. Reads that
need inventory snapshots take the same lock, so catalogue/lot balances in one
returned snapshot cannot straddle a receipt/transfer commit.

Receipt reconciliation occurs inside the original receipt transaction alongside
receipt history, actor-bound retry response, AuditEvent and PO fulfillment
effects. It credits/debits only the original receipt location. Reductions,
line removals and receipt deletion fail if that debit would be negative.
Once a lot has any committed movement, its product/batch/expiry identity cannot
change, including after stock returns to origin. Automatic batch reservations
and existing supplier-batch reuse remain untouched.

Transfers check distinct current active locations, positive supported
quantities, one occurrence per lot, current source balances and active catalogue
products and Staff. A review fingerprint covers live balances and reference
versions/names. Creation repeats these checks, then saves one immutable
movement, an AuditEvent, paired exact postings, updated balances and encrypted
retry result in the same transaction. Posting rows retain their actual
before/after balances. Movement snapshots retain:

- Stable source/destination IDs and complete name/address/PIN/country/State/UT/
  city snapshots, including explicit empty optional geography.
- Product identity/name, receipt/line provenance, original batch/expiry,
  quantity, both source/destination before/after balances.
- Delivery mode, selected Staff ID if any, and retained delivery name.
  This name does **not** authenticate the person who delivered the stock.
- Actual saving actor ID/name, server time, safe request correlation and one
  committed activity entry. Later master/account changes do not relabel it.

Movements, posting history and retry rows are append-only via database
UPDATE/DELETE/TRUNCATE guards. There are no movement edit/delete endpoints.
Failed/denied HTTP operations retain the existing body-free structured request
evidence and status/request correlation, not successful transfer events.
Movement counts count committed records, not retries. Summaries count
movements/lots; incompatible product quantities are never summed.

`GET /requests/{key}` serializes with writers and durably closes an absent
request before returning `not_committed`. Late original requests cannot post
after that answer. Keys/results are actor-bound. The frontend journals only
owner-bound opaque keys under Web Locks; sensitive drafts stay mounted in
memory. It does not automatically replay a mutation or use a new identity
while an outcome is uncertain.

## Inventory completeness and existing receipts

`inventory_receipt_states` records the exact receipt version posted. Stock and
availability are unavailable if **any** server receipt has no matching state.
A page cannot label a partial initialization complete. Catalogue zero-stock
rows are exposed only when the receipt coverage check is complete.

`GET /api/v1/admin/inventory/initialization` is a protected, bounded read-only
eligibility/reconciliation report. It verifies encrypted receipt identity
against operational columns and retained receipt-line/product FKs, exact
quantities and required source metadata. Unreadable/ambiguous rows return
`unavailable`, not guessed defaults. Evidence compares per-line accepted,
posted and total on-hand amounts, and each location balance against its
postings. Historical full address/geography is explicitly unavailable:
receipts retained only the original location ID/name. Today's geography is
not passed off as receipt-time history.

### Controlled receipt initialization operator procedure

`scripts/initialize-inventory.py` provides a separate, explicit development
operator procedure, not an HTTP mutation/startup hook. No account or web session
is created or impersonated. The existing protected singleton is only the
ownership anchor; its initialization event has a NULL session and explicit
`operator_initialization` reason. The OS operator must be independently
authorized.

Before using it, independently review and confirm a private target JSON with
exact keys `workspace`, `host`, `port`, `database`, `cluster`, `oid`. Never fill
those expected fields automatically from the database being initialized.
Schema must already be exactly `0054_modern_email_tests`; the command never
migrates or stamps. Confirm the current checkout's API source, release contract
and schema review agree on this exact revision before proceeding. Old report
files bearing `0046` or `0053` cannot be applied: generate fresh `0054` reports.
Do not edit their schema/target fields or copy tokens from older reports.

1. Stop writers and retain a current full private archive plus independently
   verified restoration/content evidence and separate recoverable PR keys
   (including every key ID still needed by retained ciphertext).
   Existing recovery approvals for a predecessor are not reused as permission.
2. Authorize this exact target and receipt initialization separately. The
   operator flags are explicit attestations of independent evidence, **not**
   automated backup/restore verification or approval conferred by source code.
3. Generate bounded read-only pages with `--report --target-confirmation
   <private-target.json> --output <new-private-path> [--after <receipt-uuid>]
   [--limit 100]`. Outputs must be outside this repository and are created
   mode 0600 without overwriting. Review every candidate; unavailable rows
   block the reviewed batch.
4. After approval, use `--apply-reviewed <reviewed-report.json>
   --target-confirmation <private-target.json> --output <new-private-path>
   --approve-initialization --attest-restored-private-backup
   --attest-key-recovery --writers-stopped`. Run from the approved development
   environment only; neither command has been executed here.
5. Each receipt commits independently under the shared inventory lock.
   The exact keyed receipt review must still match. A rerun of the same file
   skips an already-current receipt after reconciliation. A failure rolls back
   that receipt, writes an incomplete report of earlier committed receipts,
   stops the batch and never claims complete stock.
6. Continue reviewed pages until the global pending-receipt count is zero.
   Retain all review/commit reports in approved private durable recovery storage,
   separately from keys. Only then expose receipt-backed stock as complete.

From the reviewed checkout, using the approved backend Python environment
(with its existing dependencies and operator-managed configuration), the
commands are:

```sh
python3 -B scripts/initialize-inventory.py --report \
  --target-confirmation /private/operator/target.json \
  --output /private/operator/review-page-001.json --limit 100

# Only after independent review and explicit batch/recovery approval:
python3 -B scripts/initialize-inventory.py \
  --apply-reviewed /private/operator/review-page-001.json \
  --target-confirmation /private/operator/target.json \
  --output /private/operator/commit-page-001.json \
  --approve-initialization --attest-restored-private-backup \
  --attest-key-recovery --writers-stopped
```

Paths above are placeholders, not commands to run as part of source delivery.
The target document uses string `workspace`, `host`, `database`, `cluster` and
integer `port`, `oid`; obtain them from independently approved target records,
not the connection's environment or a query used to fill in its own confirmation.
An identical cluster identifier on a clone is not proof of the approved host.
Keep documents in an operator-owned private directory outside the repository
and public/shared artifact paths; never paste keyed review tokens, receipt
payloads, keys or connection credentials into chat, logs or task attachments.
New output files are exclusive-create mode 0600, not overwritten.

For subsequent pages, pass the previous report's `after` receipt UUID with
`--after`, use new output paths, and review each page separately. An empty page
is not an apply batch. Remove unavailable candidates only through an explicitly
reviewed new batch; never relabel them eligible. No complete coverage is claimed
while any receipt remains pending. A `batch_committed` result proves that batch,
not global completion. Following `incomplete`, retain the failure/commit
evidence and resolve the cause before resuming the same approved file with a
new output path; prior commits are not rolled back. If the receipt, target,
schema, or approved recovery context changes, stop and obtain fresh review and
approval instead of bypassing a failed prerequisite.

## API/UI scope

All paths below are under `/api/v1/admin/inventory`:

| Operation | Contract |
| --- | --- |
| `GET /stock` | Bounded search/category/multiple-product scope, current rows, coverage, UTC as-of and optional all-match `snapshot`; pagination never limits the supplied report snapshot. |
| `GET /stock/{product_id}/history` | Posting-time period, server pagination and saved per-posting balances. |
| `GET /references/{locations,staff,lots}` | Minimal active choices; paged/searchable, lot availability at the requested source. Staff never returns email/phone/login. |
| `GET /movements` | Server search/pagination, all-match counts/lots summary. |
| `POST /movements/preview`, `POST /movements` | Authoritative reviewed immediate append-only transfer. |
| `GET /movements/{id}` | Retained immutable movement record; activity and analytics have explicit subresources too. |
| `GET /requests/{key}` | Actor-bound durable outcome reconciliation/cancellation. |
| `GET /initialization` | Read-only eligibility and per-line reconciliation. |

Scopes are explicitly capped at 2,000 candidates and fail without a partial
inventory/export when exceeded. Reference pages are at most 100 records.
Source lots load all bounded pages before review. Server search uses bounded
authorized decryption; no new substring/blind index leaks descriptive fields.
This first contract prioritizes consistency and finite work over scale.

Stock Status uses one saved all-match snapshot for the screen, CSV and open
report. CSV release keeps existing durable download-log acceptance. Filter
changes/pending loads disable exports until the corresponding snapshot arrives.
Reports and product detail keep their own as-of snapshot. Explicit refresh,
focus/visibility and periodic stock refresh make other-browser writes visible.

Move Stocks lists server records and opens the existing right-drawer pattern
for immutable details, historical balances, server activity and movement-only
summaries. Its form uses server-paged searchable location/Staff choices, an
adjacent wrapping Other-name field, original receipt lots and decimal text
quantities. Selected metadata/typed quantities survive failed refreshes and
uncertain saves. Missing selected lots remain visible as unavailable until
explicitly removed.

## Forward encryption inventory and key custody

Inventory reuses the independent **PR** keyring with new, domain-separated
AAD purposes `inventory:lot`, `inventory:movement`, `inventory:retry` beneath
the existing `evexia:pr:v1:<owner>:<purpose>` binding. Fingerprints add the
`inventory:v1` domain. Random AES-GCM nonces and the existing `v1` envelope
remain unchanged.

| Surface | Protected fields | Allowed operational plaintext |
| --- | --- | --- |
| inventory_lots | Receipt/product names, batch/expiry, original dates, origin name and unit in payload | Lot/receipt/line/product/origin UUIDs, exact accepted quantity |
| inventory_balances | No descriptive fields | Lot/location UUID pair and exact nonnegative quantity |
| inventory_receipt_states | No descriptive fields | Receipt/version and initialization time |
| inventory_movements | Complete locations including address/geography, delivery names/mode, product/lot snapshots, retained actor label, activity and summary | IDs/FKs, actor/event IDs and creation time |
| inventory_postings | No descriptive fields | Source identity, lot/location/movement/actor IDs, time, exact delta/before/after |
| inventory_requests | Full saved result or cancellation marker | Opaque UUID, actor FK and keyed digest |

These plaintext quantity/correlation fields intentionally permit operational
integrity/reconciliation and disclose transaction relationships. They contain no
typed delivery name, batch text or address.

Retain old PR keys for **all** these ciphertexts and fingerprints in addition to
the existing receipt/history/retry and batch-policy/allocation surfaces. Future
offline rotation must explicitly add these forward tables/purposes, preserve
append-only history through an independently approved maintenance procedure,
reconcile all rows, and retain keys until every protected payload and active
review token is covered. No rotation tool, key replacement, historical inventory
rewrite or integrity-trigger bypass is included.

<details>
<summary>Historical manual activation draft — superseded by automatic post-merge lifecycle; do not execute</summary>

## Superseded manual activation handoff

The user approved the gated development handoff, not an attestation that its
independent target/key prerequisites have been met. The old original-development
`0040`→`0044` runner was not extended/reused implicitly. The target must authorize **only**
`0044_purchase_received` → `0045_pr_batch_numbers` → `0046_live_inventory`
with current recovery, key custody, stopped writers and reviewed source.
No arbitrary `upgrade head`, stamping, automatic reclassification or readiness
exception is permitted.

Prepared and attempted, but blocked before connecting:
`scripts/activate-inventory-development.py`.
It accepts only the independently documented original development identity,
requires an externally supplied target confirmation and separate key-recovery/
stopped-writer attestations, and uses operator mutex `145002` plus the inventory
writer mutex before taking writer-exclusion table locks. It retains a new full
archive in approved private App Storage with authenticated readback/anonymous
denial, actually restores it onto a distinct disposable cluster, and compares
the complete schema and every original table's contents before any live DDL.
These are recovery safeguards, not substitutes for independently recoverable keys.
It runs **no migration rehearsal, mutation probe or test harness**.

The only executable paths are `0044` → `0045` → `0046`, or `0045` → `0046` when
the accepted batch migration was independently activated first. The latter path
retains that existing batch policy rather than rerunning/resetting it. An unknown
revision, missing intermediate objects, partial inventory schema, changed source,
different workspace/target or failed recovery stops activation. Every migration
commits in one caller-owned transaction; the command then re-reads the database
revision in a separate read-only transaction. It does not claim API readiness or
initialize receipts.

After independent target and current key-custody confirmation, the operator
command is:

```
uv run python -B scripts/activate-inventory-development.py \
  --target-confirmation <independently-confirmed-private-target.json> \
  --approve-0044-to-0046 --attest-key-recovery --writers-stopped
```

Never supply these attestations merely because a secret exists or a prior
archive restored. Stop the managed API owner (and any other actual writers)
through their owners first. The user has confirmed the original target and
recovery custody for **all** current signing/encryption keys. Execution still
requires the confirmed original workspace; this fork failed that binding before
any backup/restore or migration. New recovery evidence and actual activation
must be established from the approved context, not inferred from that confirmation.

After migration commit, re-read the actual `alembic_version`. Restart through
the existing workflow owners only after their restricted pre-start operation is
permitted. Narrowly observe routed `/api/v1/version`,
`/api/v1/health/readiness` and `/__development-release`. The database revision,
loaded API expected revision and served frontend contract must **all** equal
`0046_live_inventory`, and readiness must succeed. A predecessor database
fails the new readiness check. Then perform independently approved existing-
receipt initialization, retaining its evidence. Until these requirements are
satisfied the task remains incomplete; source/client generation and disposable
CRUD do not substitute for live alignment.
</details>
