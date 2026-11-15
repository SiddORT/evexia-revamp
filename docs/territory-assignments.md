# MR and Doctor territory assignments

## Responsibility and access

MR responsibility is explicit: `zone` covers the entire selected Zone; `hq`
covers every Area of the selected HQs; `area` covers only the selected Areas.
An HQ selected alongside explicit Areas grants no additional whole-HQ coverage.
The compatibility `hq` scalar is the first selected HQ, or null for whole-Zone
coverage. It is not a complete responsibility definition. The retained
`zoneIds` collection is exactly `[zoneId]` after reviewed adoption.

Doctor location is one saved Zone, one HQ and one Area. New Doctors and changed
location/MR assignments require the complete active hierarchy and an active MR
covering that exact location. All three coverage levels are offered together,
without specificity ranking or automatic selection. Search, paging and saved
hydration apply the same predicate. Incomplete locations return no assignment
choices. Generic list filters and bulk-shift candidate browsing remain separate;
bulk confirmation checks every selected Doctor's exact saved location.

Territory never grants Doctor visibility. MR reads remain owner-only; MR-created
Doctors always use the authenticated MR, regardless of the submitted owner.
Existing Staff permissions, version checks, Patient reassignment consequences
and immutable order snapshots remain unchanged. Coverage edits do not reassign
Doctors, Patients or historical orders.

Whole-Zone MRs have no scalar HQ. Sales Target compatibility projections accept
that null and display no assigned HQ instead of dropping saved targets through
an inner join, inventing a HQ, or changing the target amounts.

## Legacy records

The forward migration leaves existing MR scope null and new membership arrays
empty. Existing Zone memberships and primary HQ are retained. Null means
**unreviewed legacy responsibility**, not whole-Zone or whole-HQ authority.
Unrelated edits preserve omitted additive fields. Changing a legacy MR's
territory requires explicit adoption in the form; it starts with no invented
Zone/HQ/Area choices.

Existing Doctors receive null location fields. Read APIs and the editor expose
this as incomplete legacy location, not a location derived from addresses or MR
coverage. Unchanged historical assignments can be retained even if coverage has
subsequently changed. An explicit reassignment or location change must satisfy
the new rule. No records are automatically collapsed, relocated or reassigned.

## Server boundary and concurrency

`app/services/territories.py` owns hierarchy validation and the shared SQL
eligibility predicate. Both MR coverage writes and Doctor assignment writes run
under the existing MR graph transaction lock; catalogue parent rows are locked
through commit for changed assignments. Cross-Zone HQs, cross-HQ Areas, duplicate
memberships, mismatched explicit scope and out-of-coverage MR assignments are
rejected before committing. Existing optimistic versions remain mandatory.

The bounded territory-choice endpoints are consuming-Master authorized. They
do not grant access to the geographic masters. Parent scope applies even to
saved-choice hydration. Doctor `/references?assignment_only=true` requires
complete `zone_id`, `hq_id`, `area_id`; without assignment mode this endpoint
retains its old directory-filter role.

## Transfers

Current MR files add Coverage Scope, Headquarter IDs JSON and Area IDs JSON.
UUID arrays preserve exact stable memberships; blank scope explicitly preserves
legacy import treatment. Historical supported full MR header sets remain valid.
The sample demonstrates deliberate whole-Zone scope.

Doctor files add Territory Zone ID, Territory HQ ID, Territory Area ID and
Location Intent. `reviewed` requires a complete eligible location; `legacy`
requires all three location fields blank. Supported historical full headers are
treated as legacy without inferring location. Exports mark each row explicitly.
Imports stay create-only with reviewed confirmation and existing bounds;
the revision never provides bulk historical adoption or reassignment.

## Source and activation handoff

`0106_territory_assignments` follows the merged pricing-status development branch and adds
nullable legacy-preserving fields plus shape constraints. The DDL-free
`0107_territory_staged_merge` keeps the separate source branches joined without
advancing the development target into unrelated staged work. Migration policy
remains automatic; no per-migration approval exception was added.

This task did not apply either migration, start/restart workflows, run release
or regression checks, make live-data writes, access production or deploy.
Offline scoped OpenAPI/client generation, metadata generation, syntax parsing
and source-level contract inspection are not runtime verification. Builds,
typechecks, database integration/concurrency checks, browser flows and visual
verification were not performed. The prepared source must be integrated with
the database/API/frontend through the normal authorized lifecycle before use;
this handoff does not claim runtime activation.
