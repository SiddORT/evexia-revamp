---
name: Filtered pnpm installs
description: Constraint encountered when adding a dependency to a leaf package in the pnpm workspace.
---

The language-package installer operates at the pnpm workspace root. A normal package request is rejected by pnpm's root-install check; passing a workspace filter as another package token is rejected before installation.

**Why:** A leaf web app needs to declare its own dependencies, but this installer does not expose a package-directory or workspace-filter option. Installing at the root would put a runtime dependency in the wrong manifest.

**How to apply:** Check for a supported scoped installation route before adding a dependency to a leaf package; do not assume the language-package installer can target it or bypass the error by adding command flags as package names.