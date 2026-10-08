---
name: Master permission scope
description: Intentional boundary of the restricted staff master permission rollout
---
Staff master access intentionally excludes Designation and all other unrequested
masters, View/Restore/password-reset grants, private Patient files/treatment,
Doctor payments, inventory, reporting and general identity/domain administration.
Fresh MR/Patient creation and linked Patient owner synchronization are narrow
workflow exceptions, not permission to promote unrelated legacy identities.

**Why:** The user explicitly requested only Headquarter, Zone, MR, Patient,
Doctor, Product Category, Storage Location and Courier Partner, with five
actions each and no automatic account or grant upgrades.

**How to apply:** Keep reference helpers minimal and authorize the consuming
workflow. Obtain explicit scope approval before adding permission domains,
generic provisioning powers or new recovery/deletion workflows.
