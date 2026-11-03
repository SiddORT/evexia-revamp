---
name: Order notification policy
description: Placing-MR recipient scope, historical replay boundary and source-only implementation restriction.
---
Order notifications go to Super Admin and the authenticated MR who placed the
order, not the reporting manager, assigned MR inferred from an editor, other MRs,
ordinary staff, Doctors or Patients.

**Why:** The user explicitly clarified that the recipient is the placing MR and
excluded hierarchy/general-staff notifications.

MR-placed Immunotherapy placement is an explicit exception: external delivery
is Super Admin email only; preserve the placing MR's existing bell. Its SMS and
WABA copies remain authoring-only even with provider configuration/metadata.
Only this Super Admin alert/email may include the saved patient name and
Asia/Kolkata placement date; do not expand this to other events or MR feeds.

**Why:** The user authorized this narrowly scoped placement notification, not
broader clinical/contact disclosure or additional channel activation.

Saved allergen names and group occurrences are authorized in the Super Admin
Immunotherapy placement email only, not bell feeds, MR responses, SMS or WABA.
The order link must use a server-owned admitted portal origin and conveys no
additional permission; historical missing facts must not be reconstructed.

**Why:** The user explicitly limited the allergen disclosure and required the
existing authenticated order-details page rather than public or tokenized access.

**How to apply:** Keep other order types and lifecycle recipient rules unchanged;
do not infer new send authority from template edits or recipient-account edits.

**How to apply:** Preserve immutable creation-time identity through reassignment
and retention. Notification links are not new order permissions.

Configuration changes activate future eligible events, never historical blocked
messages; uncertain provider handoffs must not automatically resend.

**Why:** A provider setup must not cause a backlog burst, and an unobserved
acceptance cannot safely be treated as a failed send.

**How to apply:** Distinguish blocked, definite failure, unknown and provider
acceptance without claiming confirmed recipient delivery.

The notification implementation was explicitly source-only, without tests,
builds, checks, probes, sends, business mutations, migrations or service activation.

**Why:** The user prohibited those operations for this delivery.

**How to apply:** Do not describe prepared code/schema as runtime-verified or use
automatic migration startup as a verification shortcut.

Changing the Admin email does not authorize new notification rules or enabling
additional sends.

**Why:** The user said they will specify which notifications to send step by step.

**How to apply:** Keep recipient-account maintenance separate from notification
template, event and delivery activation changes.
