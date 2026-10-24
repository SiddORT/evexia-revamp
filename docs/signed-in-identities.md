# Signed-in account identities

The shared login, refresh and current-user projection returns an optional
`display_name`. For MR this decrypts only the name belonging to the authenticated
MR profile's explicit directory UUID; it grants no directory listing or admin
permission. Identity-only profiles have no inferred directory/name. Staff retain
their saved encrypted name, designation and actual saved custom role. The
protected account has no personal display-name field in the current schema;
its explicit fallback is **Super Admin**, never an invented person or email.

MR header, menu, greeting and Settings use the saved name. Profile blocks show
the actual saved login username underneath, not a formatted substitute.
Admin/staff header and menu likewise show name then the saved EVX account number;
staff designation and role follow. Missing names and account IDs have neutral
fallbacks. Text wraps and remains available to assistive technology.

## Forward MR conversion

`0070_mr_account_numbers` follows `0069_workspace_permissions` under the existing
automatic migration policy. It does not alter an applied migration or disable
any database guard.

- Explicitly directory-backed MR accounts with nonnumeric legacy usernames are
  converted in directory creation-time/UUID order, including inactive and
  soft-deleted entries so their allocated numbers remain retired.
- Existing valid `MR-` numbers with at least three digits remain byte-for-byte
  unchanged. Numbers expand past 999 using the existing durable sequence.
- Current accounts, encrypted historical reservations and retained Staff codes
  advance the high-water mark; an already higher sequence is never lowered.
  Old reservations remain with their owners. Conflicting numeric ownership,
  exhausted ranges, invalid linkage or noncanonical short numeric MR IDs stop
  the transaction for explicit review, without guessing or recycling.
- Identity-only MR profiles remain unchanged; the migration reports their count
  for explicit ownership review without logging their personal information.
- Renaming uses the encrypted User setter and namespace/reservation triggers.
  Password hashes, UUID relationships, Employee Codes, permissions and historical
  records stay intact. Renamed accounts increment identity/token versions,
  revoke their sessions with the existing identity-change mechanism and increment
  the directory edit version so old drafts cannot undo the new login ID.
  Those users must sign in again using the saved numbered ID (or their existing
  valid email); old usernames are reserved history, not new login aliases.
- Existing MR projections, credential responses and exports already read the
  saved account username and therefore return the real new numbered login.

## Delivery limits

This is source-inspected implementation, not operational acceptance. No tests
were added, modified or run. No builds, browser/manual smoke scenarios, runtime
verification, release checks, workflow restarts, operational migration execution,
production access or deployment were performed. Source contract generation and
development integrity metadata generation do not activate a database schema.
No live records were inspected, so the number or identities of records needing
review are unknown.

The production fresh-install catalog cannot be honestly regenerated under this
source-only constraint: its generator requires a reproduced PostgreSQL catalog.
Existing fresh-install evidence must not be relabeled as evidence for this
revision. Fresh-install release catalog/readiness verification remains a separate
authorized step, not a completed check.
