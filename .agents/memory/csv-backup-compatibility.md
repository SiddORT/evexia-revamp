---
name: CSV backup compatibility
description: Preserve import compatibility when Admin export columns change.
---

When an Admin CSV export gains a field, continue accepting the prior exact header shape and assign a deliberate default for the missing field. Keep rejecting arbitrary reordered or unsupported columns.

**Why:** A user may rely on a CSV exported by an earlier version as their only local backup; requiring only the newest header silently removes that recovery path.

**How to apply:** Review both export and import contracts together whenever adding or changing a CSV column, and test a previous-version file as well as a current one.