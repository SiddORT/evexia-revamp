---
name: Browser-only auth channels
description: Why cross-tab channels must not start merely because Node exposes the browser API.
---

Create cross-tab authentication channels only in a browser context, not merely
when BroadcastChannel exists.

**Why:** Node also provides BroadcastChannel and an open channel keeps its event
loop alive. Adding authenticated release gating to previously pure PDF services
can therefore make passing unit tests hang just by importing the module.

**How to apply:** When server-side/unit-test imports reach browser authentication,
check for a real browser context before creating channels. Tests that sign in
should also sign out in cleanup so renewal timers cannot keep them running.
