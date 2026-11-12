# Saved Opening Stock corrections — source preparation

## Scope and safeguards

`opening_stock.edit` is a separate assignable permission. Existing view, add,
import and export grants do not acquire it. The editor supports item/type,
quantity, rate, location, recorded date and explicit optional expiry; technical
identities, creator, creation time and derived units/value stay server-owned.

Preview and commit revalidate the expected version, active item/location,
whole-combo and exact decimal rules under the common inventory writer lock.
Blank manual rate means zero; blank expiry means unknown.

Original opening records and lots remain immutable. Each correction reverses
the current lot's remaining opening credit, creates one revision-specific lot,
and posts the reviewed replacement once, atomically. No lot metadata is relabelled.
Saved revision evidence retains before/after fields plus editor and time.
Ledger reversal/replacement events use that revision's evidence; original
postings continue to use original evidence.

Any non-opening posting in any retained opening lot, even a net-zero transfer,
blocks corrections. Retained expiry separation, disposal or actual-cost
evidence also blocks corrections. Dated expired/expiry-today stock cannot be
revived through an item or expiry change. Unknown expiry may be explicitly
corrected on an otherwise eligible opening. Usability and Unallocated rules,
historical losses, notification schedules and already sent notifications are
unchanged. Superseded lots retain zero balances and cannot supply operations.

Imports recognize original and all retained revision business snapshots for
the immutable source/row identity. They return the current opening without
posting or undoing a correction. Unknown conflicting snapshots still fail.
Current exports keep the existing 13-column layout; the exact old 12-column
layout still treats missing expiry as unknown.

Add, import and edit retain one owner-bound unresolved request boundary.
Only opaque request identity and operation/record context are browser-persisted;
draft business fields remain in memory. Terminal negative reconciliation
durably cancels the key under the same inventory lock, so late requests cannot
commit after a reported non-save. Legacy pending identities remain readable.
Committed reconciliation requires the originating operation's permission.

## Unapplied schema and operator requirements

The staged migration is
`artifacts/api-server/backend/alembic/versions/0098_opening_corrections.py`.
It follows the staged merge `0097_hsn_staged_merge`, adds the encrypted,
immutable `opening_stock_revisions` table and non-null
`inventory_lots.opening_revision`, and replaces the one-lot-per-opening unique
constraint with one lot per opening/revision. Existing lots default to revision
one; no existing payload or stock transaction is repaired or rewritten.

**This migration has not been applied. No activation is authorized by this work.**
The declared development schema target and startup/migration wrappers are
unchanged. Do not start/restart this source against a predecessor schema:
inventory lot reads and opening projections require the staged schema.

A separately approved operator rollout must review the actual starting schema,
the intervening staged migrations, recovery evidence and the exact target.
It must coordinate the schema declaration, readiness predecessor probes and
account/directory maintenance revision allowlists before activation. This source
change intentionally does not widen those activation/maintenance boundaries.
After approved application, grant `opening_stock.edit` explicitly to the
intended staff roles; no persisted role is automatically granted edit.

## Validation boundary

Source-only review was performed. No tests, builds, browser automation,
regression suites, release checks, workflows, startup hooks, migrations,
database writes or deployment were run. Runtime behavior and migrated-schema
compatibility are not verified by this preparation.
