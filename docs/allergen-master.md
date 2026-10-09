# Shared Allergen Master

## Scope and access

The Portal's Allergen list, add/edit forms and prepared import route use the
authenticated `/api/v1/admin/allergens` API. Only the protected system Super
Admin with `admin.access` may use this catalogue. Reference helpers authorize
the consuming Allergen workflow; they do not grant access to either shared
reference master. Allergen is deliberately outside the eight-master staff
permission catalogue. No roles, grants, login upgrades or identity provisioning
are added.

This is product catalogue metadata, **not inventory or a mixing operation**.
The existing local allergen/category/location storage, obsolete local HSN values
and procurement references are never initialized, migrated, mirrored, rewritten
or deleted by these pages. Purchase Orders, Purchase Received, Stock Status and
Move Stocks remain separate.

## Rollout — operator approval required

Migration `0022_allergen_catalogue` follows the now-landed `0022_vendors` (itself
after `0021_master_permissions`), keeping the application on a single Alembic
head, and creates
an **empty** `allergen_products` table. It adds foreign keys to shared Product
Category and Storage Location and verified User attribution, exact numeric and
status/name/version/deletion constraints, a live normalized-name uniqueness
index, reference indexes and deterministic live ordering index. It seeds no
records and changes no grants. Tables are never created at app startup.

Do not run a managed migration or production deployment without separate
operator approval. Before approved rollout:

1. Take and verify an operator-managed PostgreSQL backup and a recovery plan.
2. Verify the database has the existing migration chain and protected singleton;
   use the documented backend bootstrap process, never a synthetic test account.
3. Review the migration SQL and apply the approved Alembic upgrade through the
   backend's configured operator environment.
4. Verify the empty shared catalogue and preserve existing categories, locations,
   staff grants, accounts and audit history.
5. Confirm the singleton can use authenticated CRUD/import/export; staff and MR
   identities remain denied. Populate active shared category/location directories
   before adding catalogue products.

Downgrading this migration drops the catalogue and its data; it is not record
recovery and must not be performed casually. Soft deletion is supported, not
trash/restore, hard deletion or automatic import of local storage.

## Business and concurrency contract

`name` and `concentration` are required printable text, 1–200 characters.
Whitespace is normalized; non-deleted names are case-insensitively unique using
the existing PostgreSQL normalized-name expression, including inactive records.
`category_id` and `storage_location_id` are required shared UUID references.
`selling_price` and `threshold_limit` are optional **nullable** decimal strings:
null means absent, `"0"` means supplied zero. `gst` is a required decimal string
between zero and 100. Amounts accept up to 12 integer and 6 fractional digits
(`0`–`999999999999.999999`) without exponent notation or binary floats; responses
use six decimal places. GST has the same fractional limit and its narrower range.
`status` is `active` or `inactive`. `mix` is a strict boolean:

- `true` = **Mix**
- `false` = **No Mix**

There is no HSN field in the business schema, current form/list/sample/export.
Unknown fields and forged IDs/version/audit attribution are rejected.

Create accepts business fields. Edit accepts full business fields plus strict
positive integer `expected_version`. Status and delete also require
`expected_version`; success increments the version and uses server UTC time and
verified actor attribution. Deletion retains the row, deletion actor/time and
audit evidence but excludes it from ordinary detail/list/export. Duplicate names
and stale writes return useful 409 conflicts; deleted/missing records return 404.
Transactions revalidate the session and protected identity, then hold row locks
through atomic mutation and audit commit.

New references must be active and non-deleted. Editing may retain an unchanged
saved inactive or soft-deleted reference, whose real name and status remain
visible through foreign keys. It may not newly select an unusable reference.
Reference SHARE locks serialize against category/location edits/status/deletion
through product/import commit; selector and review results alone never authorize
a reference.

## Endpoints and filters

At `/api/v1/admin/allergens`:

- `GET ""`: `{items,total,filtered,limit,offset}`; total counts all non-deleted
  products, filtered counts matching records, items are only the requested page.
- `POST ""`: create.
- `GET /{id}`: current non-deleted detail.
- `POST /{id}/edit`, `/status`, `/delete`: version-aware actions.
- `GET /references/{kind}`: `categories` or `locations`, literal `query`,
  `limit` 1–100 and bounded offset. Response is `{items,total,limit,offset}` with
  minimal `{id,name,status}` items. Active/non-deleted only by default;
  `include_unusable=true` permits filter choices without making them eligible
  new product assignments.
- `GET /sample?format=csv|xlsx`, `/export?format=csv|xlsx`: authenticated files.
- `POST /import/review`, `/import/commit`: raw bytes or supported multipart
  `file`, with filename query parameter. Commit requires `digest` and
  `confirm=true`.

List and export use identical literal, case-insensitive search across product
name, current category/location name (including retained unusable references),
and concentration. `%`, `_` and backslash are escaped, never SQL wildcards.
Search is at most 200 characters. Filters combine status
(`all|active|inactive`), `category_id`, `storage_location_id`, Mix
(`all|mix|no_mix`), and optional `min_price`/`max_price`. Supplied price bounds
exclude absent prices, preserve zero and exact precision, and reject an inverted
range. Ordering is creation time descending, UUID descending. Pagination defaults
to 10, permits 1–100 rows and bounded offsets.

## Transfer contract

Use the existing two-card master import route
`/admin/masters/import/allergen`, selected Allergen navigation, back link,
authenticated CSV/Excel sample buttons, upload/review report and explicit confirm.
No local modal or alternate import format selector is used. Samples use placeholder
reference names that must be replaced with actual active shared directory names.

Imports are create-only, all-or-nothing, at most **2 MiB and 1,000 records**.
Review saves no catalogue records or uploaded file bytes. A digest binds exact
file bytes and filename, current actor and refresh session, resolved reference
IDs/versions and a short time bucket. It expires at the next 15-minute UTC bucket
boundary (at most 15 minutes; a review near the boundary may expire sooner).
File/session/reference changes and expiry require fresh review. Every UI commit
attempt consumes its review, including failures/conflicts; uncertain outcomes
require inspecting authoritative state before another attempt. Confirmation
reparses bytes and rechecks identity, digest, uniqueness and locked active
references atomically, with database uniqueness as the final race guard.

Current sample fields, exact order:

`Product Name, Category, Selling Price, GST, Storage Location, Concentration,
Threshold limit, Status, Mix / No Mix`

Current full exports append `Created By, Created At, Updated By, Updated At`.
Both CSV and genuine single-sheet XLSX exports can be reviewed and reimported
after eligible products are removed. Incoming audit values are ignored; import
creates new IDs, version 1 and current server actor/time, never historical audit.

An explicitly supported **legacy CSV only** layout is:

`Product Name, Category, Selling Price, GST, Storage Location, Concentration,
Threshold limit, HSN code, Status, Allergens / No Mix`

Legacy HSN is ignored; exact `Allergens` maps to Mix (`true`), `No Mix` to `false`.
Legacy local IDs are not resolved or migrated. Category/location names must
uniquely match active non-deleted shared records; unavailable or ambiguous
references produce row errors. Other layouts or invalid values are rejected.

The existing bounded inert parser rejects formulas, macros, links, DTD/entity
payloads, unsafe archives, multiple sheets, oversized cells/rows/columns and
unsupported formats. Decimal XLSX imports read the original validated monetary
XML lexemes, not openpyxl's binary floats. Bounded scientific XML notation is
supported only when exact; text cells are recommended because precision already
lost in an Excel producer cannot be recovered. All workbook export cells are
text, and formula-like strings use reversible spreadsheet-safe escaping.

Exports download **all current-filter matches**, not merely the visible page,
up to **5,000** records; larger results require narrower filters. The accessible
Export data dropdown offers CSV and Excel (.xlsx), returns focus and prevents
duplicate pending actions. Durable server download-log acceptance is mandatory
before sample/export bytes are released; failed acceptance releases no file.
Portable downloads contain no session credentials, internal user IDs, record IDs,
versions, deletion fields or private audit identifiers.

## Identity and draft safety

Allergen listing filters and the existing Add/Edit form use Allergen-scoped
searchable dropdowns. Category and Storage Location search lives inside the
opened menu, with 250 ms debounce, 25-result server pages and explicit in-menu
load-more/retry. Selected labels survive query/page changes; only the selected
reference is retained beyond the current results, not an unbounded directory
cache. Identity changes clear reference state. Listing reference filters include
unusable references; Add uses active references only, while Edit identifies an
unchanged saved inactive/deleted reference. Status and listing Mix / No Mix use
the same appearance. The form's Mix switch is unchanged.

Menus support pointer selection, Arrow keys and Enter, Escape focus return,
Tab navigation, clear actions and wrapped long option names. They are bounded
and scrollable, open above a control when needed, and are disabled during saves.
Field errors are linked to the trigger. The technical draft footer copy is
removed without changing draft lifetime or the Cancel/Save actions.

The portal retains its memory-only bearer / HttpOnly refresh-cookie transport.
Requests, JSON/blob decoding and eventual downloads are guarded against identity
generation changes. Recoverable same-route renewal keeps the mounted editor and
draft; logout, definitive denial and identity changes remove protected state.
Failed saves preserve edits. A conflict disables blind retry until an explicit
review of current server details; Cancel is an explicit discard decision.

## Automated checks

Run against synthetic fixtures only:

```sh
sh scripts/test-api-foundation.sh tests/test_allergens.py tests/test_migration_allergens.py
node --test artifacts/evexia-portal/src/services/serverAllergens.test.js artifacts/evexia-portal/src/services/allergens.test.js
sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/allergens-backend.preview.spec.mjs
python3 scripts/export-api-contract.py
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/evexia-portal run build
```

The release gate includes these new API/transport/browser checks. API and
migration tests cover exact values, soft deletion/audit, stale/duplicate races,
locked reference changes, unusable retention, permission denial, filtered
pagination/export, file/session/reference/expiry binding, legacy/full transfers,
atomic rollback, file limits/inert workbooks and durable acceptance failure.
Browser checks cover the mounted draft during renewal, keyboard switch and export
focus, desktop light/mobile dark, both values, shared tabs, filters, conflicts,
CSV/XLSX samples/downloads/reimport, prepared import and retained references.
Fixtures use fresh private databases, dynamic isolated listeners, separate results
and disposable contexts. Browser evidence is not managed migration or deployment
approval.
