# Doctor Master: live directory and transfer contract

## Live and local boundaries

Doctor Master list, Add/Edit, prepared Doctor import, filtered exports and MR
Master's associated-doctor viewer use authenticated FastAPI/PostgreSQL records.
The protected system Super Admin and explicitly enabled staff with the
corresponding Doctor grants may use Doctor APIs. MR tokens, ordinary staff
and unrelated Zone grants give no general Doctor access.

## Directory deletion and rollout

Forward `0028_directory_soft_delete` follows the accepted
`0027_mr_designation_identity` head. It adds only nullable timezone-aware
`deleted_at` and UUID `deleted_by` with a non-cascading User foreign key to
Doctor and Patient directories. Existing rows start with NULL metadata; IDs,
business values, global uniqueness, assignments, timestamps and files stay intact.
Readiness requires these fields. Obtain separate operator approval and a verified
coordinated backup, stop writes and release schema/API/frontend together. No
managed migration or deployment is performed by this feature.

`POST /api/v1/admin/doctors/{id}/delete` accepts only `expected_version`.
The authenticated actor and UTC timestamp are server-owned. It requires
`doctor.delete` (or protected Super Admin), not Edit. Graph locking, current
identity checks, version/update metadata and a `doctor_directory_delete` audit
commit atomically. Stale versions reject; repeated or ordinary tombstone
detail/edit/status/contact/bulk targets return not found.

Deletion removes Doctors from ordinary listings, counts, searches, exports,
filter values, Patient/Opening Balance pickers and MR-associated Doctor pages.
It does not change status, reassign Patients or delete balances. Existing saved
references retain their IDs and readable labels with an unavailable warning;
an unchanged saved relationship can remain, but deleted Doctors cannot be newly
assigned. Reviewed imports revalidate availability at commit. Registration
numbers remain globally reserved after deletion. There is no trash, restore,
purge or bulk-delete interface. Confirmations never replay a lost response.

Downgrade drops deletion metadata only, losing attribution and making retained
rows live again; it never deletes directory/identity/file rows. Do not treat this
as a safe application-only rollback. Prefer a reviewed forward fix or a verified
coordinated restore and obtain separate approval before any managed downgrade.

Focused regressions use disposable fixtures:
`sh scripts/test-api-foundation.sh tests/test_directory_deletion.py
tests/test_migration_directory_deletion.py tests/test_patient_files.py
tests/test_master_permissions.py`. Run the guarded desktop/mobile confirmation
suite with `sh scripts/run-authenticated-previews.sh
artifacts/evexia-portal/tests/directory-deletion.preview.spec.mjs`.

Migration `0019_doctor_directory` follows `0018_mr_directory` and creates an
**empty** table. It does not migrate, mirror, overwrite or promote any local
Doctor, MR, Patient, Opening Balance, Sales Target or payment data.
Doctor's MR foreign key uses the landed server MRDirectory ID, which is the
existing one-to-one MRProfile ID. No alternate identity model is introduced.
Zone is derived from the live MR assignment and cannot be independently written.

Legacy Patient/Opening Balance datasets, Sales Target and payment previews retain
their original browser-local services and IDs. The new shared Opening Balance
register references server Doctors explicitly; it never mirrors those legacy
balances. See [Opening Balance operations](opening-balance-master.md).
Live Doctor payment navigation authenticates the
server Doctor ID and shows an honest unavailable-ledger boundary. It never joins
that ID to local payments or opening balances, even if an ID happens to match.
Doctor login/password provisioning remains unavailable; password controls stay
disabled. Days/payment limits are business settings, not a live credit ledger,
payment history or order-blocking policy.

## Fields, validation and concurrency

The four existing tabs retain identity/contact, clinic/assignment, commercial
details and address. All enabled fields are saved. Name, qualification,
registration, MR, postal address line 1, landmark, country/state/city are required.
Registration uniqueness is enforced using lowercased, trimmed database values.
Phones use their selected IN/US/GB/AE dialing country; alternate phone follows
the same length rule. Required contact means both phone and email; optional
contact permits either/both to be blank. Joining dates are real non-future dates.
GST invoices require a GST number; India uses 15 alphanumeric characters.

Order discount is an exact two-place decimal `0..100`; payment limit is an exact
two-place decimal `0..9999999999999.99`. Days limit is a whole number
`0..2147483647`. Blank optional commercial values mean zero. No float rounding
is used for persisted monetary values or workbook numeric XML validation.
API money inputs must use decimal strings (or exact integers), never JSON
floating-point numbers whose original fractional precision could already be lost.
New/reassigned doctors need an active MR with an active, nondeleted server Zone.
An unchanged inactive MR/Zone assignment may be retained. Deleted/missing MR or
Zone is explicitly shown and must be corrected before saving assignment-dependent
changes. MR choices traverse every server page and include the saved assignment.

Every mutation supplies an expected version. Selection/confirmation retains
the versions actually selected, not newly fetched replacements. Bulk verification
and MR shifts validate all IDs, all expected versions and all assignments before
writing anything; conflicts roll back the entire operation and audit events.
MR graph locking is shared with MR writers. Created/updated names, timestamps
and audit attribution belong to the server, not to the browser or uploaded file.

Search covers name, phone, registration, clinic, qualification, email and MR
name. Status, Zone, MR and state filters, counts and pagination run against the
whole directory. Missing/deleted assignments have explicit filter choices.
CSV/XLSX exports use the identical predicates, never only the fetched page.

## PIN assistance and drafts

Changed six-digit Indian PINs use the authenticated same-origin MR postal
service, not a browser-to-provider request. A current successful response fills
country, state and city automatically. The fixed provider's district is used as
city when it has no city value. Different returned locations offer immediate
selection; no Apply step is needed.

Existing edit addresses are not re-looked-up just because the form mounted.
Debounce, abort, draft/request identity and manual-address revision checks
prevent late results overwriting a newer PIN, another Doctor or manual edits.
Failures and empty results keep manual entry available, including foreign postal
codes. PIN availability is independent from saving a manually valid address.
Same-identity recoverable renewal keeps mounted drafts; definitive logout or
identity changes clear protected data. Uncertain writes are not replayed.
Explicit saved-record reload asks before discarding an existing draft.

## Prepared transfers and older backups

Use `/admin/masters/import/doctor`, with Doctor selected in the existing prepared
master-import layout, CSV/XLSX samples, filename, pending and valid/invalid reports.
Review saves nothing. Explicit confirmation creates an entirely valid batch;
there are no upserts or partial imports. A replacement file or failed/conflicting
confirmation consumes the review. Inspect the directory before re-reviewing
an uncertain outcome.

Limits: nonempty files up to 2 MiB; 1,000 records; 33 columns; 10,000 characters
per cell; bounded inert ZIP/XML parsing (no formulas, macros, links or embeds).
Workbook decimal validation uses original numeric XML lexemes, not rounded
parser floats. Exports are limited to 5,000 current filter matches.
CSV is UTF-8/BOM; Excel downloads are genuine `.xlsx` workbooks, not renamed CSV.
XLSX business fields are text cells. CSV numeric-looking phone, registration,
licence/GST and postal identifiers have an apostrophe text marker that the
Doctor importer explicitly understands; formula-like text is escaped too.

The earlier full 28-column Doctor business CSV remains accepted, as does the
older 27-column full CSV without Contact Requirement (default: optional).
Optional trailing `Created By, Created At, Updated By, Updated At` columns are
accepted but never trusted as attribution. Current exports additionally include
`MR Name`; `Assigned MR` carries an explicit `user:username` reference and `Zone`
contains the live Zone label. The export's MR Name label is informational, not
an assignment authority. Blank commercial values default to zero; blank
verification defaults to unverified; blank dialing country defaults to IN.

Resolve Assigned MR by exact live server UUID, exact unique display name,
employee code or username; `user:username` and `employee:code` disambiguate
namespaces. No local-ID lookup or guessed identity mapping is allowed.
Ambiguous names, inactive/new assignments, incompatible Zone labels and unknown
references are rejected. Older local full exports can be reviewed after an
operator explicitly maps their references to real server MRs. The small mock
Excel preview schema is not a compatible full business backup.

The review digest binds file bytes, filename, authenticated identity/session
and validated MR/Zone versions. Commit revalidates duplicate registrations,
references and actor authority while holding the same graph lock. Samples and
exports require durable server download-log acceptance before file handoff.
The format dropdown supports keyboard use, Escape, outside dismissal and
return focus. Neither files nor review reports contain credentials.

## Verification and operator rollout

- API/migrations: `sh scripts/test-api-foundation.sh tests/test_doctors.py tests/test_migration_doctors.py`
- Transport/legacy contract: `node --test artifacts/evexia-portal/src/services/serverDoctors.test.js`
- Browser: `sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/doctors-backend.preview.spec.mjs artifacts/evexia-portal/tests/mrs-backend.preview.spec.mjs`
- Contract/codegen: `python3 scripts/export-api-contract.py` then `pnpm --filter @workspace/api-spec run codegen`
- Build: `pnpm --filter @workspace/evexia-portal run build`

Tests use separate synthetic databases, API/browser listeners and result folders.
The default release harness runs MR credential flows in their own private
fixture: Doctor test setup must not exhaust the MR suite's real hourly credential
budget. Production limits and credential audit history remain unchanged.
Freeze source during browser passes; never apply fixture migrations or synthetic
credentials to a managed database. An operator-approved normal Alembic upgrade
is needed for an older configured database. No deployment or managed-database
migration is implied by this feature. After rollout/merge, separately confirm
the real service's liveness and database readiness; passing synthetic tests
cannot establish configured-database readiness.
