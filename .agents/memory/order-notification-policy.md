---
name: Order notification policy
description: Placing-MR recipient scope, historical replay boundary and source-only implementation restriction.
---
Order notifications go to Super Admin and the authenticated MR who placed the
order, not the reporting manager, assigned MR inferred from an editor, other MRs,
ordinary staff, Doctors or Patients.

**Why:** The user explicitly clarified that the recipient is the placing MR and
excluded hierarchy/general-staff notifications.

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
