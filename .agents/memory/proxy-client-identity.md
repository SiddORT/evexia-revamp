---
name: Proxy client identity
description: Authentication availability requires authenticated client identity behind shared ingress
---

Strict proxy handling must preserve trustworthy per-client identity, not merely
discard forwarding metadata. A shared proxy address must not become every
user's authentication quota key.

**Why:** Removing forwarded identity while retaining IP-based login and recovery
limits lets one unauthenticated caller exhaust the shared proxy's quota and
deny service to unrelated users.

**How to apply:** Keep hostname admission independent. Accept only single-IP
identity overwritten by explicitly trusted socket peers; reject malformed
trusted metadata rather than silently falling back to a shared bucket. Verify
distinct-client quota isolation through the actual proxy configuration, as
well as rejection of caller-supplied forwarding chains.

Preserve HTTPS browser-origin validation when tightening proxy handling.
An authenticated account's role is not evidence that a rejected origin should
be trusted, and a generic HTTP 403 is not evidence of a missing account permission.

**Why:** Strict proxy handling left the API seeing HTTP behind the HTTPS preview.
The cookie-origin check rejected a legitimate development request, which the
frontend mislabeled as missing Admin access despite the protected role being intact.

**How to apply:** Keep origin/CSRF and exact-peer checks intact. For development,
use only the explicit approved HTTPS preview origin in the development-scoped
allowlist; never apply this as a production wildcard or trust arbitrary forwarded
headers. Preserve existing configured origins when updating the allowlist.
