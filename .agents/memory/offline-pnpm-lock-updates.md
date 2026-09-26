---
name: Offline pnpm lock updates
description: Why an offline lockfile-only update can fail on unrelated workspace metadata
---

Workspace-wide `pnpm install --lockfile-only --offline` can fail to resolve metadata for a dependency in an unrelated package, even when updating only an existing leaf package's manifest and removing dependencies.

**Why:** The local mirror did not have required metadata for a separate workspace package during a lockfile-only pruning operation; a normal online lockfile-only update succeeded without changing the intended scope.

**How to apply:** If an offline lock update fails on unrelated missing metadata, try the normal lockfile-only operation rather than modifying the unrelated package or forcing an inconsistent lockfile.