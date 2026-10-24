# MR Doctor Overview

## Scope and summary contract

MR Doctor list and detail responses include a read-only `orderSummary`.
The existing Doctor authorization first selects the displayed page or owned
detail record; the shared MR order authorizer then applies its saved MR scope.
Every order query uses that MR ID and only the selected Doctor IDs (at most 100).
Admin Doctor responses and stored contacts are unchanged.

The summary is embedded in the existing request, not fetched per card. SQL
aggregates count all matching persisted orders, independently of order search
cursors, search scanning bounds, or the first loaded order page.

| Domain | Included records | Pending fulfillment | Canonical saved price |
| --- | --- | --- | --- |
| Immunotherapy | All saved records | Confirmed, Approved, In process, Shipped | `totalMinor`, if present |
| Kits | All saved records associated with the Doctor, including Doctor/MR supply orders | Confirmed, In process, Shipped | `pricing.total`, if present |
| SPT | Saved only; incomplete Draft records excluded | Not tracked | `total` |
| Lupin | All saved records | Confirmed, Approved, Shipped | `total` |

Delivered, Rejected and Returned orders remain in the historical count and known
priced subtotal but not pending fulfillment. SPT contributes to total orders and
value, with fulfillment coverage explicitly untracked. The detail page explains
these differences and shows counts by domain.

Only the saved monetary fields above are used. No master prices, bottle-price
reconstruction, demo payments or browser totals are consulted. Server Decimal /
integer arithmetic produces a string of INR minor units; UI formatting uses
BigInt. A known subtotal is always labelled with priced/unpriced order coverage.
An all-unpriced history reads **Unpriced**; a genuinely empty history reads
**No orders**. Both are different from an unavailable summary.

Price inspection decrypts only selected, authorized snapshots, in batches of 25
with a 2,000-snapshot global request budget. When the selected scope exceeds that
budget, counts and saved payment flags remain available, but values and price
coverage are unavailable, not prefix sums. Unreadable snapshots make the affected
Doctor's value unavailable. A detected count/inspection mismatch during concurrent
changes requests a refresh rather than presenting a partial subtotal.
SQL/service failures use the existing explicit request error and Retry path.
There is no decrypted-results cache or client-side traversal of all order pages.

## Payment boundary

Kits and Lupin have authoritative saved **Paid / Unpaid / Partial** flags.
The overview counts those flags without treating them as reconciled balances.
SPT and Immunotherapy payment status are explicitly not tracked. Partial does
not establish a remaining amount.

Pending payment, aggregate balance, remaining credit, due dates, due-soon,
overdue and limit utilization are **Unavailable / Not tracked**. Order dates
and order values do not establish debt or deadlines. Configured Doctor days and
payment limits are displayed as limits only, including saved zero values, with
no invented warning thresholds. No ledger, transactions, reminders or credit
enforcement were introduced. Browser-local demo payment history remains separate.

## Presentation and shared contacts

The Doctor-specific grid retains exactly three equal columns at viewport widths
of 1100px and up, two at 650–1099px and one below 650px, even for fewer doctors.
It uses existing EVEXIA theme tokens and content bounds; the global grid is not
modified. Grouped table fields stack below 600px. Detail sections retain the full
profile, configured terms, masked contact displays, saved address and the same
summary/coverage model. View details controls have 44px minimum touch height.
Existing search, scoped filters, continuation, pagination, loading/error/empty
states and refresh remain on the original hook and authorization path.

The separately merged MR contact policy is consumed unchanged: saved addresses
are visible, phone displays expose at most the last two digits (short legacy
numbers stay fully masked), and valid emails display only the actual domain
after `***@`. The frontend renders only server display fields for contacts,
without raw phone/email values in links, titles or hidden copies.
No additional shared contact-policy implementation was added here.

## Targeted development fixtures

`scripts/seed-reena-overview-doctors.py` is a standalone Doctor-only operator
command. It requires an independently confirmed development database fingerprint
and expected MR ID. It verifies a unique Reena MR directory record, its active
profile, active MR account and the existing MR-004 account label. It uses current
Doctor validators, assignment checks, encrypted ORM writes, business-number
allocation and create audits with explicit local-operator attribution; no web
session is fabricated.

The script preserves all existing records and refuses changed, inactive/deleted,
ambiguous or differently assigned fixtures. All writes commit atomically.
Rerunning reads/reuses exact fixtures without updating them. It never invokes
the broad master seed, migrations or account enrollment.

Actual authorized development operation on 2026-10-24:

- Independent development connection and application connection matched.
- One unique active Reena MR/profile/account linkage was confirmed as MR-004.
- Four clearly named fictional doctors were inserted: **DR-004 to DR-007**.
- Clinics/fictional addresses vary across Mumbai, Pune, Nagpur and Nashik.
- Configured terms: 30 days / ₹50,000.00; 45 / ₹1,25,000.50;
  60 / ₹2,50,000.00; 0 / ₹0.00. These are limits, not balances.
- Initial execution: **4 inserted, 0 reused**, followed by post-commit exact
  record/term confirmation.
- Authorized idempotence rerun: **0 inserted, 4 reused**, followed by the same
  confirmation.
- No orders, payments, Patients, accounts, real assignments, financial
  transactions, schema objects or production data were created/changed.

Invocation (obtain the MR ID and fingerprint by independent development reads):

```sh
python3 -B scripts/seed-reena-overview-doctors.py \
  --development-database-fingerprint <confirmed-development-fingerprint> \
  --expected-mr-id <verified-existing-reena-mr-id>
```

## Verification limits

Changed source was inspected for scope, privacy, exact monetary handling,
unknown-data states, responsive breakpoints, wrapping and semantic access.
FastAPI OpenAPI and generated clients/validators were regenerated as source
artifacts using the standalone exporter and Orval, without the package wrapper's
typecheck. The generated diff is limited to the Doctor summary contract and the
corrected Doctor address description.

One read-only capture of the already-running `/mr/doctors` preview showed the MR
sign-in page. It did **not** verify the authenticated overview or the running
backend's new summaries. No sign-in or other browser interactions were performed.

**No regression suites, release checks, automated tests/browser tests,
builds, typechecks, validation wrappers, service starts/restarts, migrations,
deployments or pushes were run.** Runtime acceptance of the protected overview
remains unverified; seed persistence observations are not UI/API verification.
