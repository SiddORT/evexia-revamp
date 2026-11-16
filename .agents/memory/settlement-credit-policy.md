---
name: Settlement credit policy
description: Approved credit-note authority, balance/reversal meaning, numbering and invoice-reference limits.
---

Only the protected Super Admin creates and reverts credit notes. Owning MRs see
read-only evidence in existing Accounts history; ordinary staff/Doctors and
cross-MR credit visibility are not authorized.

Active credits reduce unpaid balances, financial exposure and overdue
obligations, but are never money received and never change saved order
totals/taxes, receipts or verification. Partial payments do not prevent
reversal; zero credit-adjusted balance does. Reverted evidence and numbers stay.

**Why:** The user explicitly confirmed these financial and authority rules.

**How to apply:** Keep cash and credit distinct in every financial projection.
Coordinate credit/payment/reversal with the same financial lock and preserve
durable idempotent outcomes; aging uses the original saved order date.

Credit numbering follows `CN/IMT/26-27/163`, with type tokens IMT, KIT, SPT, LPN,
a two-digit April–March financial-year pair from the Kolkata issue date, and a
dedicated increasing integer sequence. No reset was requested and 163 is only
an example, not an approved sequence seed.

**Why:** The user supplied and confirmed this exact format independently of
existing order identifiers.

**How to apply:** Never renumber orders or reuse reverted credit numbers.

There is no approval for a new invoicing system. Reuse an explicitly integrated
authoritative saved invoice reference if one exists; otherwise require the user
to enter their saved year/order-number reference, preserving values such as
`024-25/00051002` without constructing an issued invoice number.

**Why:** Invoice Settings and order identifiers do not establish invoice issuance.

**How to apply:** Keep entered invoice references independent of order numbering.
PDF/printing, tax adjustment documents, refunds, wallets, notification delivery
and financial-history imports remain outside this credit-note approval.
