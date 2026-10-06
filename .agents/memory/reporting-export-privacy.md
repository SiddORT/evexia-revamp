---
name: Reporting export privacy
description: Why portable reporting exports have a narrower identity boundary than the protected history UI.
---

Keep session references and record/correlation identifiers out of Sessions & Activity Logs CSVs, even when those references are safe to show inside the authenticated history UI. Preserve browser-reported versus server-recorded provenance.

**Why:** The user required exports to exclude raw session identifiers and private record details. A downloaded report can be copied outside the authenticated application, so its field selection must not simply inherit the history table's references.

**How to apply:** Treat future additions to portable reporting fields as a separate privacy decision; do not automatically copy new table columns into CSVs. Account labels are already reporting fields, but downloaded files still require private handling.
