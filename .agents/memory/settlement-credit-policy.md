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

The former manual-reference fallback is superseded: the user confirmed
`2024-25/00051002` means financial year / order number and explicitly included
existing approved orders. References use the saved order-date April–March year
and saved numeric portion without losing zeroes. Kind/UUID remain identity;
families may share visible text. New credits require saved server authority,
never browser derivation or manual override. Old notes retain their original
immutable references, including manually entered historical text.

**Why:** The user explicitly authorized automatic saved order references and
historical adoption, but no separate invoice sequence, order renumbering or
rewriting of credit evidence.

**How to apply:** Treat historical adoption as distinct from original issuance;
never invent its date/event. Invoice documents, legal/tax certification,
financial recalculation, refunds, wallets, notifications and financial-history
imports remain outside this approval. The user subsequently chose “Save and
show invoice numbers,” explicitly authorizing bounded historical adoption in
the current development database only, not production changes, migrations,
managed workflow starts/restarts, release checks or broad runtime verification.
Confirm the recorded development target and authenticate a real protected
Super Admin session before an authorized adoption; source preparation alone
is not permission to repeat live writes.
