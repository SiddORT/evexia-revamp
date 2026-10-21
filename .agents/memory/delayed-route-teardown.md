---
name: Delayed browser route teardown
description: Coordinate held response handlers before removing interception in browser tests.
---

Release a deliberately held browser response and await its handler's completion
before removing that route. Keep route-clearing and newly registered
late-response scenarios in separate tests when global teardown is needed.

**Why:** Removing an intercepted route while its handler was awaiting a test
barrier caused a later fulfillment to fail as already handled, obscuring the
actual stale-response behavior. Clearing all routes mid-test also left a later
interception scenario unreliable; separating the scenarios restored it.

**How to apply:** Use explicit started/release/finished barriers for delayed
handlers, or wait-aware teardown at the end of a scenario. Do not relax the
application's identity or file-response guards to compensate for fixture races.

A pending-save banner proves a recovery identity exists, not that the request
or its intercepted response handler has finished.

**Why:** A lost-reply scenario removed its interception as soon as the journal
banner appeared. Playwright resumed the still-active request while its handler
was fetching the server response, producing a second idempotent send and an
already-handled route error instead of the intended recovery evidence.

**How to apply:** Await a handler-completion barrier and the UI's terminal busy
state before removing interception or clicking recovery. Preserve the real
server commit and idempotency rules; do not infer completion from journal UI.
