---
name: Private order viewing scope
description: Approved MR read-only previews and the boundaries that remain unchanged.
---

MR may privately preview verified saved prescriptions/attachments on the
Immunotherapy and Kits & Consumables saved-order View pages. This supersedes
the earlier Admin-only viewer scope for these two MR order types only.

**Why:** The user explicitly extended viewing to MR without extending ownership,
file permissions, entry/edit screens, or unrelated Admin Kits viewing.

**How to apply:** Reuse the isolated authenticated PDF/image viewer and existing
server authorization. Do not infer permission to preview unsaved selections,
change upload requirements, or introduce public file links.
