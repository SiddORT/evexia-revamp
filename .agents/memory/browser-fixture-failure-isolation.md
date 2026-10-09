---
name: Browser fixture failure isolation
description: Keep synthetic transport failures independent across multi-scenario browser tests.
---
Give initial lookup failures and later-page failures separate counters or
explicitly scoped transitions. An earlier Retry scenario must not consume the
failure intended for a later paging scenario.

**Why:** A selector test timed out waiting for “Retry load more” because an earlier
initial-error branch had already cleared its shared one-shot failure flag. The
control successfully loaded the page; the synthetic fixture never produced the
intended paging error.

**How to apply:** When a browser pass waits indefinitely for an error-only
control, first confirm the intended request actually received the injected
failure. Scope fixture state by request kind, page and scenario; do not loosen
the UI assertion to accommodate a fixture that skipped the scenario.
