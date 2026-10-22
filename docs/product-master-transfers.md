# Product Master recipe transfers

Product Master is protected Super Admin-only. No Staff permissions are added.
Listing cleanup removes only the listing-wide assembly/remaining-stock summary;
the record drawer, history, analytics, assembly actions and pending-save notices
remain available.

## Recipe format and bounds

CSV is UTF-8 (BOM accepted). Excel is a genuine single-sheet `.xlsx` workbook.
Basic headers, in order:

`Product Name,MRP,Selling Price,Status,Allergen ID,Allergen Name,Quantity`

One row represents one member. Repeat the product name, MRP, selling price and
status for every member. Names group using the product writer's semantic
whitespace normalization and case-insensitive comparison. Repeated price/status
text must agree exactly after trimming; inconsistent definitions, duplicate
member UUIDs, or fewer than 2 / more than 100 distinct members are errors.
Status is exactly `active` or `inactive`.

Allergen UUIDs are authoritative; names are informational, never name-matched.
Members must be existing active, non-deleted allergens at review **and** commit.
Quantity means procurement quantity units required for one whole combo, not
packs. Positive ASCII decimal strings, at most 1,000,000 and three fractional
digits, use the existing quantity contract. No pack/unit conversions occur.

MRP and selling price are independent saved combo-level prices, not calculated
component totals. The existing exact decimal-string rate contract accepts up to
12 significant integer digits and six fractional digits, rounds half-up to two
places, and rejects rounded values above 999999999999.99 or selling price above
MRP. Review displays the actual normalized saved values. Excel prices and
quantities should be text; numeric cells are read from their validated original
XML decimal lexemes, never from binary floats.

Imports: 2 MiB, 500 products, 1,000 total member rows, eight columns maximum.
Shared XLSX protection additionally bounds ZIP entries, decompressed bytes,
coordinates and cell text; formulas, macros, external links and objects are
rejected. CSV field sizes and row/column counts are bounded.

Exports include **all** search/status matches, never just the visible page.
They reject over 500 products or 1,000 member rows rather than truncate. The
underlying encrypted catalogue scan retains its existing 2,000-product bound.
An import that would exceed that catalogue bound is rejected atomically.

Export headers add `Recipe Format`, containing `EVEXIA recipe v1` on every row.
Keep this eighth column when reimporting exports: it selects portable text
escaping. Leading apostrophes and formula-like names are prefixed with one
apostrophe and decoded exactly once only in this marked format. XLSX output
cells are explicitly string-typed, including prices and quantities. No formulas
are emitted or evaluated. Seven-column samples use literal unescaped text.
Sample UUIDs deliberately need replacing with actual saved Allergen IDs.

## Confirmation, attribution and recovery

Review is read-only and returns product and member-row counts independently.
Confirmation is bound by an HMAC to the exact bytes, filename, actor and session.
The server revalidates live name conflicts, recipe members and all input fields.
Imports are create-only: existing active or inactive names conflict. No
overwrite/upsert, stock, assemblies, lot allocations or uploaded audit identities
are accepted. Strict headers reject extra historical/business fields.

The existing authenticated inventory transaction and shared advisory lock cover
the entire batch. Imports call the existing encrypted product writer within this
one transaction, preserving name uniqueness, exact quantities, immutable recipe
revisions and server-attributed create events. Any error rolls back every row.
The outer request identity stores an encrypted aggregate result; per-product
retry identities are derived from that request. Repeated confirmations with the
same request return the committed result, while changed commands or closed
identities conflict.

Before sending confirmation, the portal durably journals the actor-bound opaque
request UUID using the existing Product Web Lock and browser-storage protocol.
An uncertain save blocks replacement submissions, including after navigation or
reload. “Check save outcome” obtains either the committed aggregate result or a
durable cancellation serialized against delayed confirmation. Merely reviewing
another file or reading a list never resolves uncertainty. Selected files and
read-only reviews remain in memory; no uploaded business data enters browser
storage. Session renewal keeps mounted drafts, and identity changes clear them.

Exports and samples require durable server download evidence before browser
handoff; that evidence is initiation, not proof of disk completion. A compatible
database must have the same active allergen identities. Existing names still
conflict, unavailable allergens need explicit resolution, and an empty export
has headers only (it is not a valid non-empty import).

## Implementation evidence limitation

This extension was inspected as source only at the user's explicit request.
No tests, browser/manual scenarios, builds, validation/release wrappers,
migrations, live database verification or deployment were run. Only narrow
offline OpenAPI/client source generation is part of contract coordination.
