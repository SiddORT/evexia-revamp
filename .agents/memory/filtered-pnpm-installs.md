---
name: Filtered pnpm installs
description: Constraint encountered when adding a dependency to a leaf package in the pnpm workspace.
---

The language-package installer operates at the pnpm workspace root. A normal package request is rejected by pnpm's root-install check; passing a workspace filter or `--workspace-root` as another package token is rejected before installation.

**Why:** The installer does not expose a package-directory or workspace-filter option. A leaf web app's runtime dependency cannot safely be installed into the root manifest, and root dev tooling should be kept out of production dependencies.

**How to apply:** Check for a supported scoped installation route before adding a dependency to a leaf package; do not assume the language-package installer can target it or bypass the error by adding command flags as package names. A root testing dependency was installable only after temporarily setting `ignore-workspace-root-check=true` in `.npmrc`; restore the setting immediately afterward and put the package in root `devDependencies`. Avoid this install path when it prunes unrelated entries from `pnpm-lock.yaml`; restore the original lock entries instead of accepting unrelated lockfile churn.