# MR Doctor Management

## Delivery status

**Untested at the user's request.** Only source inspection was performed.
No automated suites, browser/manual scenarios, release checks, build/typecheck
commands or verification workflows were run. Managed services were not restarted:
their startup may trigger migrations or release checks outside this task's scope.

The existing Doctor HTTP routes and request/response schemas are reused.
No API contract shape or database schema changed; no contract regeneration or
migration is required by this change.

## Access boundary

- MR access is an explicit Doctor-only endpoint and service allowlist, not a
  master permission grant. Staff and Super Admin retain their existing policy.
- Every operation revalidates the authenticated account/session and its MR
  profile, then validates the current directory MR and primary Zone under the
  shared MR graph lock. Missing, deleted or inactive assignments fail closed.
- List totals, bounded encrypted search, pagination, filter choices, direct
  details and exports apply current-MR ownership before selecting records.
- Creates discard client assignment authority. Import review binds every row to
  the authenticated MR before validating and fingerprinting; commit revalidates
  the same current assignment. Uploaded MR/Zone values are ignored for MRs.
- MR imports create unverified records, as individual creation does. MR access
  does not include verification, editing, status changes, deletion or shifting.
- Registration uniqueness remains directory-wide. Reviews report only uploaded
  values and validation errors, not conflicting directory profiles.
- Existing transfer size/row limits, exact monetary/date parsing, transactional
  commit, actor attribution, generated numbers and download evidence are reused.

## User interface

My Doctors uses server records with list/grid views, status/search scope,
pagination and explicit bounded-search continuation. Add Doctor reuses the
shared form with a read-only saved MR name and derived Zone. Its MR wrapper
retains mounted drafts across session renewal and confirms dirty navigation.
CSV/XLSX sample, review, confirmation, results and exports reuse the shared
transfer workflow without Admin navigation. Account changes clear scoped state.

The Dashboard, Orders, Targets and Payments remain fictional, session-only
demos. They do not consume live Doctor records or their identifiers. Live Doctor
details expose no order/payment mutation links. Historical demo doctors are not
migrated or matched to live identities.

## Intentional limits

No real order/payment/target integration, doctor login provisioning,
MR edit/delete/reassignment, deployment, live email, data reset or migration
is included. Runtime behavior and cross-account isolation require separate
validation only if the user later authorizes it.
