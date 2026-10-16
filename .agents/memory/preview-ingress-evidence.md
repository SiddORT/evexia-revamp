---
name: Preview ingress evidence
description: Distinguish routed browser evidence from direct frontend-port fallbacks during compatibility recovery.
---

Do not treat an HTML API response from a direct frontend listener as proof that
the routed development preview is misconfigured. Compare the actual browser
origin's candidate and API responses with the operator verifier's hostname
before changing routing or restarting services.

**Why:** A reported persistent compatibility block was not reproducible in a
fork: the routed HTTPS and local preview both returned matching JSON and rendered
the portal, despite earlier direct-frontend-port HTML evidence. A candidate pass
and an API-only pass also cannot establish what a particular browser received.

**How to apply:** Record endpoint status, response type, identity/readiness and
rendered access on the same origin. State when the original user's tab or host
embedding is unavailable; do not claim a guessed routing cause was repaired.
