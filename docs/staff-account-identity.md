# Staff account identity

## Changes and activation

The forward revision `0060_staff_account_numbers` follows
`0059_staff_unified_access`. It changes encrypted account usernames in place:
the protected Admin receives `EVX-001`; staff, including inactive and deleted
staff, receive numbers from `EVX-002`. New staff use the same PostgreSQL
sequence. Three digits are a minimum, not a limit (`EVX-1000` is valid).

The initial isolated implementation did not apply this change to a live database.
The development release declaration and reviewed source manifest target the new
revision. The next normal development synchronization/startup can apply this
automatic migration. Production activation remains a separate, approved
coordinated migration/release; no production operation or deployment was done.
Use the established migration runner, with the existing account decryption keys,
rather than executing the backfill as an HTTP request or ad-hoc account update.
On a fresh installation the migration creates the allocator and reserves the
Admin namespace; the existing bootstrap subsequently creates Admin with
`EVX-001` and its unchanged reserved email.

## Preservation and failure behavior

- The migration holds the staff-policy lock, shared account-namespace lock and
  write locks on account/reservation/alias/staff tables. Run it in the normal
  coordinated migration window, not against mixed old/new writers.
- Historical encrypted reservations and unresolved/deleted Employee Codes
  initialize the allocator beyond occupied EVX numbers. Conflicting numeric
  ownership, invalid account linkage, an occupied Admin number, unsupported
  numeric ranges or unreadable encryption stop the transaction for operator
  review. No account is recreated, no identifier is taken from another owner,
  and no conflicting record is silently skipped.
- Existing canonical EVX numbers remain assigned. Other staff are processed by
  saved creation time and profile UUID, never by mutable name, email or role.
  Alembic tracks the forward migration; the backfill also retains assigned EVX
  numbers and never decreases an existing sequence if revisited. Sequence
  allocation can leave gaps after failed transactions; gaps are intentional.
- All username changes use the validated encrypted `User` properties and normal
  reservation triggers. Old usernames remain reserved to their original owners.
  The protected Admin guard is temporarily narrowed to permit only its username
  update while write locks are held, then restored in the same transaction.
  A migration failure rolls back both data and trigger-definition changes.
  The independent legacy Staff trigger is likewise narrowed only for its
  username comparison during this locked backfill. Its UUID/profile checks stay
  active, and its exact original definition is restored before completion.
  Unexpected trigger definitions stop activation rather than being replaced.
- UUIDs, password hashes/setup state, Employee Codes, emails, roles, access flags,
  identity/token versions, session records and linked/history records are not
  rewritten. Account updated timestamps are preserved.
- `EVX-001` is rejected for non-Admin account identifiers and staff aliases even
  before a fresh-install Admin exists. Runtime allocations stop on an unexpected
  reservation/Employee Code collision, rather than retrying with another number.

Staff numbers are **not new staff login aliases**. Only the existing saved email
and Employee Code aliases authenticate staff; changing the username does not
populate the alias table. A manually entered Employee Code that already resembles
an EVX number remains an Employee Code, not a number-derived credential.
Protected Admin email sign-in is unchanged.

## Self-profile presentation

Login, refresh and current-user responses share three nullable staff-only display
fields: `staff_name`, `staff_designation`, and `staff_role`. The name is decrypted
from the signed-in staff profile only. Designation uses its saved relationship,
including retained definitions; role uses the authoritative current custom-role
relationship, never the legacy business label. Non-staff receive null details.
No staff directory permission or additional directory endpoint is granted.

The staff header and profile menu show the full name, designation and role with
wrapping and neutral fallbacks. Neither username, account number nor email is
used as a missing-name fallback. Session authorization, renewal/restoration,
navigation guards, keyboard menu handling and Log Out remain on their existing
paths. No Staff Management columns or credential labels were added.

## Verification limits

The initial isolated implementation used source inspection and diff review only.
The post-merge Staff identity-trigger correction was subsequently verified with:

```sh
sh scripts/test-api-foundation.sh tests/test_staff_number_migration.py tests/test_account_crypto.py
```

All 38 tests passed against disposable PostgreSQL, including a populated
0059-to-0060 upgrade, retained encrypted reservations/credentials, unchanged
login aliases, restored identity guards, rollback after an injected failure,
and rejection of an unexpected Staff guard definition.

The approved original-development post-merge synchronization then applied only
`0060_staff_account_numbers` successfully. Managed API startup reported the same
schema with no further pending migration, and the routed readiness endpoint
returned HTTP 200. The public Admin login page rendered normally; authenticated
UI flows and the full release gate were not run for this correction.
This is not evidence of production activation or production approval.
