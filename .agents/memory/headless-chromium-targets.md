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

Headless Chromium's default viewport can match an app's mobile breakpoint, even when checking desktop-only controls. Explicitly set a desktop viewport before navigating for collapse checks, and wait for React state to settle after clicks.

**Why:** A desktop collapse assertion timed out in the default narrow viewport because the app correctly remained in mobile layout.

**How to apply:** Set viewport dimensions before loading the page, then switch dimensions intentionally for responsive checks.

DevTools navigation/reload acknowledgments do not mean the new document is ready. An immediate selector check can still match the previous document.

**Why:** A post-reload drawer check clicked a matching button in the outgoing document and reported that the new page failed to open its drawer.

**How to apply:** Wait for the navigation's load event or a confirmed new document before waiting for React selectors and dispatching input. Do not use a selector present on both old and new pages as the navigation-completion signal.

In this Nix environment, downloaded Playwright Chromium binaries may fail to launch because they expect system libraries outside Nix. Prefer the environment's installed Chromium for local browser checks rather than attempting Debian-style dependency installation.

**Why:** Downloading Playwright's binary did not fix missing shared libraries, and its install-deps route is not supported here; the already-installed Chromium has compatible runtime libraries.

**How to apply:** Locate Chromium with `which chromium` and use Playwright's executable-path override for local checks. Keep this override optional so other environments can use their standard browser installation.