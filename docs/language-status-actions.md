# Language Master activation actions

Language Master now has server-owned `active` / `inactive` status. Desktop rows
and mobile cards use the shared Zone status badge and power icon, with explicit
**Activate** / **Deactivate** labels, tooltips and confirmation dialogs. The
row/card History action is removed. Stored history, its protected API and the
separate post-deletion history link are retained.

## Persistence and permission boundary

- `POST /api/v1/admin/languages/{language_id}/status` takes only `status` and a
  strict positive `expected_version`; status uses the existing `language.edit`
  permission. No new permission or editable form field is introduced.
- Existing policy locking and identity/session/role revalidation precede the
  record's `FOR UPDATE` lock. Deleted records cannot be changed; stale versions
  and already-matching status return explicit conflicts.
- Status, incremented version, server time/updater, metadata-only audit event and
  append-only history commit in one transaction. Status history records the
  exact before/after values, not an inferred interpretation of prior events.
- The portal validates the returned record, version and requested status before
  announcing success and refreshing the list. Network, unreadable-response and
  session-change uncertainty blocks reconfirmation until the user cancels and
  reviews refreshed server records. Writes are never automatically replayed.
- Historical create/edit/delete history remains readable with null status-change
  fields. Summary totals include the new status-change count; reporting labels
  identify the new audit action.

## Existing contracts

New manual and imported languages start Active. The migration gives every
existing language—including retained deleted records—an Active default, without
changing its name, identity, deletion state, version, updater or older history.
Only new confirmed status operations create status-change history.

Import, sample and export remain **name-only**, with the same duplicate-name
rules (including inactive, non-deleted languages). There are no status filters,
bulk actions or new Patient/order language-selection restrictions. Saved
Patient/order language text is not rewritten.

## Coordinated source, not activation

`0093_language_status` branches from the currently declared
`0089_it_material_pricing` ancestry. The development contract declares this
Language-only successor. `0094_language_low_stock_merge` is a DDL-free staged
merge with the existing `0092_low_stock_cron` branch, preserving a single source
head without bringing the unrelated staged low-stock migrations into the
declared development ancestry.

Readiness inherits the complete declared predecessor capability chain and probes
the new Language columns. The staged merge inherits both branches. Account and
directory maintenance use exact compatible revision admission without changing
encryption inventories. Migration classification remains automatic; no new
per-migration approval gate was added.

Development schema constants and migration fingerprints were generated offline.
Production catalog/release evidence was not advanced or fabricated. The status
schema and matching application must be activated together by the normal
authorized lifecycle; this task did not execute that lifecycle.

## Verification limits

This delivery used source/diff review and generation-only commands:

- Development metadata generation called only the metadata `refresh` function,
  not the script's main review/check wrapper.
- OpenAPI export used the new `--scope languages` mode to retain unrelated
  contract refinements.
- Orval, its constant-hoisting generator and generated-source formatting ran
  directly, without the package wrapper's chained typecheck. Unrelated generated
  changes were excluded from this delivery.

**No tests, builds, typechecks, regression/release/validation wrappers,
runtime/browser probes, managed service starts/restarts, migrations, deployments
or live writes were run. Runtime behavior and migration execution remain
unverified.**
