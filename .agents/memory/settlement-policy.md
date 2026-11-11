---
name: Settlement policy
description: MR-owned payment posting, narrowly protected verification and zero-history financial scope.
---
Only authenticated MRs record settlements against their own saved orders.
Protected Super Admin may explicitly verify individual recorded allocations,
but cannot create payments, edit allocations, delete receipts, reverse
verification or automatically verify. Ordinary staff and Doctors have no
settlement finance access. MR Accounts replaces the old Payments demo; never
migrate fictional payment data or interpret demo IDs as ledger identities.

**Why:** The user's latest explicit instruction superseded the original
Admin-entry design, and later explicitly superseded only the prohibition on
verification while consolidating MR navigation into live Accounts.

**How to apply:** Keep the server boundary as strict as the UI and do not
interpret verification authority as settlement posting permission. Fulfillment
changes do not forgive debt or create credits; approved orders remain payable
through subsequent fulfillment stages when a known positive balance remains.

Previous payments start at zero, regardless of existing Paid/Partial/Unpaid
flags. Each selected order receives an explicit entered amount. Unknown saved
prices remain unavailable, not zero. New payments are Not verified (displayed
as Unverified). Verification is per allocation and never posts money again.
Opening receipts and reconstructed history are not authorized.

**Why:** The user explicitly confirmed zero previous payments and explicit
per-order allocation; older status flags are not transaction evidence.

**How to apply:** Use only saved authoritative totals and recorded settlements.
Never seed receipts from flags, demo data, current prices or Business Parking.
