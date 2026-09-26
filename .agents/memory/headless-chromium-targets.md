---
name: Headless Chromium targets
description: Selecting the correct DevTools target when checking browser layout from the shell
---

When using Chromium's remote debugging protocol, filter the `/json` targets for a `page` with the intended URL (or `about:blank` before navigation); do not assume the first target is a tab. A bundled extension background page may be listed first.

**Why:** Selecting the first target made successful navigation and DOM checks run in an extension background page, producing misleading missing-element errors.

**How to apply:** Check the target's `type` and `url` before connecting to its WebSocket for ad hoc browser verification.