# Admin SPT orders

## Delivery and activation boundary

Implemented by source inspection only. **No tests, builds, runtime probes,
browser/manual scenarios, service restarts, migrations or deployments were
performed. Runtime behavior is unverified.** OpenAPI/client generation and
development schema integrity metadata generation are source-only operations,
not evidence of a working database or passing checks.

The forward migration `0063_spt_orders` follows the actual source head
`0062_kits_orders`. It creates separate orders, ordered patient membership,
SPT-owned registrations, encrypted retry records and numbering sequences.
It does not migrate fictional session fixtures, provision accounts, create
Patient Master records or alter other order workflows. Schema declarations
are coordinated in `development-contract.json`, `app/core/schema.py` and
`scripts/development-schema-review.json`. No fresh-install catalog, recovery
evidence, or production release authorization is fabricated by this delivery.
An existing running service has not been restarted or activated by this work.
Normal separately authorized development activation remains a separate step.

## API and authority

`/api/v1/admin/spt-orders` provides authenticated list/create, detail by UUID,
`/{id}/edit`, `/references/{patients|doctors|mrs}`, `/patients` registration,
`/export`, `/import/review` and `/import/commit`.

Authorization revalidates the current protected Super Admin or explicitly
authorized MR session inside every operation before accessing directory keys
or records. MR order reads/writes/transfers require mandatory ownership;
Doctor and Staff grants are unchanged. See `mr-order-workflows.md` for MR routes,
fixed identity, registration ownership and the forward ownership migration.
All writes are atomic and record only
action/resource/actor/session metadata in audit events, never personal payloads.
Validation envelopes hide untrusted property names and values.

The server assigns durable `SPT-00000001` order and `SPT-PT-00000001`
registration numbers. Gaps are possible because PostgreSQL sequences are not
transactional. Every order has a version and stable source UUID. Draft edits
require the expected version; Saved orders cannot change via either editor
or import. Identical exported Saved records can be reviewed as unchanged.
Neither status nor an amount is evidence of payment or treatment.

Drafts may lack Doctor/MR, patients or individual amounts. Any entered amount
must still be a nonnegative decimal **string** of up to nine whole digits and
two fractional digits. Saved requires Doctor, MR, at least one patient and an
amount for each. Membership is unique (at most 200 patients), ordered and
referentially protected. Totals are calculated with server `Decimal` and
stored inside the encrypted document; browser totals are informational.
No floating-point input or fixed-scale database rounding is accepted.

Doctor/MR choices use eligible active masters and current Doctor/MR assignment
for new combinations. Existing Patient Master selections must match the
selected Doctor/MR when that combination is newly introduced. Drafts with
incomplete relationships remain possible; future selection of relationships
validates all affected memberships. Registration creates a persistent,
SPT-only patient with the supplied name, gender and age, not a Patient Master
entry, clinical owner or login. No name-based identity merging occurs:
different registrations are different people. Retry deduplication is by
submission key, not an assumption that matching names identify the same person.

Master-backed patient age is calculated for the order date from the master
birth date. SPT registrations retain the explicitly reported age; no birth
date is inferred from an age. Historical per-order name/gender/age and
Doctor/MR identity/contact snapshots are immutable while their reference is
unchanged. Later master edits/deactivation do not silently refresh history.
Foreign keys protect retained references against physical deletion. Review
shows historical names/contact details even when no current eligible choice
exists.

## Encryption and key custody

Uses existing managed `DIRECTORY_ENCRYPTION_KEYS`,
`DIRECTORY_ENCRYPTION_KEY_ID` and `DIRECTORY_INDEX_KEY` conventions. No new
secret or process-wide plaintext cache is introduced. AES-GCM record-bound AAD
is `evexia:spt:v1:{orders|patients|requests}:{UUID}`. Order documents include
all personal snapshots, amounts, totals and remarks. Registration personal
fields are ciphertext. Retry request **and response** payloads are ciphertext,
bound to their actor and operation/path as well as their key.

Only operational UUID references, source IDs, numbers, dates, status, membership
positions, versions and actor/timestamp metadata are plaintext. Relationship
and activity metadata remain visible to database operators. Keys must be kept
with independently verified backup custody; a database backup alone does not
recover encrypted records. Do not log request/response bodies or decrypting SQL.

Forward-revision-aware directory rotation includes `spt_orders`,
`spt_patients` and `spt_requests` only at `0063_spt_orders`. Predecessor
inventories and historical staging/retirement fields are unchanged. Rotation
locks these tables and authenticates every payload in inventory/batches.
Historical decryption keys remain required until the supported rotation and
recovery procedure proves they can be retired. No rotation was executed here.

## Transfers

CSV and genuine XLSX use `evexia.spt-orders/1` and eight columns:
Schema, Order type, Date context JSON, Order ID, Order number, Order date,
Order details JSON, Historical snapshots JSON. Templates are blank; old
`evexia.session-orders/1` and fictional demo IDs are explicitly incompatible.
Date context uses the current captured presentation preferences; ISO dates
are also accepted. Amounts remain quoted exact text, including in XLSX, and
the existing transfer writers escape spreadsheet formulas.

Order details contain `sourceId`, existing-only `version`, `doctorId`,
`mrId`, `status`, `remarks`, and
`patients: [{id, source: "master"|"spt", amount}]`.
New rows require a unique stable UUID `sourceId`, blank order ID/number and
no version. Keep the source UUID on retry or later file review: an already-used
source identity is rejected explicitly rather than silently creating a second
order. Matching rows retain ID/source UUID/number/date/current version.
Imported historical snapshots are informational only. They cannot create or
overwrite people. New orders resolve snapshots from real references; matching
orders retain their recorded snapshots unless references change.

Files are locally parsed (up to 8 MB / 500 rows) into bounded JSON (up to
1 MiB) sent to authenticated server review. Review returns resolved before/
after records, changes and an actor-bound keyed review token. Commit rechecks
versions, references and token, requires confirmation of Draft updates and
saves the whole batch atomically. There is no partial import, deletion because
of missing rows, or import-driven patient identity merge.

Export uses the **applied** filters and the complete server endpoint, not the
current page. All matches within a bounded 10,000-candidate secure scan are
returned or an explicit time/size/candidate-limit error is raised; no truncated
file is handed off. Exported files contain personal history: keep them private.
Downloads use the existing metadata-only Download Logs mechanism.

## Failure and editor behavior

Registration, save and import have separate confirmed success/failure states.
Actor-bound advisory locks and encrypted durable request/result records make
identical retries safe after lost acknowledgements. An uncertain write retains
its exact in-memory payload/key, locks editing and guards navigation until the
unchanged retry is confirmed. Session renewal does not discard mounted editor
fields. Definite validation/conflict failures keep entered values editable.
No automatic retries, snapshot refreshes or identity repairs occur.

Unsaved fields and pending retry keys are not durable browser drafts. Closing
the tab or reloading can discard them; do not do this during an uncertain
submission. Confirmed orders and registered patients are durable on the server
and discoverable from their listing/reference searches after reload.

The listing uses explicit Apply, Reset, Refresh, date/person/status filters,
bounded cursor sections and cumulative visible serial numbers. Obsolete
responses are ignored. Patient controls, compact preview/registration, selected
rows and totals remain SPT-scoped; shared component extensions are optional
with unchanged defaults for Kits/Immunotherapy/Lupin.
