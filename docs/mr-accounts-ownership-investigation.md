# MR Accounts ownership investigation

## Finding — 2026-11-11

The four business order numbers visible in the supplied Accounts screenshot
exist in the current development database. All four have the same authoritative
saved `mr_id`. That MR profile links to the active MR account whose decrypted
account label is **MR-004**, matching the screenshot. Each order's `created_by`
also equals that account's user ID. The corresponding MR directory is active
and not deleted.

| Order type | Saved order number | Saved status | Saved owner |
| --- | --- | --- | --- |
| Immunotherapy | IT-000001 | Shipped | MR-004 |
| Kits & Consumables | kit-000001 | Confirmed | MR-004 |
| SPT | spt-0000001 | Saved | MR-004 |
| Lupin | lup-000001 | Confirmed | MR-004 |

A separate aggregate over all four order tables for that saved MR owner found
exactly these four non-draft orders, one per type. Thus a combined Accounts
count of four is consistent with current saved ownership; a per-type order
listing can correctly show one. The report that the account has only one order
does not agree with those saved facts. This does not prove what the user saw
in an order listing, nor whether the three other assignments are intended.

No ownership correction in application code was justified by this trace.
No records, assignments, payments, statuses or financial policy were changed.
Before any data correction, obtain explicit approval identifying which orders
are incorrectly assigned and their intended owners; do not infer an owner
from a Doctor, Zone, name, registration or the desired row count.

## Evidence method and limits

- Used bounded read-only SQL on the configured development database, followed
  by an application-database transaction explicitly set to `READ ONLY` with a
  five-second statement timeout. Used the established account crypto primitive
  only to confirm the four joined owners' account labels. No credential/key
  values, personal contacts, patient details or encrypted snapshots were
  printed or saved in this report.
- The evidence is from the current development database, not a production
  investigation or a reconstruction of the screenshot's historical database.
  Matching order numbers, owner account and statuses support the explanation,
  but do not establish the revision or database served to that browser then.
- No HTTP/browser/runtime probes, regression/release checks, default validation
  harnesses, builds, typechecks, migrations, seeding, service starts/restarts,
  preview restoration, deployments or application writes were performed.
- The authorization and transition findings below are static source evidence,
  not an executed authorization, concurrency or account-switch test.

## Identity and saved-order boundary

`auth._load_identity` resolves the MR profile by authenticated `User.id`, not
by name, Doctor, Zone or a browser-supplied MR. `revalidate_identity` checks the
active session, user role and credential/identity versions and reloads the
profile, rejecting changed MR assignments. `mr_orders.authorize` revalidates
and derives `order_mr_id` from that current active saved MR profile.
`mr_orders.scope` then supplies `Order.mr_id == authenticated MR profile ID`.
An unauthorised helper call fails instead of silently receiving Admin scope.
Protected Super Admin retains unscoped access; ordinary staff do not gain
settlement access.

Both Accounts and the four live MR order listings use that same saved-order
predicate:

- `settlements.candidate_orders` applies it to each source order table before
  candidate counting, decrypting/searching, financial projection and offset
  pagination. All saved non-draft lifecycle stages remain eligible for display.
  MR filters cannot expand scope; an explicitly different MR filter is denied.
- `immunotherapy.listing`, `kits.listing`, `spt.listing` and `lupin.listing`
  apply the predicate before fetching/searching/paging; status summaries and
  counts independently use the same scoped order tables.
- `mr/LiveOrders.jsx` opens one backend-backed order type at a time. Accounts
  defaults to **All types**, not just Immunotherapy. Both use authenticated
  server transport, not browser-local demo orders.
- Status, date, person and payment filters can narrow visible results without
  changing ownership. Accounts derives payment status from actual ledger
  entries; legacy order-list payment flags need not give identical filtering.
- SPT reusable registration access uses `Registered.owner_mr_id`, separately
  from `SptOrder.mr_id`. No registration policy was substituted for saved-order
  ownership or changed by this investigation.

## Finance access paths

- Pending payment selection uses the same Accounts listing with
  `payable_only=true`, keeping ownership while restricting payable stages and
  positive known balances.
- Settlement Doctor/Patient/MR reference choices are collected only from
  `candidate_orders(all_saved=True)` in the caller's saved-order scope, with
  search and pagination after that restriction.
- Direct history and new payment allocations resolve `owned_order`, which
  applies `mr_orders.scope` in the order lookup. Posting locks each source row
  and retains status, expected-version, exact total, expected-paid and
  overpayment protections.
- Committed retry/reconciliation replies require both the submitting user and
  saved MR profile, then recheck current ownership of every order in the
  batch. Rejected outcomes require the same actor and MR identity and contain
  rejection information, not an unlocked other-owner batch.
- Super Admin verification remains a separately authorized one-way operation;
  it does not acquire MR posting authority. Prior payments still start at zero
  unless actual immutable settlement entries exist. No ledger facts were
  rewritten or inferred during this investigation.

## Browser identity transitions

`MRWorkspace` keys its provider by user ID, identity kind and MR profile.
`MRAccountsSettlements` also keys `SettlementsView` by user/contact-read scope,
which includes the user ID, identity kind and MR profile ID. Account/scope
changes therefore remount the list and its selection/history/payment dialogs.
Same-account renewal hides/inerts the preserved subtree rather than treating
it as a different account.

The shared authenticated transport captures the session generation, user and
read scope, checks them before the request and after response parsing, and
uses `cache: 'no-store'`. Accounts list/history effects additionally use
identity guards and abort cleanup; list responses are rendered only when their
filter/page request key matches. The pending-order picker uses abort cleanup
and the same guarded transport. These source protections do not constitute
runtime proof that every browser transition behaves correctly.
