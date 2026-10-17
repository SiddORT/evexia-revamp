---
name: Message preview boundary
description: Why message previews intentionally use conservative formatting and no external assets.
---

Message content is future delivery content, not a browser page. Retain the original authored source in storage, but preview only a conservative formatting allowlist after literal token substitution. Do not relax the sandbox or enable remote assets to make a preview resemble a real inbox.

The only image exception is a fixed offline raster of the application-owned EVEXIA logo. Establish that identity from the authored source before substituting samples; sample strings must not acquire trusted-image privileges. User data URLs, lookalike logo paths, SVG and remote resources remain forbidden. Preserve link presentation using inert elements, never live anchors.

**Why:** The feature explicitly treats imports, reloads and editable sample values as untrusted, and requires zero outbound requests, navigation or parent access. Detached browser DOM parsing can load resources before cleanup, so preview sanitation must not parse the raw source in a live browser DOM. Branded reset previews require the official logo without expanding image support or connecting to real account recovery.

**How to apply:** Preserve the content-only boundary when adding preview features. Compatibility improvements must remain offline and inert; real provider token mapping and email-client compatibility are separate delivery work.

Native modal inertness alone is not evidence of strict keyboard focus containment: reverse Tab can move focus into browser chrome, and sandboxed iframe keystrokes do not bubble to the parent dialog. Verify both boundaries and iframe traversal when changing this workspace.

**Why:** Authenticated Chromium checks exposed a reverse-Tab escape despite a correctly opened native modal. The opaque preview iframe must remain sandboxed rather than gaining parent access for focus handling.