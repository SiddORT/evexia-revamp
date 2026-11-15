# Doctor MR Mapping — prepared source and isolated presentation inspection

## Scope and access

The separate Admin destination is `/admin/masters/doctor-mr-mapping`. It uses
existing Doctor read/edit permissions, sidebar grouping, Admin layout, themes,
searchable controls, modal focus handling, badges and pagination. This does not
grant MRs access to Admin mapping endpoints, history or other MRs' Doctors.

Both tabs use the same server-filtered, bounded Doctor result page. MR-wise groups
are explicitly page-local, may continue on later pages, and support selecting an
explicit subset of at most 100 Doctors. No “select every matching Doctor” or
automatic whole-directory traversal was introduced.

Doctor Area is a saved `headquarter_areas` reference, nullable for retained legacy
Doctors and explicit mapping clears. Its selector
shows the Area code and parent Headquarter. Existing Doctors begin unset; no
postal field supplies a backfill. Area correction does not edit postal
addresses, assign MR coverage, or change ownership. Current MR HQ and Zone
filters retain MR geography semantics; Zone matches the MR's saved multi-zone
membership. Doctor Active/Inactive is separate from displayed MR status.

### Integration with concurrently merged territory work

The newer main project already introduced the authoritative exact Doctor
Zone/HQ/Area tuple and explicit MR coverage. This feature reuses that single Area,
not a duplicate mapping-only field. Area correction retains its parent HQ/Zone
consistently and validates the already-approved coverage rules without granting
or expanding MR coverage. Current-MR HQ/Zone mapping filters remain separate from
the Doctor's own exact location.

The existing new-Doctor location-selection workflow is preserved rather than
replaced by a second optional Area input. Existing Doctors remain honestly
unset unless explicitly corrected. A locationless legacy Doctor's new MR can
be reviewed together with its full location in Edit Doctor; mapping transfers
fail explicitly if saved location or existing destination coverage is unusable.

Area, HQ, Zone and Doctor references are searchable bounded reads with explicit
continuation and saved-value hydration. MR uses the existing bounded MR selector.
All six filters are combined in PostgreSQL before result pagination. Encrypted
Doctor-name reference search retains the existing bounded secure-scan protocol.

## Writes and immutable evidence

Shared assignment handling is called by ordinary Doctor edit, bulk shift and the
new page. Doctor creation and create-only imports record prospective initial
assignment evidence. Actual transfers require a meaningful 10–1000-character
reason and an active/usable destination; same-MR rows are excluded without a
transfer event. The review shows old/new identities, affected Doctors, and that
linked Patients move atomically while saved orders, payments and historical
documents do not change.

Existing graph locking, optimistic Doctor versions, Patient row ownership checks
and audit attribution remain in place. Every selected Doctor is checked before
any movement. Transfer, Patient changes and encrypted history commit or roll back
together. A separate Area version prevents an Area correction from being lost to
an unrelated Doctor form save. The concurrently merged exact-location editor
also supplies the Area version and a meaningful correction reason, using the
same shared append-only Area behavior rather than bypassing it.
Stale/uncertain responses block saving until current-state review, rather than
automatically resending writes. Mounted reason/Area drafts are retained.

The timeline encrypts Doctor and old/new MR identity snapshots, old/new Area and
parent-HQ labels, actual authenticated actor name/account, and free-text reason
using a distinct Directory-key archive namespace. User/account UUIDs remain
available inside protected snapshots to distinguish later renames/deactivation.
No plaintext sensitive snapshot or reason index was added.

The migration captures every existing Doctor, including tombstones, as an honest
opening/current-state baseline: original actor, assignment date and reason are
unknown. The baseline recording time is never presented as an original assignment
time. Subsequent initial/transfer/Area events are protected against UPDATE, DELETE
and TRUNCATE. Keep historical Directory decryption keys: ordinary directory
rotation authenticates/counts archive usage but does not rewrite immutable events.

Doctor backup exports retain the concurrently merged `Territory Area ID`. Previously exported
full CSV/XLSX shapes remain accepted; absent Area means unset. Imports remain
create-only, validate Area availability, and cannot transfer existing Doctors.

## Prepared schema boundary

`0108_doctor_mr_mapping` follows the approved
`0106_territory_assignments` path, already approved on main. `0109_mapping_staged_merge` is a DDL-free join
with the separately staged predecessor ancestry; it is not the development
target and does not activate unrelated scheduler/designation work.

Development declarations, migration source fingerprints, protected account
compatibility and readiness include the exact successor. Mapping readiness
inherits predecessor probes and checks Area columns and immutable history guards.
The migration locks the Directory crypto state and refuses paused/unverified
maintenance before adding archive evidence. Complete any pending Directory
maintenance before an approved future mapping migration.

**No migration was applied. No managed service was started/restarted. No
production write, deployment, release check, regression suite, typecheck or
completion-validation command was run.** OpenAPI was scoped-exported from source
and generated clients/validators were regenerated and formatted without the
usual codegen script's chained typecheck.

## Page-specific responsive inspection

Run only the isolated presentation harness, not a release/browser-test wrapper:

```sh
node scripts/inspect-doctor-mapping-layout.mjs
```

It bundles the actual `DoctorMRMapping`, `AdminLayout`, reference controls,
transfer/Area/history dialogs and page styles with synthetic read-only service
adapters. It starts an unregistered ephemeral `127.0.0.1` static listener, denies
API and non-GET access, and blocks external browser requests. It uses no session
credentials or database and closes its listener/browser on completion. Generated
evidence is ignored under `generated-artifacts/doctor-mapping-layout/`.

The completed Chromium presentation pass recorded **93 state/geometry/focus
observations**, covering:

- 390×900 phone, 768×900 tablet and 1440×900 desktop CSS viewports;
- Classic/Modern themes and light/dark appearances;
- Doctor-wise and MR-wise tabs, long Doctor/MR/Area/HQ/Zone names;
- destination-selected transfer review and long reason, Area correction, and
  history with baseline and long historical reason;
- loading, empty and error presentation at all three widths;
- transfer-dialog Tab containment, Escape close and trigger focus restoration.

Final observations: no browser script errors, no measured page-level horizontal
overflow, no failed measured Tab-containment or focus-return observations.
Visual inspection found and corrected tablet grid auto-placement that previously
put MR text in the checkbox column; fixed-width review columns also keep all
three identities readable on phones. Modal contents remain vertically scrollable.

External Google Fonts requests were intentionally blocked, so this evidence uses
font fallbacks. This is not native-device, Safari/Firefox, screen-reader,
enlarged-text or live authorization evidence. The legacy Doctor edit/bulk-entry
changes were source-inspected but are not claimed as browser-verified by this
page-only harness.

## Runtime-unverified behavior

Live migration/baseline construction, PostgreSQL constraints/lock ordering,
concurrent transfer and Area writes, linked-Patient atomicity, rollback paths,
permission revocation, ambiguous-response reconciliation, retained-key recovery,
large-directory query plans and CSV/XLSX import/export execution have not been
run. These require separately authorized isolated runtime verification before
activation; the static fixture is not a substitute.
