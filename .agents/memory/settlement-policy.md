---
name: Settlement policy
description: User-approved MR posting, read-only Admin and zero-history financial scope.
---
Only authenticated MRs record settlements against their own saved orders.
Admin retains the Super Admin read-only boundary: no creating, editing,
deleting or verifying payments. MR's older Payments demo remains separate.

**Why:** The user's latest explicit instruction superseded the original
Admin-entry design without granting staff or Doctor finance access.

**How to apply:** Keep the server boundary as strict as the UI and do not
interpret Super Admin authority elsewhere as settlement posting permission.

Previous payments start at zero, regardless of existing Paid/Partial/Unpaid
flags. Each selected order receives an explicit entered amount. Unknown saved
prices remain unavailable, not zero. New payments are Not verified; verification
approval, opening receipts and reconstructed history are not authorized.

**Why:** The user explicitly confirmed zero previous payments and explicit
per-order allocation; older status flags are not transaction evidence.

**How to apply:** Use only saved authoritative totals and recorded settlements.
Never seed receipts from flags, demo data, current prices or Business Parking.
