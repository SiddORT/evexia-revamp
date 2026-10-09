---
name: Directory encryption scope
description: Intentional operational-identifier exceptions and linked-account disclosure boundary.
---

Keep Doctor registration numbers, MR employee codes and Patient codes usable as
business/operational identifiers, with existing global normalized uniqueness
including deleted records. Do not broaden directory encryption into an account
authentication redesign or rewrite identity-only Patient owners.

**Why:** The user explicitly retained these business identifiers and scoped this
security work to the three directories plus personal fields actually present in
the related Patient owner table.

**How to apply:** Inspect the current merged schemas before extending encryption.
Disclose that linked User email/username and reserved account identifiers remain
plaintext outside the directory scope. Do not describe MR directory encryption
as encryption of all MR account personal data. Equality indexes also disclose
equality/frequency; their use does not provide substring-search privacy.

Exports include every matching record, never just the visible search section.
Reject the export explicitly when finite scan or file limits prevent completeness;
do not download a partial file.

**Why:** The user specified “every matching record” when clarifying encrypted-search exports.

**How to apply:** Keep display continuation separate from the export match scope,
and explain any complete-export limit before offering a file.
