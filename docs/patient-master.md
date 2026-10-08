# Patient Master operations and transfer contract

## Rollout and privacy

Patient Master is now a shared PostgreSQL directory, not a local preview. Apply
`0020_patient_directory` after `0019_doctor_directory` **only with operator approval**
and a normal database backup/change window. No deployment, managed migration,
real-account change or managed test seeding is performed by this implementation.
The forward migration creates an empty, one-to-one extension of `patients`.
Existing identity-only owners, files, active states, versions and history are
unchanged and not promoted into this directory. Readiness requires the new schema.
Local Patient/Doctor/MR datasets are untouched and remain exclusively available
to legacy consumers. There is no automatic migration, mirror, sample seeding or
local fallback. Configure live Zone, Headquarter, MR and Doctor first.

Only the protected singleton system Super Admin with `admin.access` and current
policy can use `/api/v1/admin/patients`. Creation additionally requires
`domain.provision`; ownership changes require `domain.assign_patient`. Other
staff permissions, business labels and Doctor/MR identities cannot grant Patient
directory access. Files retain their existing object-policy authorization.
Responses and downloads are no-store. Audit events contain resource UUID,
operation, actor and UTC time, never submitted clinical/contact/address fields.
Browser activity contains only fixed action/resource labels, not record contents.
Never log import bytes or response bodies. This does not add Patient login,
clinical treatment, orders, payments or attachment UI.

## Fields and identities

The directory retains every enabled field in the three-tab form. Email and
Address Line 2 are optional; the others are required. Gender is `male`, `female`,
`other` or the explicitly supported legacy `prefer not to say`; imported gender
and status labels are case-normalized, not guessed or silently mapped.
DOB is a real ISO `YYYY-MM-DD` date-only value, never a future date according to
**Asia/Kolkata** business today (independent of browser/host timezone). Age is
derived for presentation, never stored. Created/updated timestamps are UTC,
with actors supplied exclusively by the verified server identity.

Phone is a normalized national-number string plus independent `Dial Country`.
Shared supported rules: IN/US/GB require 10 digits, AE 9. New forms default IN;
changing the dialing selector never rewrites entered digits. Country is postal
country, not dialing country. Displays and exports prepend +91/+1/+44/+971.
Legacy national ten-digit phones explicitly default IN. Prefixes matching the
chosen dialing country are decoded on import; arbitrary prefixes are rejected.
Leading national zeros are preserved. Required lengths: name 200, phone 20,
email 320, language 100, address lines 300, landmark 200, city/state/country 100.
Indian postcodes are six digits; other countries accept 2–12 alphanumeric,
space/hyphen postal codes. No uploaded age or other inferred clinical data.

The backend UUID is the existing file owner identity. The business code is a
separate unique generated `PAT-` code. Explicit imports may retain unique
`PAT-[A-Z0-9-]{2,60}` codes (including all previously supported legacy codes);
blank codes generate fresh ones. Database constraints protect code uniqueness
and the composite case-insensitive trimmed name + normalized international
phone (dial country/national digits) + DOB duplicate rule. Name, phone and email
are **not** independently unique. Mutations accept only business fields and a
required `expected_version`, never caller identity/ownership/audit/deletion fields.

## Relationships, transactions and files

Patient Doctor selectors search/page the live directory with bounded pages;
selected inactive references remain visible with a warning. New or changed
assignments require an active Doctor with a usable active MR/Zone/account chain.
Unchanged inactive relationships may be retained; missing/deleted references
require explicit repair, never automatic reassignment. Status deactivation
remains possible even with broken references to close file access safely.
Doctor/MR/Zone labels are derived from current server relationships, not imports.
Directory search, status/MR/Zone predicates and stable newest-first pagination
run server-side; counts and full-filter exports use the same predicates.

### Large directories and reference choices

List pages and full-filter exports build one request-local projection context.
Authoritative Patient versions, Doctor registration/name/status, MR and Zone
name/lifecycle state, and actor labels are read in batches of at most 500 keys.
Only the scalar reference columns needed for display are loaded; projecting
individual records performs no further database reads. These contexts are never
cached across requests, sessions or mutations. Missing/deleted/inactive
references retain the existing blank labels and explicit repair/retention
warnings. Mutation ownership locks and expected-version checks are unchanged.
Doctor choices use the same relationship warnings, including an explicitly
requested saved inactive Doctor outside the search page.

`GET /api/v1/admin/patients/filters` returns every non-deleted MR's compact
ID/name/status and current non-deleted Zone ID/name (including inactive choices).
It uses one ordered outer-join query, capped at **10,000 MR choices**, plus one
sentinel row. Exceeding the cap returns `409 patient_filter_limit` without a
partial response. It requires the same freshly verified protected Super Admin
as the Patient directory and is no-store. Deleted Zones have blank labels;
deleted MRs are omitted. The explicit Missing filters still use the existing
server predicates. The Doctor assignment selector remains searchable and
paginated at 100 rows maximum; this compact endpoint is for MR/Zone filters,
not assignment authority.

The Patient hook loads these filter choices once per mount, explicit refresh,
or successful mutation, rather than fetching every MR page on each search or
pagination change. Mounted choices are not persisted or shared between users;
identity changes clear them and delayed responses are rejected. Reference
failure blocks use with an explicit retry, never a browser-local fallback.

Synthetic PostgreSQL measurements (isolated ephemeral test database; 5,001
Patients, 501 distinct Doctors, shared MR/Zone; counts include API auth and
download bookkeeping, timings are illustrative rather than latency guarantees):

| Scenario | Previous SELECTs / seconds | Batched SELECTs / seconds |
| --- | --- | --- |
| First 100-row page | 407 / 0.203 | 12 / 0.065 |
| Second 100-row page | 407 / 0.157 | 12 / 0.028 |
| Broad search, offset 4,900 | 407 / 0.156 | 12 / 0.031 |
| Rare one-row search | 11 / 0.014 | 12 / 0.014 |
| No-match search | 7 / 0.011 | 7 / 0.010 |
| Last page, offset 5,000 | 11 / 0.014 | 12 / 0.014 |
| 5,000-row CSV export | 20,012 / 8.201 | 27 / 0.394 |
| 5,000-row Excel export | 20,012 / 9.551 | 27 / 1.625 |
| Rejected 5,001-row export | 5 / 0.008 | 5 / 0.008 |

`tests/test_patient_scale.py` asserts query budgets instead of fragile timing
thresholds, non-overlapping stable pages, exact counts and Patient versions,
CSV/Excel parity, full-filter export membership (including rare/empty/missing
filters), complete 106-MR choices, cap failure, authorization, and lifecycle
label/warning parity. It is part of release validation and runs via
`sh scripts/test-api-foundation.sh -s tests/test_patient_scale.py`.
No managed database seeding or production deployment is involved.

Patient creation adds the existing Patient identity. Edits/status changes lock
and advance that identity's version, with transactional audit metadata. Doctor
reassignment updates assigned_mr_id atomically without moving or rekeying files.
Single/bulk Doctor MR shifts update all affected live Patient owners in the same
transaction, or roll back the entire action on conflicts. Lock order follows
verified actor/policy, graph coordination, ordered MR User/Profile owners,
Patient owners, then files. Patient status mirrors `Patient.is_active`,
immediately denying MR access under the existing file policy without deleting
history/files. Existing privileged domain reassignment rejects directory-backed
patients; identity-only patients retain original behavior.
Zones are derived through the current MR relationship, including later MR Zone
changes. No stale uploaded Zone/MR label is accepted as ownership evidence.

## PIN lookup and recovery

Entering a complete six-digit Indian PIN invokes the existing authenticated
same-origin MR postal endpoint and fixed, bounded provider adapter. Only the
PIN reaches the provider, never patient identity/contact/address. One location
auto-fills Country/State/City (provider district is City); differing locations
require a choice. Requests are debounced/cancelled and bound to the current
record/session/PIN/manual-address revision. Saved edit addresses are not looked
up automatically; late results cannot overwrite manual corrections. Lookup
failure leaves manual editing available; non-Indian postal codes are supported.
There are no provider calls under database locks.

Loading, unavailable service, stale version and missing detail states have
explicit retry/repair paths. Edit loads requested detail independently of list
pagination. Same-identity renewal preserves mounted drafts; logout/identity
change clears them and rejects late responses/body decoding. Pending actions
cannot duplicate writes. Lost mutation responses are never automatically
replayed: inspect current server records, then refresh/review before retrying.

## CSV/XLSX contract

Both `/admin/masters/patients/import` and shared
`/admin/masters/import/patient` use the prepared master-import cards/tabs.
CSV and genuine `.xlsx` samples are server-prepared, and export is an accessible
CSV/Excel menu. All handoffs require the durable download-initiation ledger;
missing ledger confirmation blocks the browser download.

The **exact legacy 17-column schema** is:

1. Patient ID
2. Patient Name
3. Gender
4. Phone No.
5. Email ID
6. Date of Birth
7. Doctor ID
8. Doctor Registration Number
9. Instructions Language
10. Status
11. Address Line 1
12. Address Line 2
13. Landmark
14. Pincode
15. City
16. State
17. Country

Current business samples add **Dial Country** as column 18. Current exports
add **Doctor Name, MR Name, Zone, Created By, Created At, Updated By, Updated At**
after Dial Country (25 columns total). These three exact schemas are accepted;
arbitrary/ownership/UUID/version/deletion/password/unsupported columns are not.
Readable reference/audit labels in current exports are informational only.
Imports always attribute fresh creation to the current importer/time.

Doctor Registration Number is the stable portable reference. Current exports
leave Doctor ID blank and include registration. Legacy local Doctor IDs are
never treated as live UUIDs: resolve a unique case-insensitive trimmed server
registration number. A recognized live Doctor UUID must agree with registration;
missing, ambiguous, inconsistent or unusable references fail explicitly.
Imports never create relationships. Old/current exports can be explicitly
imported into an empty Patient directory when matching active Doctors exist.

Review performs no writes and returns actual valid/invalid counts and row
errors. Confirmation binds exact file bytes, filename, actor, authenticated
session and relationship/version snapshot; it rechecks policy, references and
duplicates. Changing files or a conflict/failure requires fresh review. Import
is create-only, fully valid and atomic: no upsert/restore/partial commit.
Limits: 2 MiB file, 1,000 records, 10,000 characters per cell, bounded actual
raw/multipart request bytes, bounded XLSX compressed/expanded archives/cell
counts. Formulas, macros, external links, malformed workbooks, `.xls` and other
formats are rejected without evaluation/network access. Export fails explicitly
above 5,000 matching rows rather than truncating or exporting only one page.

CSV escaping preserves text identifiers/phone/postcodes and neutralizes unsafe
spreadsheet formulas. Genuine XLSX uses string cells (including DOB/code/phone/
postcode) and the proper MIME/filename. Hidden Patient UUID, assigned owner,
session, internal version and file references never enter portable files.

## Verification and clinical boundary

`tests/test_patients.py`, `test_migration_patients.py`, `test_patient_files.py`
cover field/phone/date validation, empty migration/file preservation, access,
references/filters, duplicate/version races, atomic imports and file
publication/download ownership changes. Frontend service tests cover no-store,
expected versions, exact bytes, ledger and identity/late-decoding protection.
`patients-backend.preview.spec.mjs` exercises real authenticated persistence,
responsive themes, PIN races, transfer handoffs and truthful history using
isolated synthetic fixtures. They run in release validation. Never point these
tests at managed/production databases or real accounts.

Last Dose is **Not recorded**; live UUID dosage history has a truthful empty
state. It never matches local sample treatment or infers clinical history.
Building real dosage/order management remains separate work.
