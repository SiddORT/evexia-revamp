---
name: Session-ending reasons
description: Trust boundary for explaining historical session revocations.
---

Explain a revoked session using only its first successful, owner-matched session revocation event and an explicit allowlist of known causes. Missing or unknown history must remain unavailable, not inferred from later events.

**Why:** A safe-looking legacy literal may still contain sensitive text, and later credential revocations or repeated logout attempts do not explain the original transition.

**How to apply:** When adding a lifecycle cause, deliberately extend the reporting allowlist and its plain-language explanation; keep reporting read-only and never consult refresh credentials.
