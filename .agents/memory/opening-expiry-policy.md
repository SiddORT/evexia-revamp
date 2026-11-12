---
name: Opening expiry policy
description: Explicit opening expiry and the approved audited-correction boundary for unused saved openings.
---

Opening expiry is optional and must be explicitly entered. Blank means unknown.
The user subsequently approved audited corrections of all business fields on
unused saved openings, including supplying expiry on an existing undated entry.
This supersedes the earlier new-rows-only restriction, not the ban on automatic
backfills or treating a reused import identity as an edit command.
Any committed downstream activity permanently blocks editing, even if its net
stock effect later returns to zero. Preserve original values and revision-specific
actors/dates; changing an expired lot must not revive it.
Future-dated allergen openings use the common expiry policy, while unknown,
expiry-today and expired stock stay blocked at the Asia/Kolkata boundary.
Finished-product eligibility is unchanged.

**Why:** The user explicitly selected all opening business fields for correction,
while requiring immutable history and blocking used lots rather than rewriting
dependent transactions.

**How to apply:** Preserve unknown historical dates unless explicitly corrected
through the protected reviewed editor. Original and revised backups are deduplicated
against retained history, never replayed or used to undo an edit. Do not change
the separate Stock Status physical-versus-usable visibility policy.
