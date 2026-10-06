---
name: Staff search privacy
description: Why encrypted directory search uses explicit bounded scans instead of substring indexes or automatic background traversal.
---

Preserve deliberate bounded scanning for encrypted staff directory searches; do
not add deterministic substring indexes or silently traverse every section to
make search appear instantaneous.

**Why:** Substring tokens would introduce frequency and search-pattern leakage
beyond the existing email uniqueness boundary. Automatic traversal would turn a
single browser action into unbounded decryption work. The accepted tradeoff is
explicit continuation and honest partial-result scope, with no stored search
sessions or plaintext results.

**How to apply:** For future changes to directory searching, assess index leakage
and aggregate request work before choosing a different approach. Revisit the
privacy review in `docs/staff-security.md`; treat cursors as positions, never as
authorization, and retain a fresh permission check on every section.
