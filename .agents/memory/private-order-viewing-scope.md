---
name: Private order viewing scope
description: Approved MR and Super Admin read-only previews and unchanged access boundaries.
---

MR may privately preview verified saved prescriptions/attachments on the
Immunotherapy and Kits & Consumables saved-order View pages. This supersedes
the earlier Admin-only viewer scope for these two MR order types only.

MR may also privately preview verified saved attachments on the Lupin saved-order
detail page. This approval does not extend to Admin/staff Lupin views.

Super Admin may also privately preview verified saved Kits & Consumables
attachments on both the saved-order summary and the Edit order/pricing screen,
including retained attachments. This does not extend previews to other staff
or unsaved file selections.

**Why:** The user explicitly extended viewing to MR without extending ownership,
file permissions or unsaved entry uploads. The user separately approved the
Super Admin Kits summary and retained editor attachment extension.
The user also explicitly approved the MR-only saved Lupin attachment extension.

**How to apply:** Reuse the isolated authenticated PDF/image viewer and existing
server authorization. Do not infer permission to preview unsaved selections,
change upload requirements, or introduce public file links.
