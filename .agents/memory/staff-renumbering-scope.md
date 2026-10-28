---
name: Staff renumbering approval
description: Scope of the user's approval to replace generated staff account usernames
---

The user explicitly approved renumbering both existing and new staff account
usernames, reserving EVX-001 for protected Admin and EVX-002 onward for staff.
EVX account-label approval does not authorize renumbering MR, Doctor or Patient
identities or adding EVX-based staff login. The user subsequently requested
`ST-001` onward for Employee Codes specifically; see
`identifier-format-requirements.md` for that separate business-number scope.

**Why:** The long generated account username was distinct from the separately
entered Employee Code; the user confirmed changing the former, not the latter.

**How to apply:** Keep account-label maintenance separate from business codes,
credentials and permission/access changes. Operational production activation
requires separate approval; implementing a migration is not permission to run it.
