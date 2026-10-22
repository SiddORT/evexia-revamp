# Masters write-validation coverage

## Scope and evidence

This inventory covers **all 16 entries** in the EVEXIA Masters directory, not
the intentionally smaller eight-resource assignable staff permission catalogue.
No permission, account-administration, database schema or historical migration
changes are part of this work. Browser-local demonstration stores are not live
Masters; they are neither migrated nor rewritten.

**Evidence is source review only. Tests were not run at the user's request.**
No unit/integration/API/browser/manual/smoke/regression scenarios, builds,
release checks, validation wrappers, migrations or runtime probes were executed.
The entries below describe implementation paths, not passing test results.

### Shared rules added to explicit content writes

- Catalogue/business names require a Unicode letter or number. MR, Doctor,
  Patient and Vendor contact-person names require a Unicode letter.
- Names trim their boundaries and collapse repeated supported Unicode whitespace
  to one space. The Python/JavaScript helpers use the same explicit whitespace
  set and Unicode L/N categories. Lengths count Unicode code points.
- Combining marks and legitimate punctuation are supported. ZWJ/ZWNJ remain
  supported for international scripts. Other invisible/control/surrogate/
  private-use/unassigned characters and U+FFFE/U+FFFF are rejected in new names.
  Symbols alone and combining marks alone are not meaningful names.
- No name rule is applied to addresses, descriptions, registration/employee
  identifiers, HQ/area codes, concentrations, quantities or passwords.
- Existing comparison/index keys are unchanged: no new NFC/NFKC/casefold
  uniqueness migration, global personal-name uniqueness or global HQ-code
  uniqueness is introduced.
- `schemas/master_validation.py` supplies explicit-write semantics.
  Response subclasses opt out with `master_read`; Product/history views already
  use separate read models. Reads do not apply the new name normalization,
  enforce the new semantic-name rule or persist a repaired value.
- Status/delete/version-only schemas remain separate from content schemas.
  An old symbol-only name can still be displayed, exported, deactivated or
  deleted without a name repair. An explicit content edit submits a valid name.
- Request-validation errors expose only known field paths, constant guidance
  and schema-owned length limits, not input values or password contents.

## Field and entry-point matrix

`C/E` below means the live Add/Edit form, the authoritative create/edit request
schema and the matching service mutation. `R/C` means existing CSV/XLSX review
and confirmation, both of which instantiate/revalidate the write schema.
All listed lengths are maximums unless a range is stated.

| # | Master / entry points | Retained field, relationship and uniqueness contracts | Added or aligned coverage |
|---|---|---|---|
| 1 | **Zone** — `ZoneForm`; `schemas/zones.py`; `services/zones.py`; `zone_transfer.py` R/C | Required name 200; status active/inactive; non-deleted name unique under existing PostgreSQL `lower`; inactive names reserve the key; edit excludes self; partial unique index arbitrates races; version/permission locks retained; protected restore unchanged. | Meaningful business name in C/E and R/C; shared whitespace normalization; Zone review now uses the actual validated normalized name before duplicate checks. Invalid names never reach the duplicate SQL query. Row errors identify the field. |
| 2 | **Language** — `LanguageForm`; `schemas/languages.py`; `services/languages.py`; `language_transfer.py` R/C | Name only, 200; no invented status; non-deleted Unicode uniqueness under existing `lower(... COLLATE pg_c_utf8)`; inactive concept not invented; deleted names reusable; locked versions, retained history, session-bound digest and uncertain-confirmation blocking retained. | Meaningful business name and whitespace handling in C/E and R/C; response/history names bypass new write semantics; review explains invalid names. Patient's independent historical text is not renamed with this catalogue. |
| 3 | **Courier Partner** — `CourierPartnerForm`; `schemas/couriers.py`; `services/couriers.py`; `courier_transfer.py` R/C | Name 200, active/inactive; normalized live-name uniqueness including inactive records; soft-delete reuse; DB unique index, version checks, permissions and create-only transfer retained. | Meaningful business name in C/E and R/C; explicit supported-status guard in form; normalized payload and useful row errors. |
| 4 | **Designation** — `DesignationFormPage`; `serverDesignationValidation.js`; `schemas/designations.py`; `services/designations.py`; `designation_transfer.py` R/C | Required name 200 and short name 50; active/inactive; live normalized **name** uniqueness, not new short-name uniqueness; reduced/current and documented legacy headers retained; versioned mutations and server attribution retained. | Both name and short name require a Unicode letter/number, with code-point limits and consistent whitespace in C/E and R/C. Server field errors bind to existing controls. |
| 5 | **MR** — `MRForm` / `serverMRs.js`; `schemas/mrs.py`; `services/mrs.py`; `mr_transfer.py` R/C | Name 200; username 3–32, lowercase letter first, then lowercase letters/digits/`._-`; employee code 1–64 and existing global identifier/username/email rules; no personal-name uniqueness. Required saved HQ/designation, ordered distinct multi-zones (1–10,000), retained primary, optional manager and cycle prevention. New references must be usable; established unchanged unavailable links remain retainable. Phone 20, country metadata and MR legacy phone policy; email 320; contact required/optional, both phone/email when required. Joining ISO date nonfuture in India. Required address1 300, landmark 200, city/state/country 100, Indian PIN `[1-9][0-9]{5}`; address2 300 optional. Exact nonnegative payment ≤999999999.99, ≤2 places; whole days 0–3650. Initial password 12–128 or server-generated, no password trimming; edit cannot reset credentials. | Personal-name semantics/whitespace in C/E and R/C. Client code-point lengths and explicit distinct-zone/primary guard align with server. MR monetary JSON floats now explicitly rejected, matching exact-string money. Server field errors preserve the draft, mark controls and open the relevant tab; password errors map to the enrollment password field without exposing it. |
| 6 | **Sales Target** — `SalesTargetForm` / `salesTargetFields.js`; `schemas/sales_targets.py`; `services/sales_targets.py`; `sales_target_transfer.py` R/C | Saved server MR and existing derived HQ/Zone reference checks. Start 1–9998, end 2–9999 and exactly start+1. Each quarter plain nonnegative exact string, ≤12 integer/2 fractional digits; excess precision rejected, never rounded. Annual total derived from quarters, including stored generated total. Live MR/start-year unique including inactive rows, atomic DB constraint, edit self-exclusion. | Existing domain validation retained rather than replaced. Safe field guidance applies to direct API errors; existing form error binding retained and error announcements made explicit. No client-supplied annual-total authority added. |
| 7 | **Doctor** — `DoctorForm`; `schemas/doctors.py`; `services/doctors.py`; `doctor_transfer.py` R/C | Name 200; registration 100 required/global case-insensitive trimmed unique including tombstones; qualification 200 required; optional clinic 200. Saved MR assignment; unchanged unavailable relationships retainable under existing contract. Contact required/optional, country-aware phone/alternate 20 and email 320, existing per-country legacy acceptance. Optional joining date nonfuture in India. Normal/GST invoice enum, conditional GST requirement and existing India/foreign formats (GST 20, drug licence 100). Discount original 0–100, ≤6 source places, half-up cents; exact nonnegative payment ≤9999999999999.99, ≤2 places; whole days ≤2147483647. Required address1 300, landmark 200, city/state/country 100 and existing postal format; address2 300 optional. | Personal-name semantics in C/E and R/C; missing client string-length checks added; client nonfuture date follows server India date. Server errors mark field controls, switch hidden tabs and preserve drafts. No Doctor login or name uniqueness added. |
| 8 | **Product Category** — `ProductCategoryFormPage` / `productCategoryValidation.js`; `schemas/product_categories.py`; `services/product_categories.py`; `product_category_transfer.py` R/C | Required name 200; description 2000 optional; nonnegative exact unit rate with established ≤6 source places and half-up cents, rounded max 999999999999.99; supported status. Live normalized-name index including inactive rows; edits exclude self; tombstones reusable. | Meaningful business name in C/E and R/C; description is not a name and retains internal whitespace/line breaks rather than being collapsed by the name normalizer. Existing control/length protection retained, allowing ordinary multiline description text. Server/row errors identify fields. |
| 9 | **Storage Location** — `StorageLocationFormPage`; `schemas/locations.py`; `services/locations.py`; `location_transfer.py` R/C | Name 200; required address 2000; active/inactive; optional PIN 20, ISO country 2, State/UT 100, city 100. Structured fields require supported country when supplied; Indian PIN `[1-9][0-9]{5}` and supported State/UT when supplied. No requirement to backfill structured geography. Existing live normalized-name uniqueness and retained legacy/current file headers. | Meaningful business name in C/E and R/C; whitespace-only address rejected authoritatively; address internal whitespace/line breaks preserved, not name-normalized. Historical/postal values are not replaced with catalogue city/state alternatives; response geography does not canonicalize saved data. Server errors bind to controls. |
| 10 | **Headquarter** — `HeadquarterFormPage` / `headquarterCode.js`; `schemas/headquarters.py`; `services/headquarters.py`; `headquarter_transfer.py` R/C | Name 200; required saved Zone on new/explicit UI/API content edits, unchanged unavailable saved Zone retainable. Optional generated/manual State Code: 1–16 printable code points after trim/uppercase; numeric names need a manual code; no global code uniqueness. ≤200 areas, name 200, code 32, saved area IDs must belong to this HQ; distinct normalized area names/codes per HQ. Parent lock, DB partial unique indexes, sequence reservation/non-reuse and saved-code retention remain. Existing legacy transfers intentionally carry no Zone/areas and retain that compatibility contract. | Meaningful HQ and area names; consistent Unicode/code-point validation in C/E, and name validation in existing R/C. Codes remain identifiers with their existing printable/manual-code contract, not name regexes. Duplicate/malformed areas remain rejected without new code scopes. |
| 11 | **Product** — `ProductFormPage`; `schemas/products.py`; `services/products.py` | Required name 200; active/inactive; independent exact MRP/selling rates, original supported source precision and half-up cents; selling≤MRP after established rounding. 2–100 distinct saved allergen members; positive per-member quantity ≤1000000, ≤3 places. Existing unavailable unchanged member+quantity may be retained. Live encrypted-name uniqueness under shared inventory lock, expected version and durable request/cancellation identity retained. **No product import capability exists or is added.** | Meaningful business name; form now explicitly enforces upper member bound and status, disables Add at 100, maps nested server member errors to rows. Supported quantities additionally reject non-ASCII digit notation at the write boundary. Read/history models stay separate. |
| 12 | **Allergen** — `AllergenFormPage` / `serverAllergens.js`; `schemas/allergens.py`; `services/allergens.py`; `allergen_transfer.py` R/C | Name 200; required category/location UUIDs; new assignment must be active/non-deleted, unchanged unavailable saved IDs retained with snapshots. Concentration required 200 and legitimate technical notation unchanged. Optional applicable selling price, original ≤6 source places and half-up cents; GST original 0–100 with ≤6 source places, half-up cents; optional threshold retains nonnegative ≤12 integer/6 fractional digit quantity contract. Mix strictly boolean; status supported. Existing normalized live-name uniqueness and transactional reference locks retained. | Meaningful business name in C/E and R/C; client concentration code-point length and strict Mix/No Mix value check; no name rule on concentration. Raw malformed Mix is no longer silently coerced in the payload. Server field errors surfaced. |
| 13 | **Vendor** — `VendorForm` / `vendorFields.js`; `schemas/vendors.py`; `services/vendors.py`; `vendor_transfer.py` R/C | Required business/contact names 200 each, registered address 2000, 15-character GSTIN under existing format, email 320 and country-aware national phone 30. Full maintained international metadata with Vendor-specific legacy acceptance. Active/inactive. Existing normalized live vendor-name **and GST** uniqueness including inactive records; no contact-person-name uniqueness. Locked versions and create-only atomic transfers retained. | Vendor business name needs letter/number; contact-person name needs a letter. Consistent whitespace/code-point lengths in C/E and R/C; address meaning unchanged. Response strings do not inherit write-time whitespace stripping. Import errors name the invalid field/requirement; existing form server-error mapping retained. |
| 14 | **Patient** — `PatientForm`; `schemas/patients.py`; `services/patients.py`; `patient_transfer.py` R/C | Name 200; supported male/female/other/prefer-not-to-say; required country-aware phone 20, optional email 320; date-only nonfuture birth. Required Doctor UUID with existing Doctor→MR→Zone validity/unchanged reference retention and owner/version locks. Instructions language 200; active/inactive. Required address1 300, landmark 200, PIN 2–12 and existing country-specific format, city/state/country 100; address2 300 optional. Existing code and composite name/phone/country/date-of-birth identity keys/tombstone rules, not global personal-name uniqueness. | Personal-name semantics and missing client lengths in C/E and R/C. New language assignments must exactly match a current saved Language, under a held share lock at review/insert/edit; unchanged historical text remains independent/retainable after catalogue rename/delete. Hidden-tab server field errors preserve the draft. |
| 15 | **Opening Stock** — `OpeningStockFormPage` / `openingStock.js`; `schemas/opening_stock.py`; `services/opening_stock.py`; `opening_stock_transfer.py` | Append-only, **no edit/delete/status master flow**. Typed active item UUID, active location UUID or explicit Unallocated, row/source UUIDs; positive manual quantities ≤1000000, ≤3 places, whole finished combos. Independent nonnegative exact unit rate, established ≤6 source places/half-up cents, never inferred from catalogue prices. Real recorded date; retained imported backup date rules. Import zeros retain skip semantics. Review token binds values/references; shared inventory transaction and source-row/request identities prevent repeated posting and reject identity reuse with changed values. ≤1000 server rows/import; manual UI retains its 50-row limit. | Existing financial/posting rules retained; explicit write rejection of non-ASCII quantity digit notation. Manual date validation now rejects rollover dates rather than relying only on permissive `Date.parse`; manual row-bound guard and quantity/rate/date error associations added. Error transport retains safe field guidance. |
| 16 | **Opening Balance** — shared Add modal / `OpeningBalanceFormPage` / `openingBalanceValidation.js`; `schemas/opening_balances.py`; `services/opening_balances.py`; `opening_balance_transfer.py` R/C | Saved eligible Doctor; unchanged saved unavailable Doctor may be retained under existing contract. Start 1900–9998/end 1901–9999, exactly consecutive. Signed plain exact amount within ±9999999999999.99; ≤2 places, excess rejected, **negative balances remain valid**. Supported status. Live Doctor/start-year uniqueness includes inactive rows, atomic DB index, edit excludes self; single-use reviewed create-only imports and tombstones preserved. | Existing domain validation retained, not replaced by generic nonnegative/rate validation. Safe direct-API field guidance connects to existing form error handling. No balance recalculation, ledger, new uniqueness or historical cleanup. |

## Mutation, duplicate and reference boundaries

- The content schema is authoritative for direct API creation/editing. Existing
  transfer parsers construct the same content schemas for reviewed rows and
  reconstruct/revalidate them during confirmation. Product has no transfer
  writer; Opening Stock confirms its reviewed command through the existing
  append-only posting endpoint rather than an invented import endpoint.
- Existing DB uniqueness constraints and transaction/graph/inventory locks
  remain the final concurrent-save arbitration. Preflight form or import
  duplicate messages do not replace those protections.
- Name changes on explicit writes do not mutate comparison indexes or perform
  a database backfill. Historical names are not rewritten to manufacture a
  match. Patient composite identities, MR identifiers, Doctor registration,
  Vendor GST/name keys and HQ-local area keys retain their established scopes.
- Choice controls are assistance, not authorization. Services still lock/check
  referenced records at the write boundary and preserve only relationships
  permitted by the relevant existing unchanged-reference contract.
- New Patient language choices are checked in review and again in insert/edit.
  An unchanged historical text label is not dependent on continued catalogue
  membership. No language rename/delete updates Patients.
- Separate status/contact/delete/version-only operations do not instantiate
  stricter content-name validators. Existing permissions, optimistic versions,
  identity/session checks, uncertain-result blocking and explicit reconciliation
  are retained; no automatic replay of uncertain writes is introduced.

## Transfers and draft/error presentation

All existing import services retain their file-type/header checks, nonempty
2 MiB limit, 1000-record limit, bounded cells/workbooks, formula/macro/external
content protections and documented legacy headers. Exact workbook decimal
lexemes remain authoritative; this change does not replace them with binary
floating point. There is no new import capability or relaxed size/row limit.

Review and confirmation retain their established file/session digest,
review-token/single-use or source-row idempotency contract, as applicable.
Existing duplicates and within-file duplicates/relationship checks remain
authoritative at confirmation. A stale or invalid batch is not partially
accepted. Existing row numbering and field errors are rendered by the existing
import screens; several generic name-row messages are now field-specific.

Client helpers are called during submission, not while loading old records.
MR/Doctor joining-date and Opening Stock recorded-date writes also explicitly
reject epoch numbers/timestamps instead of allowing date coercion; optional
Doctor dates and retained backup recorded dates keep their existing meanings.
Field errors use the existing `aria-invalid`, described-by and alert patterns.
Multi-tab people forms now carry safe API field errors through their hooks,
open the appropriate tab and keep entered values. Other forms show safe
server guidance and bind available field errors to controls. Product nested
member errors map to the preserved row identity. Pending saves, expected
versions, cancellation/reconciliation journals and draft/session protection
remain in place.

## Remaining uncertainty / activation boundary

- No runtime, import, browser, concurrency, migration, build or generated-client
  execution evidence is claimed. In particular, Unicode parity depends on the
  supported Python/JavaScript Unicode versions; accessibility/focus behavior and
  PostgreSQL race handling were traced in source, not exercised.
- No database records were queried, renamed, deleted or repaired; no production/
  VPS operation or deployment occurred. Existing runtime schema/key/revision
  alignment is not established by this fork.
- Public request/response field shapes and existing schema names are unchanged;
  no API contract-generation wrapper was needed or run.
- Focused verification of the new semantic-name/read-compatibility boundary and
  hidden-tab error routing requires separate authorization to run tests.
