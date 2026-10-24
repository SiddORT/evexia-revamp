---
name: MR contact masking scope
description: User-approved privacy boundary and explicit exclusions for MR person contacts.
---

Mask Doctor/Patient contacts for MRs, not names, demographics,
business registration identifiers or the signed-in MR's own details.
Preserve authoritative contacts and historical order snapshots.

The revised contact policy makes all authorized saved addresses visible,
including historical shipping and billing addresses. Mask the entire email
local part but retain the saved valid domain; phone displays reveal only the
last two digits, retaining safe masking for very short values.

The user's later UUID-display request supersedes the earlier record-ID display
non-goal: hide application-generated UUIDs throughout MR presentation while
keeping them as internal references. Preserve genuine saved business/account
and suborder numbers; do not invent replacements or redact uploaded bytes or
user-authored text.

**Why:** The user clarified "contact details only"; the masking requirement is
not permission to anonymize identities, alter stored records or hide MR self
information. The user explicitly superseded address masking with visible
addresses and domain-preserving email masking. The user also explicitly
requested removal of visible system UUIDs throughout the MR portal, including
listing tables.

**How to apply:** Keep masked presentation separate from new contact entry and
ID-based order submissions. Uploaded documents, filenames and arbitrary remarks
are outside this policy; never claim this makes attachment content anonymous.
