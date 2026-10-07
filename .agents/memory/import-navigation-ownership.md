---
name: Import navigation and template ownership
description: Backend-only masters need shared navigation without mock template ownership.
---

Keep backend-only master import navigation separate from mock template ownership.
Adding a master tab must not imply that its authenticated sample downloads or
reviews can fall back to local preview data.

**Why:** Headquarter's server import route existed while the shared tabs were
derived only from mock templates, so the route had no selected Headquarter tab.
Adding a mock template just to expose navigation would blur the protected
server workflow's ownership.

**How to apply:** Include backend-only masters in shared import navigation using
display metadata only; retain their authenticated sample, review and confirmation
services. Keep unrelated preview masters unchanged.
