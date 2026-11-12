---
name: Opening-only development activation
description: Keep opening correction activation independent from unrelated staged branches and avoid restoring release workflows.
---

Opening-only activation must not inherit unrelated low-stock scheduling or
designation changes merely because they share a staged source merge.

**Why:** The user approved continuing with an opening-only path after the
existing ancestry would have activated unrelated features. The standing automatic
development migration policy still applies to an independently bounded path;
it is not permission to expand the requested feature scope.

**How to apply:** Inspect the actual applied database revision and complete
pending ancestry before activation. Preserve future source joins separately
from the declared development target. Coordinate readiness and offline
maintenance inventories with the chosen ancestry; never infer compatibility
from a generic green readiness response or merged route source alone.
