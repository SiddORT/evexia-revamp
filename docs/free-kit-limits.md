# Free KIT Order Limits

## Policy

Only the protected Super Admin may mark an already saved Confirmed Kits &
Consumables order **Free kit**. It is a separate irreversible action, not a
placement flag, discount, missing price, payment, forgiveness or zero invoice.
The action does not approve the order.

Admin Settings → Free KIT Order Limits has independent **Per MR** and
**Per Doctor** nonnegative integer caps. Each has its own **Financial year**
or **Month** selector. Both must have capacity. Zero prohibits further marks
for that dimension. Before an explicit first settings save, marking is blocked;
there is no default allowance or unlimited setting.

Counts are orders, not quantities, from the saved order date and saved MR/Doctor
IDs. Financial years are April 1–March 31; months are calendar months in
Asia/Kolkata. The permanent ledger freezes attribution, regardless of later
master reassignment. Kits-to-MR and MR-shipped orders still require both saved
identities. Missing/inconsistent saved attribution produces an actionable error.

The confirmation shows both applicable date windows, caps, used counts and
remaining allowance. The server recomputes everything under transaction locks.
Changing a period applies that new window to all permanent marks' saved dates;
it does not move or rewrite historical marks. A lowered cap can leave existing
use over the limit and prohibits more marks. Rejection, return and fulfillment
never refund a slot. There is no unmark, override or refund operation.

## Eligibility and immutable evidence

Any saved pricing, including explicit zero rates, financial history or saved
contribution/Parking evidence, prior review decisions, invoice authority, IRN,
receipts or credit history blocks conversion. Reversed credits also block it.
Nothing is erased to make an order eligible. A pricing-review flag caused only
by ordinary unpriced item corrections is not itself evidence of historical rates.

The encrypted saved order contains actor, time, resulting order version,
policy version, saved identities/date, both windows and pre-mark counts.
Append-only policy revisions and one permanent quota row per order retain the
same attribution. Settings retry payloads contain only IDs, versions and quota
configuration; no personal text, rate data or new encryption field is added.

Normal edits and reviewed imports reject free orders even when submitted by
Super Admin, even when an import calls a row unchanged. Strict entry/draft
contracts accept no classification field. Classification cannot be removed
through edits, attachments, assignment changes, repricing or correction/resubmit.
View and existing authorized fulfillment remain available.

Protected review still requires an explicit decision and rejection reason.
Free approval bypasses pricing and financial review only; existing item,
identity and verified-file checks remain. Approval does not assign an invoice
reference. Fulfillment preserves the encrypted classification and does not
activate new stock behavior.

## Financial boundary

Free kits are excluded from Accounts payable lists, pending-pricing counts,
Doctor/MR exposure, aging, balances and financial completeness failures.
Receipt allocation, credit notes, invoice authority/adoption and IRNs reject or
exclude them. No financial posting, synthetic payment, zero pricing snapshot,
invoice or forgiveness entry is created. The old immutable payment flag is not
rewritten; operational projections show **Free kit**, never that legacy flag.

MR financial cards, achievement scans and monetary totals omit free kits before
financial read budgets are counted. KIT achievement remains
saved **Business Parking** for normal eligible KIT orders; free KIT achievement
is excluded. Free kits remain visible in operational orders, shipment views
and recent orders; the targets report does not treat them as contributing
financial rows. Operational order/status counts keep their existing meanings.

## Source-level transaction design

Existing order authorization obtains the common policy and financial lock
before identity/order writes. Both settings and marking then take the same
free-kit advisory lock, before request and order locks. SQL counts read the
entire permanent ledger by saved identity and date, not the current listing page.
Policy selection, capacity checks, unique usage insertion, encrypted evidence,
order version and audit event commit in one transaction.

Actor/payload-bound idempotency recovery precedes stale-version/eligibility
checks for the original request. Exact retries cannot insert a second slot.
Different keys on the same order find permanent classification and are rejected.
Settings are append-only with optimistic versions and exact retry comparison.
Source inspection indicates shared last-slot attempts and concurrent settings
changes are serialized; this has **not been exercised under concurrency**.

The source-only migration adds empty policy/usage tables, immutable/truncate
guards, protected-actor guards, identity protection and identity/date indexes.
The coordinated declaration and readiness checks name `0114_free_kit_limits`;
`0115_free_kit_staged_merge` only joins previously existing staged ancestry.
Readiness retains predecessor checks. No migration was executed or deployed.

## Verification boundary

Only source/diff inspection and narrow offline OpenAPI/client generation and
formatting were performed. No tests, regression/release commands, builds,
typechecks, completion-validation wrappers, browser/runtime probes, service
starts/restarts, migrations, live writes or deployments were run.

Concurrency, database persistence/constraints, visual layout, focus/retry flows
and all runtime behavior remain **unverified**. The prepared migration and UI
are not evidence of activation on an existing running database.
