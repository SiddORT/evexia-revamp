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

Vite's development client can reload independently of React on full-update,
circular-import recovery, and server reconnection paths. A mounted hidden/inert
boundary alone does not protect drafts from these reloads.

**Why:** Development recovery must not turn a service restart into an automatic
loss of browser-local editor state. Vite's reload notifications are not
cancellable simply by subscribing to them.

**How to apply:** Preserve the development-only suppression of automatic client
reloads, fail closed if Vite changes that interface, and use a separate new tab
when an update genuinely requires a new page. Verify actual full-reload messages
over the browser websocket, not just direct calls to the compatibility store.
