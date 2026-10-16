---
name: Development preview origins
description: Forked workspaces can inherit an allowlist for the previous preview address.
---

When a task workspace's HTTPS login returns 403 while health/readiness succeed,
check whether its development origin allowlist still names an older workspace.
Add only the independently observed current HTTPS development origin, retaining
existing approved origins; never bypass same-origin checks or use wildcards.

**Why:** A fork can inherit an otherwise valid origin configuration for a
different preview. This rejects login before credentials are evaluated and
should not be diagnosed as an incorrect password or repaired by resetting it.

**How to apply:** Inspect the development-only configuration, compare the actual
preview origin, and restart the API after an exact-origin update. Keep production
settings unchanged and verify real login/logout over the preview URL.
