---
name: Super Admin activity scope
description: Agreed tracking scope and provenance boundary for Super Admin activity.
---

Track page visits and record actions, not every button click.

**Why:** The user selected “Track page visits and record actions only (recommended)” for Sessions & Activity Logs.

**How to apply:** Cover successful record changes and imports/exports, but do not add keystroke, form-content or general click telemetry. Keep browser-reported observations distinct from authoritative server operations: authentication proves who sent the report, not that browser-local records were securely changed. Pending reports must never be reassigned to a later login.
