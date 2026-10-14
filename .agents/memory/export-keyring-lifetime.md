---
name: Export keyring lifetime
description: Bound encryption-key reuse to a single authorized synchronous export.
---

Reuse validated encryption primitives only for the lifetime of an authorized
synchronous export. Do not cache decrypted fields or carry keyring reuse across
operations, users, or configuration changes.

**Why:** Reconstructing a validated keyring for each encrypted property read
dominated large MR exports. Operation-local reuse restored the existing
performance budget without weakening ciphertext/AAD authentication, scan limits,
or authorization. Process-wide caching would complicate key changes and failure
isolation.

**How to apply:** Authorize before entering the scope, validate readiness afresh,
and restore the prior context in a finally block. Verify success, nested scopes,
exceptions, corrupt ciphertext, and changed configuration at the next operation.
Do not spawn asynchronous work within this synchronous scope.
