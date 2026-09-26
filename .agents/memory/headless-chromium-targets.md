---
name: Headless Chromium targets
description: Selecting the correct DevTools target when checking browser layout from the shell
---

When using Chromium's remote debugging protocol, filter the `/json` targets for a `page` with the intended URL (or `about:blank` before navigation); do not assume the first target is a tab. A bundled extension background page may be listed first.

**Why:** Selecting the first target made successful navigation and DOM checks run in an extension background page, producing misleading missing-element errors.

**How to apply:** Check the target's `type` and `url` before connecting to its WebSocket for ad hoc browser verification.

Headless DevTools key-down/key-up events alone may reach a focused native button without producing its activation click. For a keyboard activation check, dispatch the full Space sequence including a `char` event before key-up, and inspect the resulting click and expanded state; an isolated Enter key-down/key-up can misleadingly appear to fail.

**Why:** In a focused page, the button received Enter keydown but did not activate under an incomplete DevTools event sequence; Space with the character event did activate and Escape dismissed the control.

**How to apply:** When ad hoc browser checks disagree with native button behavior, verify the input event sequence before treating it as an accessibility regression.