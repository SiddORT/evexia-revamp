---
name: MR account and legacy boundary
description: Product scope requires real MR credentials without promotion or mixing of old identities.
---

## Reporting-manager identity

Live MR reporting managers are selected from Staff, not from MR records. Never
infer a Staff identity from a historical MR manager name or account.

**Why:** The user requires historical MR links and saved labels to remain intact
without guessing Staff mappings.

**How to apply:** Keep old assignments explicitly labeled as legacy until an
administrator replaces or clears them; a similarly named Staff record is not
evidence that it is the intended manager.

MR Master includes working MR login accounts. Do not silently migrate browser-local
MR records, attach existing identity-only MRProfiles, or rewrite downstream local
Doctor/Patient/Sales Target/payment references when extending it.

**Why:** The user explicitly included real MR accounts while requiring existing
identity/patient/file history and demo relationships to remain untouched and separate.

**How to apply:** New directory enrollment provisions a fresh account/profile.
Any future promotion, migration or reference conversion needs its own explicit
scope and operator review; a matching business label is not permission to bind identities.

New-MR enrollment must support an admin-visible generated candidate or a typed
initial password, with confirmation and an optional blank server-generation fallback.
Existing MR editing and Reset password remain separate.

**Why:** The user explicitly superseded the earlier automatic-only enrollment
presentation without expanding existing-password management.

**How to apply:** Do not restore an automatic-only notice when updating enrollment,
and do not interpret optional initial credentials as permission to expose saved passwords.

Account-namespace hardening must preserve bounded random-username collision recovery
in other provisioning services, rather than turn a retryable collision into a generic failure.

**Why:** A new namespace trigger can reject before the older unique index runs,
changing the structured conflict signal without changing the underlying collision.

**How to apply:** Keep deliberate database constraint identities stable and test the
existing provisioning contract whenever introducing shared account guards.

Live MR Doctors, Immunotherapy orders and Kits & Consumables orders must remain
separate from the fictional MR Dashboard, Targets and Payments. Do not migrate
demo contacts/orders or infer their live identities from matching names.

**Why:** The user separately approved the shared Doctor directory and these two
MR order workflows, without approving live sales/payment summaries or migration
of fictional/browser-local records.

**How to apply:** Keep new order-type, Dashboard/Targets/Payments and Doctor-portal
integrations separately authorized. Never pass shared Doctor/order IDs into
demo mutations. MR order identity is the verified saved account, non-reassignable
in MR; no generic master administration or cross-MR delegation is implied.
