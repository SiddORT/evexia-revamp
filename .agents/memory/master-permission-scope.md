---
name: Master permission scope
description: Approved staff permission scope and administrative exclusions
---
The user approved permission coverage for all sixteen existing Masters,
Inventory, the four existing order workflows and bounded User Management.
This supersedes the former eight-master-only boundary. Independent View is
approved; unsupported operations are not. Product permissions explicitly exclude
Assemble, and no Product Add/Edit/Import grant may imply assembly authority.

**Why:** The user approved the expanded list with the correction to exclude
Assemble from Product Master permissions.

**How to apply:** Keep existing grant keys and saved assignments without bulk
upgrades. Preserve minimum read/reference access for existing Master action
grants. Reference helpers authorize only the consuming workflow, never unrelated
directory administration, account provisioning, clinical/payment history,
settings or reporting. Keep MR identity/relationship and private-file ownership
restrictions distinct from staff grants.

Change Role Permissions, Assign Role, Enable/Disable Login, protected system
account administration and manual stock adjustments remain Super Admin-only.
Custom role metadata CRUD must not modify permissions or detach assignments.

**Why:** The user explicitly retained these sensitive operations as protected
while approving ordinary staff/custom-role metadata delegation.

**How to apply:** Check both request fields and locked service boundaries;
business designations and role-name copies never confer access.

External permission-editor screenshots are layout references only, not authority
to copy their branding, roles, counts, modules or action catalogue.

**Why:** The user requested the compact reference layout, not permission or
branding choices copied from the reference.

**How to apply:** Derive matrix rows, action headings and counts from the existing
catalogue and live selected role, even when changing the editor presentation.
