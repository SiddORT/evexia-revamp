# Focused MR financial eligibility checks

These checks are **manual-only and require separate user approval**. They are
not registered in release workflows and do not start application services.

After that approval, from the workspace root:

```sh
sh scripts/test-order-eligibility.sh --approved-disposable-checks
```

Extra pytest selectors can be appended, for example `-k cross_type`.
The approval flag acknowledges approval; the script does not obtain it.

The runner uses the existing socket-only private PostgreSQL harness. It replaces
database URLs and encryption material with disposable test configuration,
disables fixture-cache reuse, migrates only the temporary database, and destroys
the cluster on exit. The fixture also refuses an ordinary development or
production database. No production activation is involved. Do not invoke these
tests against a shared database: they commit and truncate their order tables.

## Coverage

| Area | Evidence |
| --- | --- |
| Cross-type placements | All 12 ordered pairs of IT, Kits, SPT and Lupin, both exact equality and one paisa over the limit; independent connections, observed lock waiter, committed counts and final exposure |
| Settlement interleaving | Each source type, receipt-first and order-first schedules; real encrypted receipts and posting; no reservation or partial order on denial |
| Lock contract | Real financial advisory lock is held before identity revalidation in each order service |
| Replay | Original committed order key returns without checking tightened limits or newly unpriced history; rejected resubmission replay and receipt replay remain single writes |
| Replacement | Old order excluded once, prior receipts subtracted once, under-paid replacement rejected |
| Rejected resubmission | Re-evaluates limits before state/version/retry write; equality allowed; old date and committed receipts retained, including full payment |
| Doctor aging | Saved date, not payment date; equality, one day beyond, partial/full payment, selected Doctor only, old-date proposals and edits |
| Settings | Independent zero limits, both-zero unknown totals, restrictive Doctor Master settings are not fallbacks |
| Unknown totals | Proposed and historical unknown totals for all four types under either enabled financial rule; days-only scope excludes other Doctors |
| Multiple patients | Real SPT/Lupin membership rows, one order exposure and one receipt despite replay |
| Authorization | Admin writes are unrestricted by MR limits but cannot post settlements; foreign MR history, direct order IDs, retry keys and payment replies stay private |

## Deliberate boundaries

The fixture supplies synthetic authenticated identities at revalidation and
synthetic resolved clinical/catalogue snapshots. It does **not** mock financial
locks, eligibility, encryption, SQL, idempotency, approval/resubmission,
settlement posting, order `apply` writes or membership persistence.

The tests call each service's real `transaction -> idempotent -> apply` chain;
they do not claim coverage of HTTP contracts, the IT outer response serializer,
real login/renewal, verified file scanning, live prescription ownership,
catalogue-price calculation beyond Kits' saved-basis validation, or browser
submission recovery. Those require separate approval and appropriately scoped
fixtures. No release, regression, integration or browser run is implied by
adding these files.
