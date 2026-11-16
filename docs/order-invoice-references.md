# Order invoice references

## Scope and authority

The confirmed format is financial year / saved numeric order portion:
`2024-25/00051002`. Financial year uses the saved order date, April–March,
not approval, adoption or current date. Canonical saved prefixes are `IT-`,
`kit-`, `spt-`, `lup-`; the complete following ASCII numeric lexeme is retained
without converting it to an integer or padding it again. Unrecognized prefixes,
draft UUID labels, nonnumeric/zero-only suffixes, suffixes longer than the existing
20-digit credit-reference contract, and unsupported dates require explicit review.
They are never stripped heuristically, renumbered or replaced.

Prospective approval atomically records `invoiceAuthority` in the existing
authenticated encrypted source snapshot. Linkage includes kind and source UUID
because families can share the same numeric suffix and visible reference.
`provenance=approval` records that actual approval's version/time. An existing
valid authority is retained, never reissued. A malformed existing authority
blocks issuance rather than being silently repaired.

There are no new database columns, tables, sequences, schema revisions or
readiness requirements. The existing four ciphertext columns, AAD domains and
whole-envelope Directory-key inventory/rotation rules still apply. Keep existing
Directory keys as required for those snapshots and immutable credit archives.
Historical field inventories and staged migration/source metadata are unchanged.
This work does not activate any pending schema branch.

## Historical adoption entry point

Existing bounded adoption entry point:
`app.services.order_invoice_references.backfill_page(db, actor, kind, *,
after=None, limit=100, apply=False)`.

This is an internal operator entry point, not a public route, startup hook,
migration or automatic data job. It requires a currently valid protected
Super Admin actor/session, revalidated through the existing Accounts transaction
boundary, valid Directory crypto readiness, and the shared financial/policy and
source row locks. It does not bypass authentication by constructing an actor.
No database connection/session is created implicitly by importing the module.

After separate authorization to inspect/apply business data:

1. Use an approved authenticated operator harness providing `db` and `actor`.
   Call with `apply=False` for exactly one kind: `IT`, `Kit`, `SPT` or `Lupin`.
   Start each family with `after=None`; choose 1–500 rows per page (default 100).
2. Persist the page's `items` and `nextCursor` in the operator's approved private
   report location. Advance `after` only after the call returns successfully.
   Follow cursors until null for **each** family; do not treat the first page as
   the entire inventory. The cursor is a source UUID, not the visible reference.
3. Review `review_required` identities. Reports contain kind/UUID and fixed safe
   explanations, not decrypted persons, clinical snapshots or financial values.
   Resolve conflicting/malformed facts only under separate reviewed authority.
4. Obtain approval for the reviewed adoption, then repeat the same bounded pages
   with `apply=True`. Every page re-reads/revalidates current source facts under
   lock. The inspection result is not permission to apply stale source values.
5. Each apply page commits atomically. On an interrupted/failed call, retry its
   original cursor. Existing valid authority is reported `preserved` and is not
   resealed, renumbered, timestamped again or audited twice. Failed database/write
   work rolls the whole page back. Domain-invalid records are reported without
   repair and do not prevent valid records in that page from being adopted.
6. Retain unresolved identities separately, since advancing a cursor passes them.
   Rerun from the beginning after their separately approved correction; already
   adopted records remain unchanged. Perform a final fresh sweep of all families
   to catch records whose state changed during paging; missing authorities are
   never repaired automatically by listing or credit creation.

Supported adoption evidence:

- Saved and relational `Approved` / `In process` (legacy spelling normalized only
  for comparison), or matching Shipped, Delivered and Returned stages.
- The existing compatibility combination: relational Confirmed/Saved plus a saved
  approval with readable approver UUID/time, and a compatible snapshot state.
- Existing approval evidence, when present, must be readable. Conflicting
  rejection/approval or snapshot/relational states require review. A review label
  alone does not authorize adoption. Other unapproved records are `not_approved`.

Adoption retains original status, order identity/date/number, approval/rejection/
review evidence, pricing/taxes/totals, clinical/stock data, receipts and credit
archives. It adds only invoice authority, increments the order mutation version,
attributes that actual adoption update, and appends
`order_invoice_reference_adopted` audit evidence. This invalidates stale forms
without pretending adoption was the original order approval.
`provenance=historical_adoption`, `recordedAt=actual adoption time`,
`approvalVersion=null` never claim a historical reference issuance event/date.
Existing authority is validated and preserved; conflicting authority is reported,
not overwritten. The current implementation has no pre-existing issued-invoice
authority outside this explicitly integrated object.

## Credit behavior and historical preservation

Accounts reads validate the persisted object; the browser never derives a
reference from displayed order fields. Null/unreadable authority leaves financial
and historical credit reads available but blocks a **new** credit. Creation
revalidates under the order/financial locks before allocating a credit number.
A supplied mismatch or unavailable authority yields a durable rejection through
the existing exact-request machinery.

Existing historical credit documents keep their immutable manually entered
references, including formats such as `024-25/00051002`. Successful historical
request replays and reconciliation resolve the original note without creating
another note or comparing its reference to the new authority. Reversal keeps
the existing zero-balance rule and does not require the new authority.
No cash, credit numbering, eligibility, permissions or totals policy changes.

## Authorized development adoption outcome

On 2026-11-16 the explicitly authorized operator operation matched the configured
database host/port, database name/OID and PostgreSQL cluster identifier against
`scripts/development-database.json`, with recovery false and application settings
in development mode. The platform environment label was `production`; it was
not used to infer the database target. The exact recorded development binding
was confirmed before authentication and each adoption page. The observed schema
was `0112_settlement_credits`; no migration or schema activation was performed.
No API listener was running and none was started.

The operator used the existing password login with inspection credentials,
required the authenticated protected Super Admin, and passed that real session
to the existing service transaction for every operation. No actor/session was
fabricated. The normal login replaced prior sessions for that inspection account;
the operator session was logged out after the operation.

All cursors were exhausted independently for all four families, first inspecting,
then applying `backfill_page`, then performing a fresh read-only adoption sweep:

| Family | Adopted | Existing preserved at application | Review required | Not approved | Valid saved authorities confirmed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Immunotherapy | 1 | 0 | 0 | 1 | 1 |
| Kits | 2 | 0 | 0 | 0 | 2 |
| SPT | 1 | 0 | 0 | 0 | 1 |
| Lupin | 1 | 0 | 0 | 0 | 1 |

The pictured `kit-000002` was found with authoritative saved date **2026-11-16**
(not the screenshot's stated 18 November) and status **Shipped**. Both fresh
decryption/authority validation and a separate authenticated settlement
`order_history` read confirmed **2026-27/000002**, with
`provenance=historical_adoption`. Its settlement projection was payable with a
known balance. No credit or cash transaction was submitted. Other families'
authority confirmation came from the bounded validation sweep, not browser
observations. Private minimal page reports were retained under the ignored,
owner-only `.local/invoice-authority-adoption/` directory; they contain no person,
clinical, financial amount or credential values.

There were no unresolved adoption conflicts or access blockers. Existing credit
archives were not rewritten; adoption invoked only the existing invoice-authority
writer. No changes were made to order dates/numbers, approval decisions, saved
amounts, stock, cash or credits. These are saved development data outcomes, not
production activation or evidence that the changed UI has been served.

The Add credit note label, explanation and confirmation now say **Invoice number**.
Opening the dialog first fetches a fresh authenticated settlement history row.
The editor mounts only after that read succeeds; failures offer explicit retry
and never enable credit submission using the stale listing row. Once mounted,
its row and any reviewed/frozen submission are not refreshed underneath it.
API field names and persisted authority contracts remain unchanged.

Only source/diff inspection and the narrowly authorized authenticated data
operations above were performed. **No regression/release checks, tests, builds,
typechecks, completion-validation wrappers, app-preview screenshots, browser
verification, managed service starts/restarts, migrations or deployment ran.**
No browser behavior is claimed as observed. The source changes still require
merge and the normal separately authorized serving lifecycle; no workflow was
started to activate them.

## Original implementation source-review limits

Source/diff inspection covered the April boundary and numeric lexeme retention,
approval transaction placement and rollback, retry/current-row behavior, all four
ordinary/import writers, fulfillment snapshot retention, backfill pagination and
conflict handling, historical credit replay/reversal, and the dialog's read-only/
unavailable/confirmation/frozen-request paths.

At that original source-preparation stage, **no tests, regression/release checks,
builds, typechecks, completion-validation
wrappers, runtime/browser probes, managed service starts/restarts, live migrations,
backfill execution, deployment or real business writes were performed.**
No generated contract changes were necessary because wire shapes did not change.
No runnable preview was presented as verified.

The original implementation handoff required separately authorized runtime
verification in an isolated environment, historical adoption through the bounded
procedure, review of unresolved identities, and confirmation of all four
approval/credit/replay paths.
That original source preparation did not itself execute adoption or authorize
production activation or unrelated staged migrations. The subsequent development
adoption outcome is recorded above; no production activation is authorized.
