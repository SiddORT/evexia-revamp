# Staff identifiers and unified access

Staff editing and Access now persist the same `custom_role_id`. Lists, searches,
CSV exports and access summaries project the current role name from that stable
reference. A rename does not disconnect permissions. The legacy name snapshot is
retained only for reconciliation evidence, not as an independent source of grants.
Designation remains metadata.

Selecting a role never changes `workspace_login_enabled`. Existing passwords,
account IDs and relationship ownership are retained. Explicit permission or
identifier edits use the existing policy/user/profile locks, optimistic staff
version, audits and session invalidation.

## Forward migration and unresolved records

`0059_staff_unified_access` follows `0058_master_numbers`.

- A legacy label that uniquely matches a current role is linked only when there
  is no existing permission assignment or it already matches that same role.
- Missing/ambiguous labels and disagreements retain the existing permission
  assignment and are marked for explicit administrator resolution. Both forms
  explain this; Access can explicitly confirm a current role or No role.
- Pre-unification form versions are invalidated. Newly reconciled assignments
  invalidate their account identity versions and have system-attributed audit
  records, without fabricating a human updater.
- Email/code staging is bounded to 10,000 staff records, including retained deleted
  records. Above that bound all identifiers remain unresolved for explicit
  correction rather than scanning indefinitely. Missing codes, duplicate
  identifiers, incompatible normalization and existing reservations are not
  fabricated or overwritten. They do not prevent schema startup.
- Unresolved records remain visible with a login-identifier correction notice.
  Save valid, unique email/code values through Edit to establish both aliases.
  Deleted records cannot be edited through the directory; unresolved deleted
  history needs separately authorized operator correction.
- The ready-only Employee Code check/unique index stages constraints without
  rejecting unresolved legacy rows. API creates/edits always require a valid
  email and Employee Code; creates require a current role ID. Edits may explicitly
  clear the role, just as Access can select No role. Status/deletion and Access operations
  do not invent missing identifiers.

## Identifier namespace and encryption

Staff email and Employee Code share the existing account reservation namespace,
including Admin/MR identifiers and retained historical reservations. Alias writes
are serialized by the existing namespace transaction lock. Reservation ownership
is checked before either alias becomes usable; aliases retain only keyed lookup
digests, not plaintext identifiers.

The reservation `field` selects an encryption envelope, not the business meaning
of the identifier. Both new staff alias values use the established account
**email envelope**, authenticated to the existing account UUID; it accepts the
Employee Code length without changing historical account encryption contracts.
Existing account/history keys must remain available. No directory key rotation
should be represented as account-history rekeying.

Both aliases resolve to the original staff account and password. Generated
account usernames remain internal and are not a third staff login credential.
Ambiguous cross-account matches fail closed. Login still checks active/deleted
state, password setup, explicit login enablement and portal intent; the chosen
alias is checked again after acquiring the existing account lock.
Staff recovery and invitation guidance use the saved email, never the generated
username. No email is sent by staff save or migration.

## Verification and handoff limits

The user prohibited all tests, including browser checks, smoke scripts, release
runners and test-running completion hooks. None were added or run.

Performed only source compilation, API contract export/code generation, library
type checking and the direct portal Vite build (not the root release build).
A bounded, read-only legacy inspection loaded one staff row and found no missing
Employee Codes, ambiguous/missing role labels, role-assignment disagreements,
duplicate staff identifiers or cross-account reservation collisions.

No migration replay, runtime login/save scenario, browser check, service restart,
live email, production activation or deployment was performed. Runtime behavior
therefore remains unverified. The automatic development lifecycle will apply the
forward migration when this code is merged and the API is started.

Development source-integrity metadata is regenerated for the new revision.
The pre-existing production fresh-install review targets an earlier schema;
no new PostgreSQL catalog fingerprint or passing release evidence is claimed.
Regenerating that evidence requires separately authorized runtime work, outside
this source-only/no-tests handoff.
