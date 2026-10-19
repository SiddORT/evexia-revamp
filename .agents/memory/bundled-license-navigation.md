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

**How to apply:** A raw-text import exposed through a lifecycle-managed Blob URL
with a plain-text content type avoids that ambiguity without depending on an
external license host. Check Blob resources in the page's browser context and
verify a real link opens the readable license; server-side HTTP clients cannot
resolve browser-owned Blob URLs.
