---
name: Historical encryption inventories
description: Keep historical staging and retirement contracts distinct from new encrypted fields.
---

Freeze the field inventory used by historical encryption staging and retirement migrations. Add new encrypted fields through separate forward migrations; the runtime inventory can expand without changing those historical contracts.

**Why:** Historical staging operates on a schema that predates later encrypted fields. Reusing an expanded runtime inventory there makes fresh installations and populated historical recovery expect columns or plaintext fields that never existed.

**How to apply:** When extending encrypted directories, preserve the earlier inventory for staging/retirement tools and historical tests, while including new fields in runtime encryption and key-rotation coverage. Offline rotation must select an inventory by explicitly reviewed schema revision: old paused maintenance retains its old fields, and the new revision includes the additions. Never infer compatibility from an arbitrary future revision.
