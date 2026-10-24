# MR Doctor detail: profile and saved orders

The Doctor detail replaces its aggregate summary/type breakdown with a simple
saved-order list. My Doctors cards/table and main MR Orders listings are not
redesigned. Identity, clinic, location, masked contacts and configured terms
remain available. Terms are not balances, deadlines or credit utilization.

## Read contract

`GET /api/v1/admin/doctors/{doctor_id}/orders?limit=20&cursor=...` is MR-only.
It revalidates the authenticated identity and active MR, takes the shared graph
lock, checks the Doctor's current non-deleted assignment, and filters every
order branch by that Doctor and the authenticated MR. Browser MR IDs are not
accepted as authorization. Reassignment cannot expose another MR's historical
orders. Kits additionally requires Doctor supply; SPT excludes Draft and retains
Saved, In process and Rejected records.

The projection exposes only ID (for protected View navigation), saved business
number, kind, saved order date and canonical status. Historical Approved uses
the shared lifecycle compatibility as In process. This view never writes a
status or reads encrypted snapshots, pricing, contacts, attachments or audits.
Missing business numbers or unknown statuses fail explicitly, not as empty
history or invented labels. Existing saved-order routes remain authoritative
for detail access, edit locks and private attachments.

Page size is 1–50 (UI 20). Each of four SQL branches reads at most limit+1
projected rows; the merged result is also bounded to limit+1. Ordering is saved
order date descending, kind descending, ID descending. Opaque base64 JSON
continuation carries a version, Doctor/MR scope and last row key. It is not an
access token: scope and the saved anchor's membership/date are rechecked on
every request, followed by the same authorization predicates on every branch.
No full-history count or monetary snapshot scan occurs.

This is live keyset pagination, not a frozen historical snapshot. A changed or
removed anchor requires Refresh. Changes to other orders' saved dates can move
them between pages; Refresh explicitly restarts at the newest page. Next is
user-driven only, and Previous retains positions, not cached account data.

## Presentation and request ownership

The detail has equal-width profile columns from 1000px and one column below.
Definition labels/values are compact with wrapping; at 400px and below each
profile field stacks. Orders span both columns, use a fixed-layout wrapping
table, and become labeled stacked rows through 800px with explicit table roles.
View and paging actions retain the portal's 44px action size and focus outline.
Dates use the existing subscribed date preferences.

Loading, empty and failure are separate. Retry repeats the current position;
Refresh starts over. Responses are abortable, identity-guarded and tagged with
their request position. Account/MR or Doctor changes remount the order reader;
previous Doctor data cannot be rendered under a new Doctor route.

## Delivery limits

Source and diffs were inspected for authorization, bounded projections,
continuation validation, request races, MR route destinations and responsive
rules intended for 375, 768, 1024 and 1440px. **No tests were added, changed or
run.** No builds, typechecks, validation/release wrappers, browser automation,
API probes, migrations, record changes, service starts/restarts, deployments or
pushes were performed. FastAPI contract export, Orval client/validator
generation and generated-source formatting were performed without the package
wrapper's typecheck. These are source generation, not runtime verification.

No already-authenticated preview was accessible through the available manual
inspection controls. No actual manual preview resizing/inspection was performed;
responsive conclusions are source review only, not rendered-layout evidence.
