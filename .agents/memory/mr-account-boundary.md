---
name: MR account and legacy boundary
description: Product scope requires real MR credentials without promotion or mixing of old identities.
---

MR Master includes working MR login accounts. Do not silently migrate browser-local
MR records, attach existing identity-only MRProfiles, or rewrite downstream local
Doctor/Patient/Sales Target/payment references when extending it.

**Why:** The user explicitly included real MR accounts while requiring existing
identity/patient/file history and demo relationships to remain untouched and separate.

**How to apply:** New directory enrollment provisions a fresh account/profile.
Any future promotion, migration or reference conversion needs its own explicit
scope and operator review; a matching business label is not permission to bind identities.

Account-namespace hardening must preserve bounded random-username collision recovery
in other provisioning services, rather than turn a retryable collision into a generic failure.

**Why:** A new namespace trigger can reject before the older unique index runs,
changing the structured conflict signal without changing the underlying collision.

**How to apply:** Keep deliberate database constraint identities stable and test the
existing provisioning contract whenever introducing shared account guards.
