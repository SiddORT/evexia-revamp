# Cron Jobs: recurring Low Stock Alert

## Delivery boundary

Source-only implementation. No regression or release checks, builds,
typechecks, automated release workflows, browser probes, preview restoration,
service restarts, migrations, deployments or live/test emails were run.
Only API source generation, generated-file formatting and source inspection
were performed. Runtime behavior, concurrent transactions, SMTP delivery and
browser layout have not been verified.

No development business data, backups or cleanup were touched. The independent
development cleanup request is neither implemented nor authorized here.

## Settings and contract

Super Admin Settings → **Cron Jobs** contains only **Low Stock Alert**.
The old `?tab=low-stock` link resolves to the same section as
`?tab=cron-jobs`. Inventory → Low Stock Alerts is unchanged.

Frequency is Daily, Weekly (Monday–Sunday) or Monthly (1–31).
Time is HH:mm, explicitly **Asia/Kolkata**; browser display preferences do not
alter the schedule. Start date is an inclusive lower bound on eligible dates,
not a second independent send. Monthly dates absent from a month are skipped,
never clamped to month-end. Calendar calculations use strictly future instants.

The mandatory recipient is resolved from the active protected Super Admin
account at occurrence claim time and is not editable. Up to 20 additional
validated addresses are supported. Empty rows must be removed; an empty list
removes only additional recipients. Equal addresses, including the protected
account address, are deduplicated case-insensitively. Delivery remains one
private email per unique mailbox, using only the selected Communication SMTP.
No CC/BCC list, test-send or manual-run action is introduced.

Configuration remains encrypted in the existing singleton payload. Existing
versions and owned request evidence are retained. Stale writes require explicit
reload/compare. Uncertain outcomes retain the submitted draft and request ID;
reconciliation uses the existing serialized durable cancellation boundary.
No settings or addresses are stored in browser storage. Failed initial loads
show an unavailable state, not a default/empty configuration.

GET/POST `/api/v1/admin/low-stock-settings` and owned
`/requests/{key}/reconcile` retain their transport and authorization boundaries.
Writes now carry event, frequency, weekday/month_day, start_date, local_time,
timezone and additional_emails, plus expected_version and request_id. Responses
include next_run_at and runtime_status/runtime_message. Scoped OpenAPI export
and direct Orval generation avoid the package wrapper that runs typechecks.
Unrelated refined Pricing Rules validators are preserved.

## Legacy transition and occurrence ownership

The old encrypted `additional_email` is read as a zero/one-element list until
an explicit save. The legacy default is Weekly, Monday, 10:00, Asia/Kolkata,
with start lower bound 1970-01-01. Nothing rewrites historical settings, requests,
weekly claims or recipient outcomes during migration.

Additive `0092_low_stock_cron` follows `0091_low_stock_alerts`. It adds
`low_stock_schedule`, `low_stock_occurrences` and
`low_stock_occurrence_deliveries`; it does not alter old tables or insert data.
The singleton cursor is initialized only by an explicit save or the matching
worker's first poll. Its initial instant is strictly future, so activation
does not send a catch-up digest.

One existing lifecycle worker replaces the weekly sender; no second sender is
registered. The settings advisory lock serializes cursor/configuration reads
and writes, followed by the existing worker lock. An occurrence is identified
by its scheduled timestamp, never by configuration version. Replicas consume
it and all recipient claims atomically before preparing stock or entering SMTP.
Changing configuration, recipients or saving again cannot reopen that claim.
Saving advances the cursor to the next future eligible instant; an already
due but unclaimed instant can therefore be skipped by a save.

Every retained legacy weekly claim suppresses new recurring deliveries for
that entire Kolkata week, even after schedule edits. This conservative
transition rule avoids duplicating an already consumed legacy digest.
The saved next-run summary accounts for that suppression; the editable draft
preview is a calendar-only preview and does not consult historical claims.

The worker polls every 60 seconds. It may claim a due instant only if that
worker was running before the instant and polling delay is at most 90 seconds.
A newly started replica leaves that short opportunity to existing replicas;
once it expires, all workers advance to the next future instant without
claiming or sending the missed one. Restarting never initiates a past send.
No downtime backlog is accumulated. Once claimed, bounded preparation/transport
may finish for up to ten minutes; restarting never resumes the handoff.

Complete authoritative inventory eligibility, zero-stock union, thresholds,
expiry exclusion and PO behavior are unchanged. Empty snapshots consume without
email. Each mailbox prepares independently. Durable `sending` precedes SMTP;
accepted and uncertain outcomes are terminal. Expired preparation/sending
leases become failed/unknown and clear transient encrypted destination payloads,
never resend. SMTP acceptance does not prove inbox delivery.

### Calendar examples (source reasoning, not executed tests)

- Daily at 10:00, observed 12 November 2026 at 11:00 Kolkata:
  next 13 November at 10:00.
- Weekly Monday at 10:00, start Friday 13 November 2026:
  next Monday 16 November, not an extra Friday send.
- Monthly day 31, start November 2026: November has no 31st,
  so next eligible date is 31 December.
- Monthly day 29: February 2027 is skipped; February 2028 is eligible.
- A saved 10:00 occurrence observed after downtime at 11:00 is skipped,
  not sent immediately.

## Activation handoff — not performed or authorized here

The declared development contract and generated application schema pin remain
`0089_it_material_pricing`. The additive migrations are staged beyond that
pin. Migration classification and staged migration source fingerprints are
maintained without advancing the approved schema target or changing historical
migration files. Readiness inherits predecessor probes; account/directory
successor admission remains an exact revision allowlist.

The new worker requires **both** the application pin and actual DB revision to
equal `0092_low_stock_cron`, plus all predecessor and recurring table shapes.
Legacy storage can still be loaded if present; missing predecessor storage
returns 503 with an actionable schema-activation message. Recurring saves and
reconciliation require new storage and cannot silently fall back to local
settings. The UI reports blocked activation or schema eligibility, never
unverified operational delivery.

The earlier failed Settings screenshot is not available as request/log evidence
in this task. Source inspection establishes that the declared predecessor
target does not provide the low-stock tables. Missing tables, unavailable
keyrings or API/service errors remain possible; no specific runtime cause is
claimed without the original response and matching revision evidence.

A separately authorized operator must:

1. Review the actual target, required recovery/approval boundaries and staged
   migrations; coordinate schema pin and integrity/review metadata through the
   existing procedures. Do not bypass workspace/schema guards or treat this
   document as migration permission.
2. Stop/drain **all old low-stock worker processes and in-flight SMTP handoffs**
   before applying the successor and starting matching binaries. Old binaries'
   revision gates reject the successor for new claims, but cannot recall an
   SMTP call already entered before migration. Mixed-version live activation
   without this drain is not supported.
3. Apply only separately approved migrations and start the approved matching
   revision. Confirm real readiness, worker lifecycle, keyrings, protected
   account mailbox and selected SMTP, without assuming schema eligibility proves
   delivery. Any live-email evidence needs separate explicit approval.

Until that independent work is approved and evidenced, scheduled delivery is
**not claimed operational**. No current task operation activates it.
