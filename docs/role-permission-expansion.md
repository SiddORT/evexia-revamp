# Role permission expansion — source implementation

This change is **untested and not runtime-verified**, at the user's request.
Source implementation and contract generation do not authorize activation.

## Approved boundary

The explicit catalogue covers sixteen Masters, Inventory, the four existing
order workflows and bounded User Management. Historical Master grant keys remain
unchanged. View is independent; existing Master action grants retain minimum
live read access without being rewritten or automatically upgraded.

Opening Stock has View/Add/Import/Export only. Product has no Assemble grant.
Inventory adjustment, initialization, protected batch configuration and assembly
remain protected. The catalogue defines no invented imports, approvals,
cancellations or unsupported deletions.

Staff access is separate from MR identity and relationships. Consumer reference
access must remain minimal. Role metadata changes must not change permissions,
detach staff, provision generic identities, enable login or change protected
principals. Change Role Permissions, Assign Role and Enable/Disable Login are
Super Admin-only.

## Explicit assignable catalogue

| Module | Resource | Supported actions | Count |
| --- | --- | --- | --- |
| Masters | Headquarter, Zone, MR, Patient, Doctor, Product Category, Storage Location, Courier Partner, Language, Designation, Allergen, Product, Vendor, Sales Target, Opening Balance | Each: View, Add, Edit, Delete, Import, Export | 90 |
| Masters | Opening Stock | View, Add, Import, Export | 4 |
| Inventory | Purchase Orders; Purchase Received | Each: View, Add, Edit, Delete, Export, Print / Download PDF, View History, View Activity, View Analytics | 18 |
| Inventory | Move Stocks | View, Create Movement, View Activity, View Analytics | 4 |
| Inventory | Stock Status | View, Export, View Stock History | 3 |
| Orders | Immunotherapy | View, Add, Edit, Import, Export, Upload Attachment, View / Download Attachment | 7 |
| Orders | SPT | View, Add, Edit, Import, Export | 5 |
| Orders | Kits & Consumables; Lupin | Each: View, Add, Import, Export, Upload Attachment, View / Download Attachment | 12 |
| User Management | Staff Management | View, Add, Edit, Delete, Activate / Deactivate | 5 |
| User Management | Staff Access | View Access | 1 |
| User Management | Roles | View, Add, Edit, Delete custom-role metadata | 4 |
| User Management | Permissions | View Permissions | 1 |

Totals: Masters **94**, Inventory **25**, Orders **24**, User Management **11**;
**154** assignable actions. Status changes use Master Edit. Unsupported actions
are absent or unavailable, not a Cartesian product of resources and verbs.
The three protected administrative capabilities are labelled Super Admin-only,
not checkboxes or part of these counts.

## Source integration reviewed

- `core/master_catalogue.py`, role schemas, persisted-role constraint source,
  `services/auth.py` and browser `auth/capabilities.js` share the explicit
  supported set. Existing grant keys remain stable; strict payloads reject
  protected and unsupported grants. Identity reconstruction uses the saved
  custom-role ID, active assignment and current role permissions.
- Master endpoint gates and locked service/transfer authorization distinguish
  read, mutations, status, samples, review/commit, exports and reconciliation.
  Product/Open Stock activity/analytics/assembly siblings retain protected
  checks. No Product action implies assembly, and no Opening Stock Edit/Delete
  capability exists.
- PO/PR and inventory gates use operation-specific capabilities. Consumer
  references expose workflow choices rather than administration of Vendor,
  Product, Location or Staff. Receiving batch read/allocation helpers require
  receiving Add/Edit; batch-setting writes, initialization, ledger adjustments
  and assembly retain protected authorization.
- PO exports use a complete bounded filtered snapshot, rejecting more than
  10,000 matches rather than silently truncating. Exact saved amounts and
  immutable line snapshots are retained. PR/movement existing arithmetic and
  stock posting rules are not reimplemented.
- PO/PR document delivery separately checks Print/Download PDF. Historical
  revisions also require View History before archive decryption; history alone
  does not release archived document bytes. Activity and analytics have their
  own gates and are not automatically fetched by read-only screens.
- Product, Opening Stock and PR durable retry responses carry the original
  operation's capability inside their encrypted response envelope. Reconciliation
  cannot use an unrelated write grant. Legacy protected responses remain
  protected; owner checks, original request digests and serialized cancellation
  retain their existing semantics.
- All four order routers/services distinguish staff capabilities from verified
  MR identity and its saved relationship/ownership rules. Existing editability,
  status and immutable snapshot rules remain in place. SPT's bounded standalone
  registration exception does not become generic account provisioning.
- Attachment upload and read/download are independent. Staff access checks saved
  order/file associations; unassociated drafts remain uploader- and workflow-
  scoped. Knowing a UUID or having Patient Master access is insufficient.
  Protected filenames are masked without Read Attachment, while opaque retained
  IDs allow unchanged associations to survive permitted edits/imports. Generic
  deletion/replacement/recovery and unrelated clinical files are not delegated.
- Staff and role services revalidate under policy-before-identity/domain locks.
  Delegated ordinary staff writes reject any supplied role assignment, including
  null/no-op assignment fields, and initial credential setup. Generated initial
  passwords are not returned to delegates; credential setup stays Super Admin-only.
  Strict request models reject login, permission and privileged-principal fields.
  Protected/system/nonstaff targets cannot be
  edited/deleted by delegates. Status does not change the separate login flag.
- Role metadata does not edit grants, detach staff or enable accounts. Version,
  soft-delete and retained-assignment checks remain. Permission details are
  redacted without View Permissions. The separate Staff Access directory returns
  bounded minimal access metadata without granting Staff Management.
- Frontend identity allowlists, request boundaries, sidebar/direct-route gates,
  read-only details and action controls follow the catalogue. The four compact
  searchable matrices retain explicit saves, group selection, conflicts and
  recovery; protected capabilities remain visibly restricted.
- An already-verified editor stays mounted, hidden and inert after a role/session
  revocation. Fresh password sign-in may recover it for the same owner after
  access is restored. A different owner or explicit navigation discards it.
  Cached editor identity never authorizes requests or restores a revoked bearer.

The authoritative API contract, generated React clients/types and Zod validators
were regenerated. Existing schema names, including the historical `ZoneAction`
name, are retained. Only the export script, Orval, generated-constant hoisting
and generated-output formatting were run; the package wrapper's type check was
not run.

## Execution and activation limitations

At the user's request, no tests, test additions, browser/manual scenarios, builds,
smoke requests, runtime probes, validation/release wrappers, service restarts,
migration execution, live role/data edits or deployment have been performed.
The work is **untested and not runtime-verified**. Source/diff inspection is not
evidence that a build, browser flow or deployed service works.

`0069_workspace_permissions` is a source-only additive constraint migration after
`0068_category_description`. It expands the explicit allowlist and limit without
editing any saved role, assignment or grant. Its downgrade refuses populated
expanded grants rather than silently removing them. Readiness and encryption
operator compatibility sources include the successor while retaining predecessor
probes and historical encrypted-field inventories.

The development contract names the new head, but the operator review manifest
intentionally still names the previously approved target. **No new migration
approval is implied.** Separately approved, coordinated schema/API/frontend
activation is required. An unchanged database constraint will reject expanded
grants; old workers/clients cannot be assumed compatible. Do not bypass schema
review, start/restart services or apply this migration on the basis of this task.
No current role, assignment or login has been upgraded or edited during this work.
New powers require an explicit future Super Admin save; no labels, seeds or bulk
upgrades supply them.
