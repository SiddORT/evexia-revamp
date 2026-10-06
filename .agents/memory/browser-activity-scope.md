---
name: Super Admin activity scope
description: Agreed tracking scope and provenance boundary for Super Admin activity.
---

Track page visits and record actions, not every button click.

**Why:** The user selected “Track page visits and record actions only (recommended)” for Sessions & Activity Logs.

**How to apply:** Cover successful record changes and imports/exports, but do not add keystroke, form-content or general click telemetry. Keep browser-reported observations distinct from authoritative server operations: authentication proves who sent the report, not that browser-local records were securely changed. Pending reports must never be reassigned to a later login.

An offline preview may still emit the approved minimal activity observations; that does not persist its domain data or make its actions authoritative.

**Why:** Directory and role previews intentionally retain local-only data while the authenticated shell reports page visits and successful local actions.

**How to apply:** Treat domain persistence and observation reporting as separate contracts. Privacy checks should forbid form content and domain mutations in network traffic, while allowing only the approved resource/action observations and event identifiers.
