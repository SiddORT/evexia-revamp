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
