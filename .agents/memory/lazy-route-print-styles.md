---
name: Lazy-route print styles
description: Print rules from lazy-loaded portal screens must not affect later routes.
---

Scope global print-layout overrides to the presence of the specific report being printed.

**Why:** A lazy route's imported CSS remains loaded after navigation. Unconditional body visibility or Admin layout overrides can hide unrelated pages when users subsequently print them.

**How to apply:** For same-page printable dialogs, gate ancestor layout overrides with the report's presence (for example, `body:has(.report-class)`) and verify printing after leaving that route still shows the destination page.
