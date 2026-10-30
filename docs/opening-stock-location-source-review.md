# Opening Stock storage choices: source review

## Confirmed source-level findings

- Storage Location Master calls `serverLocations.listLocations`, through
  `locationRequest` and the authenticated `/api/v1/admin/storage-locations`
  route. Opening Stock calls `listReference('locations', ...)`, through
  `inventoryRequest` and `/api/v1/admin/inventory/references/locations`, with
  `purpose=opening_stock`. The authenticated transport forwards that parameter;
  the existing workflow permission check and backend capability remain in place.
- Both services read `StorageLocation` (`storage_locations`). The opening
  reference branch intentionally excludes inactive and soft-deleted records.
  The master listing defaults to all statuses, so its visible set can differ.
- There is no sample or browser-local location fallback in this form.
  `scripts/master_demo_data.py` defines active “Master Demo” location inputs
  for the master seeding tooling. Such names do not demonstrate a disconnected
  directory. No database was queried, so their actual saved presence, statuses
  and relationship to the reported screenshot are unconfirmed.
- The selector previously fetched on mount, query changes and retry only.
  Unlike the master list, it did not refresh on window focus, and offered no
  refresh action after a successful load. A mounted draft could retain choices
  from before a master edit in another tab.
- The reference query previously loaded all eligible locations with
  `bounded()` before filtering and slicing. Above 2,000 eligible records it
  rejected even a narrow search, making later choices unreachable. This was an
  explicit loading failure, not silent truncation.

These are confirmed source defects, not proof of which condition caused the
reported screenshot. Current database contents and the running revision were
not inspected.

## Scoped changes

- Opening Stock now refreshes location choices on visible window focus and
  offers an explicit **Refresh storage locations** action. An optional selector
  refresh key resets the fetched page without remounting the form or changing
  row selections. Other selector callers retain their existing behavior.
- Only `purpose=opening_stock` locations use SQL filtering, counting and paging
  against the shared master's active/non-deleted predicates. Search follows
  the master's name/address handling, with deterministic name/ID ordering.
  Movement and other reference purposes are unchanged.
- Existing loading/error/Retry and Load more controls remain in use. Unallocated
  stays pinned. No independent directory, sample fallback or data mutation was
  added.

## Review/save integrity (source inspection only)

`ReferenceSelect` maps each returned `id` to option `value` and `name` to label.
Each row independently retains that value; the request body submits it as
`locationId`, or explicit `null` for Unallocated. Refresh changes only fetched
choices, not item, quantity, rate, row identity or selected location.

`opening_stock.review_row` resolves the submitted ID against `StorageLocation`,
rejects missing/inactive/deleted locations for new entries, and takes the
canonical location snapshot, including its version. Commit re-reviews the body
and rejects a changed review digest. Existing idempotency/reconciliation,
already-imported handling and historical snapshots are untouched. A retained
selection can become stale after a master change; retaining it preserves the
draft and does not bypass server rejection.

## Evidence boundary and outstanding work

This handoff is source-review-only. No tests, regression/release commands,
builds, browser scenarios, screenshots, preview restarts, database operations,
seeding or environment changes were performed. Configured completion validation
must be skipped for the same explicit user constraint.

Separately authorized runtime work is still needed to compare the actual master
and reference responses under the same signed-in identity, establish the
reported screenshot's cause, and confirm cross-tab refresh, narrow search,
later pages, failure/retry and selected-ID review/save behavior. A disposable
large-directory fixture would be needed to verify paging beyond the old
2,000-record limit without modifying user master data.
