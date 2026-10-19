---
name: Bundled license navigation
description: Development-server behavior when a package license has no extension.
---

Do not assume a successful build proves an extensionless package license can be
opened through an imported asset URL. Keep license contents available locally
and verify the actual user-facing link, including keyboard activation.

**Why:** Vite's development server treated an extensionless package LICENSE
requested through its generated asset URL as JavaScript. The build succeeded
but opening the license returned an error and could trigger the development
error overlay.

**How to apply:** Verify the actual user-facing navigation, not just bundling
or link presence. Browser-owned resources must be checked in their browser
context; a server-side HTTP client cannot prove that they open correctly.
