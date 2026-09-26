---
name: Browser-local zone conflicts
description: Why Zone Master fails explicitly on stale or unreadable browser data.
---

For browser-local zone records, reject writes based on a stale tab's snapshot and block changes if saved data cannot be read; do not silently overwrite or reseed.

**Why:** Two tabs can hold different snapshots. Without a conflict check, the later write can erase zones saved in the other tab. Treat unreadable storage as potentially valuable user data, not an empty collection.

**How to apply:** When changing zone persistence or moving it to a server, keep explicit stale-write detection and a clear refresh/recovery path before allowing mutations.