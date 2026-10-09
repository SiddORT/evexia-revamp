---
name: Orders scope
description: SPT is a session-only mock; keep other Orders workflows separate.
---

SPT order entry is intentionally a frontend-only evaluation workflow using fictional doctors, MRs, patients and orders. Its demo resets on a full reload. Do not connect it to real masters, persistence, or order submission without new requirements.

Keep Immunotherapy requirements separate; do not infer treatment workflows or order processing from the session-only SPT mock or the navigation setup.

**Why:** The user explicitly requested a session-only SPT mock before backend work and separated Immunotherapy requirements from the sidebar setup.

**How to apply:** Preserve the SPT evaluation boundary. Keep future Immunotherapy work driven by the user's new requirements, not sample records or assumptions based on other inventory pages.
