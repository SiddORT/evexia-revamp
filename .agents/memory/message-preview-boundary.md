---
name: Message preview boundary
description: Why message previews intentionally use conservative formatting and no external assets.
---

Message content is future delivery content, not a browser page. Retain the original authored source in storage, but preview only a conservative formatting allowlist after literal token substitution. Do not relax the sandbox or enable remote assets to make a preview resemble a real inbox.

**Why:** The feature explicitly treats imports, reloads and editable sample values as untrusted, and requires zero outbound requests, navigation or parent access. Detached browser DOM parsing can load resources before cleanup, so preview sanitation must not parse the raw source in a live browser DOM.

**How to apply:** Preserve the content-only boundary when adding preview features. Compatibility improvements must remain offline and inert; real provider token mapping and email-client compatibility are separate delivery work.