# Business numbering

| Record | Format |
| --- | --- |
| Immunotherapy order | `IT-000001` |
| Kits order | `kit-000001` |
| SPT order | `spt-0000001` |
| Lupin order | `lup-000001` |
| IT suborder | `IT-000001A`, `IT-000001B`, …, `IT-000001Z`, `IT-000001AA` |
| MR login identifier | `MR-001` |
| Doctor number | `DR-001` |
| Staff Employee Code | `ST-001` |
| Patient code | `PAT-001` |
| Allergen code | `ALG-001` |

Padding is a minimum: 1,000 becomes `ST-1000`, not a truncated value.
Sequences are concurrent-safe PostgreSQL sequences. Failed transactions,
retained/deleted records and reserved identifiers can cause gaps. Issued numbers
are not recycled.

## Migration 0074_business_numbers

The predecessor is `0073_order_decisions`. This migration:

- Adds independent Staff Employee Code and Allergen sequences and a unique,
  non-null Allergen code.
- Converts the existing order numbers while retaining their numeric ordinals,
  UUIDs, dates, ownership, clinical values and financial values.
- Gives nonnumeric Patient codes generated `PAT` codes without changing Patient
  UUIDs, Doctor/MR assignments or clinical records.
- Converts current IT SUB identities to parent-number plus alphabetical ordinal.
  Previously removed ordinals are not reused. Immutable historical groups,
  audit copies and old idempotent responses remain historical, not rewritten.
- Assigns generated Staff Employee Codes through the established encrypted
  reservation path. Retired aliases remain reserved, but no longer sign in.
  Existing EVX account labels, password hashes and permissions are unchanged.
  Affected staff identities/sessions are invalidated through the existing path;
  the protected Super Admin is excluded.

It does not delete or truncate any business table. The transaction aborts on
unrecognized numbers, ambiguous suborder ordinals, duplicate target numbers,
unreadable encryption or identifier conflicts; it does not guess or reassign
another account's reserved identifiers. PostgreSQL rolls back the schema/data
changes on failure. Do not use `stamp` or manually delete reservations to retry.
The downgrade deliberately refuses to recycle business-number history.

Use the existing target-identity-checked development synchronizer or guarded
deployment runner; do not point an ad hoc migration command at another database.
The existing account, directory and Staff encryption/index keys must remain
available and unchanged. Production deployment is separate from development
activation and must use its existing CI/deployment safeguards.

## Staff creation

Leave `employeeCode` empty or null on creation. The server allocates it. Existing
Employee Codes are read-only in Staff Management; edits cannot replace them.
The separate `EVX-001` protected administrator label and `EVX-002` onward Staff
account labels are not Employee Codes and are unchanged.
