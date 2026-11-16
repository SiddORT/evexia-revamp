# Outgoing EVEXIA email presentation

## Source changes only

No regression/release checks, builds, probes, render executions, screenshots,
service restarts, migrations, business-data writes, mail sends or channel
activation were performed for this change. The review was a reading of source
and diffs. Inbox compatibility and running application behavior remain unverified.

## Coverage inventory

| Family | Existing entry point | Presentation |
| --- | --- | --- |
| Kits, SPT, Lupin and ordinary Immunotherapy lifecycle/transactions | `order_notification_transport.prepare` → `order_event_contract.render` | Shared frame; exact untouched seeded HTML/text pairs become event heading, saved order number and vertically labeled facts. INR transaction amount appears only in the transaction default. |
| Dedicated MR Immunotherapy placement to Super Admin | Same renderer, dedicated assignment and `validate_template` | Shared frame for body fragments; saved authored wording, patient/MR/date, repeated allergen groups and authenticated order URL remain intact. No generic order facts are added. |
| Password recovery | `email_delivery.dispatch` → `render_recovery` / `_render` | Shared frame for body fragments; preserves expiry, one-use/security wording, button, fallback URL and URL validation. |
| Staff and MR invitations | Same account renderer | Same frame; retains separate portal, login ID, action URL, expiry and security wording. |
| Existing explicit account/placement test emails | `email_template_tests.send_test` → `render_test` | Uses the same live rendering functions plus the existing unmistakable test notices and fictional values. No new test-send feature or recipient is introduced. |
| Low-stock digest | `low_stock_worker.rendered` | Shared frame, labeled item sections, original snapshot, quantities, thresholds, reasons and protected inventory link. |
| Expiry digest | `expiry_worker.prepare` | Shared frame, labeled batch sections, original introduction, today/next-15-day grouping and the two existing protected inventory destinations. Empty groups say None in both alternatives. |
| Authoring Modern-layout action | `modern_email.modern_html` | Produces the same frame, not a separate delivery-only design. Existing authored complete layouts are not wrapped again. |
| Offline previews | `messageTemplatePreview.buildEmailPreview` and both editors | Mirrors the frame and pristine order projection before sample substitution. Logo uses bundled offline raster; anchors remain inert and sandbox/CSP remain restrictive. |

The source search found one SMTP handoff (`recovery_mail.send_smtp`), shared by
these families. Low-stock and expiry have no separate explicit test-send path.

## Saved content and queued work

This is runtime presentation, not a template data migration. No stored source,
subject, assignment, template version, provenance or token is rewritten.
Untouched generic order defaults are recognized only by the exact historical
HTML **and** text pair and event key. Any edited pair retains its authored words.
The frontend uses the same rule so opening a preview does not create an edit.

The existing configuration/template-version guards run before order rendering.
Pending work still eligible under those guards will use the new runtime
presentation when this source is later activated; stale-version work stays
blocked. There is no requeue, retry or historical replay.

Authored logos or styled table layouts retain their own presentation rather than
receiving another branded card. Logo attributes are validated with the existing
allowlist, then normalized to useful alt text, a 154px width and automatic height
from the bundled 631×328 raster. The wrapping decision uses unsubstituted source,
not order/account names. No image, font, script, tracking or link permission was
added. All substitutions remain single-pass and escaped.

Generic email timestamps are formatted from the saved aware instant into an
explicit `IST (Asia/Kolkata, UTC+05:30)` display. Stored instants and SMS/WABA
values are unchanged. Custom text remains authored text with the same variables;
the pristine order pair gains equivalent labeled plain text.

## MIME and remaining validation

The text/HTML alternatives and TLS transport remain unchanged. The logo is
attached as a legitimate inline CID resource only when the final HTML has an
image whose source is that exact CID. A client may still list a legitimate
inline resource among attachments.

Future, separately approved validation should cover all event families,
customized and already-branded templates, long values on narrow screens,
blocked-image fallback, MIME trees, literal token injection, and offline preview
parity. Nothing here establishes successful inbox delivery or activates rollout.
