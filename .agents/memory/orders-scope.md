---
name: Orders scope
description: SPT is a session-only mock; keep other Orders workflows separate.
---

SPT order entry is intentionally a frontend-only evaluation workflow using fictional doctors, MRs, patients and orders. Its demo resets on a full reload. Do not connect it to real masters, persistence, or order submission without new requirements.

Keep Immunotherapy requirements separate; do not infer treatment workflows or order processing from the session-only SPT mock or the navigation setup.

**Why:** The user explicitly requested a session-only SPT mock before backend work and separated Immunotherapy requirements from the sidebar setup.

**How to apply:** Preserve the SPT evaluation boundary. Keep future Immunotherapy work driven by the user's new requirements, not sample records or assumptions based on other inventory pages.

The Doctor portal preview and the Admin immunotherapy order UI are separate workflows. An immunotherapy-branded hostname assigned to Doctor must still open the existing Doctor preview, not Admin order entry.

**Why:** The user explicitly separated hostname-based Doctor entry from the independently developing Admin immunotherapy workflow.

**How to apply:** Do not infer a new Doctor treatment or post-login route from the hostname's branding. Changes to Doctor authentication or workflows need separate requirements.

Lupin is also a fictional, frontend-memory-only evaluation workflow. It has a patient count, not a patient registry or individual clinical records. Its attachment picker keeps metadata only, and its filtered CSV must remain local with no backend export or upload.

**Why:** The user explicitly requested a session-only Lupin mock and excluded live masters, processing, persistence and file transfer.

**How to apply:** Preserve this boundary when reusing shared infrastructure: the real download-reporting service is not appropriate for this deliberately offline demo. Adding live data or reporting requires separate requirements.
