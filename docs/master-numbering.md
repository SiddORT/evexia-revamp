# Master numbering

New Patient creates and blank-ID Patient imports receive `PAT-001`, `PAT-002`,
and so on. New Doctors receive a separate `DR-001` sequence, independent of their
medical Registration Number. New MR creates and blank-User-ID MR imports receive
`MR-001`, etc. **The MR number is the actual login User ID**, not employee code.
Each sequence expands naturally beyond 999. UUID relationships are unchanged.

Only the authoritative create/commit path allocates a number. Opening forms,
the compatibility username endpoint, import reviews and MR password preflight
do not allocate or promise one. Successful MR credentials contain the saved ID.
Generated MR login IDs cannot be renamed. Doctor numbers and Patient IDs are
read-only; profile edits never generate replacements.

PostgreSQL sequences survive restarts and rollback. All directory creates,
edits and imports retain the shared graph lock; authored numeric imports advance
their sequence before generated rows in the same batch. Collisions still fail
against retained records and encrypted case-insensitive login reservations.
Failed operations can consume numbers. Never reset counters or erase account
reservations to eliminate gaps, and never use a record count to allocate IDs.

## Existing records and transfers

The additive migration seeds counters above existing numeric Patient codes and
all matching encrypted login reservations, including historical identities.
Historical Doctors receive deterministic Doctor numbers in creation/UUID order.
Existing Patient codes, MR login IDs, medical registrations and employee codes
are retained. No current records need clearing to introduce the new sequences;
no deletion, session revocation or bulk-delete command is part of this change.

Existing explicitly authored Patient IDs and MR User IDs remain supported by
their create-only import contracts, including historical nonnumeric identities.
Blank IDs allocate on commit. Doctor Number is a read-only export column:
re-import accepts it for compatibility but newly created Doctors get a fresh
server number, not a client-selected identity. Medical registration continues to
resolve portable Doctor relationships. Previously exported full schemas remain
accepted. CSV and XLSX retain UUID relationship semantics where applicable.

The development migration head is coordinated through development-contract.json.
The existing development lifecycle activates migrations; no production rollout
or cross-environment record cleanup is authorized here.

## Verification boundary

No tests were added, changed or executed for this work. Contract generation,
source syntax checks, read-only database observations and the public preview
are not evidence of tested concurrent creation, import or authentication flows.
