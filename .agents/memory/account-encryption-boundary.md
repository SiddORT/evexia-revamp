---
name: Account encryption boundary
description: Approved ciphertext-only account/history scope and key-retention tradeoff
---

The user approved combining user identifier and identifier-reservation encryption
to require ciphertext-only storage, rather than retaining transitional plaintext.
Preserve existing identities/passwords in place despite permission to recreate
disposable accounts; invalid or conflicting identifiers need explicit review.

**Why:** Historical identifier reservations depend on the account namespace;
keeping the prior trigger contract would retain plaintext copies.

**How to apply:** Keep account/history encryption and ownership protections
consistent. Directory encryption keys are reused with account-specific domains,
but directory-only key rotation does not rekey accounts/history: retain their
old decryption keys until separately reviewed account rekeying is implemented.

ORM bulk inserts can silently ignore unmapped Python identifier properties.

**Why:** Ignored plaintext parameters can create an account missing its intended
identifier rather than failing; this is not acceptable for provisioning.

**How to apply:** Fail explicitly on unsupported plaintext bulk account writes;
use validated account mutation paths instead of relying on property setters
being invoked by bulk SQL operations.

Query-count budgets must distinguish fixed account-readiness checks from
projection reads, while bounding both independently.

**Why:** Fail-closed account encryption adds a constant readiness cost to
identity loading; an old aggregate budget can mistake that for per-record
query growth. Removing readiness or allowing arbitrary overhead would hide
real security or scaling regressions.

**How to apply:** Keep the existing projection budgets, recognize only exact
readiness statements, and assert a small bounded number of paired checks.
