---
name: Browser-local record conflicts
description: Why browser-local Admin masters fail explicitly on stale or unreadable data.
---

For browser-local Admin master records, reject writes based on a stale tab's snapshot and block changes if saved data cannot be read; do not silently overwrite or reseed. MR assignments depend on the current zone snapshot; doctor assignments depend on the current MR and zone snapshots, so stale upstream data must block downstream writes.

**Why:** Two tabs can hold different snapshots. Without a conflict check, the later write can erase zones saved in the other tab. Treat unreadable storage as potentially valuable user data, not an empty collection.

**How to apply:** When changing zone, MR, or doctor persistence or moving it to a server, keep explicit stale-write detection and a clear refresh/recovery path before allowing mutations. Preserve missing assignment references visibly rather than silently replacing them.