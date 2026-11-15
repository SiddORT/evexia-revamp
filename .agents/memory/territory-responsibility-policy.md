---
name: Territory responsibility policy
description: Clarified MR scope, exact Doctor location and historical adoption boundary.
---

MR has exactly one Zone after an explicit territory change, with optional multiple
HQs and optional multiple Areas. Empty HQs/Areas deliberately cover the entire
Zone; selected HQs without any Areas cover those entire HQs; once any Areas are
selected, responsibility is only those Areas, never additional whole-HQ coverage.
Doctor has exactly one Zone, HQ and Area and chooses one active eligible MR.
Offer every covering MR without priority or automatic selection.

**Why:** The user explicitly superseded the earlier multi-location Doctor draft
and the earlier requirement that every MR match list explicit Areas.

**How to apply:** Keep absent scope unreviewed rather than treating it as
deliberate breadth. Do not collapse historical multi-Zone MRs or infer Doctor
Areas. Changed assignments must be explicit. Coverage changes alone never
reassign existing Doctors or grant visibility; MR Doctor access stays owner-only.

MR Add and Edit use the normal Zone/HQs/Areas editor, without a separate legacy
territory panel, adoption/revert actions or legacy territory warning. Unrelated
edits preserve the saved null scope and assignments. Multiple saved Zones require
a deliberate single-Zone choice before territory changes; use neutral saved-fact
descriptions rather than claiming entire-Zone or entire-HQ responsibility.

**Why:** The user requested removal of the legacy territory experience, not
historical assignment conversion or broader responsibility. Reporting-manager
compatibility and unrelated warnings remain outside this simplification.

**How to apply:** Separate editor presentation from persisted scope, and save
intentional territory changes through the normal form save.
