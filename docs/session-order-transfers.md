# Local Admin order transfers

Applies only to the Immunotherapy, Kits & Consumables, SPT and Lupin Admin
listings. These transfers read and publish the existing session-memory stores.
They do not use backend order APIs, live masters, uploads, persistent order
storage, submission, shipping or payment processing. Reloading still resets
the stores. The General settings preference reader is used only to capture
presentation preferences, never to persist orders.

## File contract

CSV (UTF-8 / RFC 4180) and Excel (`.xlsx`, one worksheet, text cells) use the
same eight columns, in this exact order:

| Column | Contract |
| --- | --- |
| Schema | `evexia.session-orders/1` |
| Order type | `immunotherapy`, `kits`, `spt` or `lupin` |
| Date context JSON | `dateFormat`, resolved IANA `timeZone`, `clock`, `cellEncoding: "apostrophe-v1"` |
| Order ID | Original session ID, or a new ID with the same type prefix |
| Order number | Matching `DEMO-IT-`, `DEMO-KIT-`, `DEMO-SPT-` or `DEMO-LUPIN-` sequence; at least four digits |
| Order date | Calendar date displayed in the declared file format, or ISO `YYYY-MM-DD` |
| Order details JSON | Complete order object except its separately supplied `id`, `number`, `date` |
| Session patients JSON | Required complete directory patients for this order; `[]` for Kits/Lupin |

IDs use `demo-it-N`, `demo-kit-N`, `demo-spt-N` or `demo-lupin-N`, with a
positive sequence up to 12 digits. Preserve both ID and number for an update.
The sample template has deliberately fictional `900001` identifiers; replace
or remove its example before importing.

Each row carries the same schema, type and date context. Numeric dates are
decoded from that context, not the importing browser's settings. The supported
date formats are `dd-mmm-yyyy` (for example `23 Oct 2026`), `dd-mm-yyyy`
(`23/10/2026`), `mm-dd-yyyy` (`10/23/2026`) and `yyyy-mm-dd`.
Invalid calendar dates, missing context, mixed contexts and unsupported
formats are errors. Unambiguous ISO dates are accepted regardless of the
declared display format.

General date, clock and timezone preferences are captured once per download,
including resolving Browser default. The existing order models have **no
timestamp fields**: their order dates remain calendar dates. No artificial
midnight timestamps, generated-at instants or inferred clinical events are
added. JSON snapshots retain their exact canonical values.

All numeric configuration/money values stored as strings remain JSON strings.
Do not replace those strings with JSON numbers. Workbook cells are text, not
floating point numbers or spreadsheet serial dates. Do not convert them to
numeric/date cells in Excel. Formula-sensitive cells and literal leading
apostrophes use reversible apostrophe escaping; the file's declared encoding
identifies that convention. Workbooks containing formulas, hyperlinks, external
links, macros or embedded media/objects are rejected.

## Order-specific JSON

- **Immunotherapy:** patient/doctor/MR IDs, dosage, histamine/saline, complete
  bottle IDs/MRPs/allergen IDs/results, status, shipping selection, remarks,
  PO number and attachment metadata. The directory patient includes name,
  age, gender, phone/country, address, doctor/MR and explicit `lastGiven`.
  `lastGiven` is never derived from order status. PD/DD and B-series behavior
  and the existing relaxed bottle-composition rules are unchanged.
- **Kits:** order-for and doctor/MR relationships, complete kit configuration
  (including custom product and volume), all consumable counts, shipping,
  other-recipient fields, **saved recipient and billing snapshots**, status,
  payment status, remarks and attachment metadata. Snapshot values are not
  reconstructed from today's catalogue on import.
- **SPT:** doctor/MR IDs and names, Draft/Saved status, remarks, each patient's
  ID/name/gender/age/exact amount, plus the required session directory patients.
  Order patient identity fields must agree with their supplied directory
  dependency. Draft amounts can remain incomplete/invalid, matching existing
  draft-save behavior; Saved orders must pass the existing validation.
- **Lupin:** doctor/MR IDs and names, patient count, exact saved price, status,
  payment status, remarks and attachment metadata. Import retains the saved
  price lexeme without re-rounding it.

Attachment metadata means `name`, `size` (bytes) and `type` (MIME) only.
**File contents are never exported, imported or uploaded.** No directory
records outside the required session patients are changed.

## Review and commit

The review labels additions, updates, unchanged rows and rejections. It shows
row errors, changed top-level fields, complete current/incoming order details
and required patient dependencies. Updates require an extra explicit checkbox
and all valid imports require Confirm import.

Duplicate IDs/numbers, mismatched ID/number pairs, unknown relationships,
inconsistent patient dependencies, existing-patient conflicts and invalid
order structures are rejected. Directory patient conflicts are not silently
overwritten or remapped, including administration history. No records are
deleted because they are absent from the file.

Review does not mutate the session. Commit uses a private, immutable prepared
transaction and verifies the original orders/patient collection references
still match. Concurrent edits or Refresh invalidate the review; choose the
file again. One atomic publication updates orders and any new patient
dependencies and notifies subscribers. Order, patient and bottle counters
advance beyond imported generated IDs before subsequent form saves.

CSV/XLSX input and output share an 8 MB file and 10,000-order limit. Larger
exports fail explicitly rather than truncating; narrow the filters and export
again. XLSX expansion is bounded to 32 MB and 128 archive parts; individual
Excel cells must fit 32,767 characters on export (use CSV for larger JSON).

## Inspection boundary

Implementation was inspected in source only at the user's request. No tests
were added or run. No builds, browser/manual scenarios, runtime probes,
service restarts or release verification workflows were run.
