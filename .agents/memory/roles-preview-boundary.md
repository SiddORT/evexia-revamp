---
name: Roles preview boundary
description: Product scope for demo permissions versus real EVEXIA authorization.
---
Roles & Permissions is an interactive frontend preview, not real access control. Keep it independent of staff role choices, login roles, Super Admin permissions and actual access enforcement.

**Why:** The user explicitly requested UI-only demo roles with no role API calls or browser-storage writes; even Save must mean page memory only and reload must reset the preview.

**How to apply:** Treat the demo catalogue as illustration, never as an authorization policy or a source for staff role assignments. Any persistent or enforced permissions feature needs a separately approved scope.
