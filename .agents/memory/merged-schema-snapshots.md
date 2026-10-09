---
name: Merged schema snapshots
description: Completion-time merge synchronization can invalidate code-derived export files.
---

Treat a code-derived downloadable schema dictionary as a commit-specific snapshot, and regenerate it if completion synchronization brings in newer merged backend work.

**Why:** The task workspace can lack a concurrently merged schema change until the completion callback synchronizes project work. A workbook that passed local coverage validation can then omit tables visible to the completion review.

**How to apply:** Record the source commit in the file, check available merged-source refs before generating, and inspect completion feedback for newly synchronized models/migrations. Reconcile the refreshed metadata, regenerate the file and validation evidence, and replace the download handoff rather than merely changing its advertised count.
