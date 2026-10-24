# Sales-order decision source

Approval is a durable server-owned decision and advances a pending saved order
directly to **In process**. Rejection advances an eligible pending submission to
**Rejected**, with separate actor/time evidence and no approval evidence.
Pricing saves do not decide orders. SPT Draft is not a submission; Saved remains
pending until an explicit Admin decision.

Kits decisions require protected Super Admin access. SPT and Lupin require the
existing edit permission. MR ownership/edit locks, row versions, encrypted
owner-bound retries and scoped counts remain server-enforced.

## Unapplied schema transition

`artifacts/api-server/backend/alembic/versions/0073_order_decisions.py` is authored
but **not applied**. It widens the SPT lifecycle column/constraint, admits Lupin
In process, and normalizes only standalone Approved records and pending Kits/SPT
records that already contain real approval actor/time evidence. It preserves
terminal states and existing audit attribution. Converted rows increment their
versions to invalidate older editors. Directory decryption keys are needed for
the encrypted historical Kits/SPT review; missing or invalid keys must fail the
transaction, not fabricate evidence or skip history.

The coordinated schema source expects this successor before normal operation.
Readiness inherits predecessor probes. Existing historical migration files and
the operator's prior approval manifest are deliberately unchanged; schema
activation needs its own authorization and review. Do not run migrations or
activate services merely to inspect these changes.

The seven listing cards use scoped aggregate counts independent of filtering and
paging. All orders still includes Draft/Saved and other legacy states; those
states are not invented Confirmed counts. The display label In shipping reads
the Shipped aggregate. Admin creation/update history is one stacked column; API
and exports retain their separate audit fields, and MR receives no Admin audit
column or rejection attribution.

## Review limitations

Implementation review was source-only, including responsive grid/flex wrapping,
long counts/actors, shared theme tokens, local dialog sizing and table-contained
horizontal scrolling. No authenticated manual viewport inspection was performed.
No tests were added, changed or run; no automated browser checks, builds,
type-checks, release/validation wrappers, migrations, service activation or real
order changes were used for verification. Only offline API contract export,
client/validator source generation and source formatting were run; the normal
generation wrapper was avoided because it also invokes a build/type-check.
