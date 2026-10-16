---
name: Browser engine evidence
description: Why reported browser versions and launch success are insufficient for overridden Playwright engines.
---

Do not treat a successful launch or WebKit's reported version as proof that an
overridden executable matches the current Playwright driver.

**Why:** An older preinstalled Nix WebKit bundle reported the current driver's
WebKit version, yet could not create pages. An older Firefox launched normally
but rejected a newer viewport protocol field. These were fixture compatibility
failures, not failures of the application's acceptance or authorization gates.

**How to apply:** Use the current driver's downloaded engine revision, and
verify page creation as well as launch when configuring alternative executables.
Preserve the distinction between WebKit engine evidence and native Safari UI.

Avoid rewriting bundled Firefox shared libraries when adapting its runtime.

**Why:** Rewriting cached bundled libraries' search paths caused a crash during
NSS initialization; the untouched current Firefox libraries worked with a
launch-specific system-library path. This behavior is not apparent from the
application source.

**How to apply:** Keep browser library code untouched, isolate runtime settings
to the test engine, and keep the selected dynamic loader and libc consistent.

Revalidate configured Nix dependency-bundle paths after workspace/tool updates.
A Chromium-only installed bundle is not a replacement for the Firefox/WebKit
dependency source used by the multi-engine release adapter.

**Why:** A previously configured immutable-store bundle disappeared while the
replacement preinstalled bundle contained Chromium only. Focused Chromium tests
passed, but the broader gate could not prepare its required other engines.

**How to apply:** Check path existence and engine subdirectories before starting
the long gate. Keep this setup failure distinct from application assertions;
never skip required engines silently or claim full release evidence.
