---
name: Operator HTTPS trust
description: Preserve TLS verification when operator HTTP clients use the Replit preview.
---

Use the system CA trust store for live operator HTTP checks when curl succeeds
but Python HTTPX's default bundled trust store cannot connect to the same HTTPS
preview.

**Why:** A live development verification failed with HTTPX's default TLS
configuration, while an SSL context using the system CA bundle succeeded.

**How to apply:** Check the CA bundle exists and construct a verified SSL
context (in this environment, /etc/ssl/certs/ca-certificates.crt). Never disable
certificate verification or downgrade a credentials-bearing public request
to HTTP. Keep passwords, access tokens, refresh cookies and response bodies
out of operator logs; report only safe status/results.
