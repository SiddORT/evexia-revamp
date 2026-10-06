---
name: Route download recovery
description: Keep portal chunk recovery explicit so unsaved local drafts are never discarded automatically.
---

Do not automatically reload the portal when a deferred route download fails.
Offer an explicit reload with an unsaved-changes warning; leave authorization
and same-route session-renewal lifetimes unchanged.

**Why:** A failed lazy import is cached, so clearing an error screen alone does
not necessarily retry the download. Global automatic reloads on Vite preload
errors could discard an already-mounted browser-local editor draft.

**How to apply:** Keep pending downloads distinct from errors. If improving
in-place retry later, account for both React lazy's rejected promise and the
browser module cache, without keying or replacing healthy editor subtrees.
