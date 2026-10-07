---
name: Dropdown focus and pending actions
description: Modal dropdown accessibility and focus-return constraints during asynchronous actions.
---

Keep asynchronous dropdown actions protected by a synchronous submission guard,
but preserve a focusable destination when the menu closes. A disabled trigger
cannot receive the menu's normal focus return; disabling it immediately after
selection can leave keyboard users without a useful focus position.

**Why:** An export menu passed keyboard and dismissal checks but lost focus when
selection started a pending download. Restoring focus only after the request
finished did not reliably recover the close-time focus transition.

**How to apply:** For future async menus, distinguish action availability from
focusability. A controlled menu plus `aria-disabled` can prevent pending
reopening while allowing normal focus return. Verify pending/error states,
not just Escape. Modal dropdowns hide background roles from assistive technology;
outside-pointer dismissal tests should target coordinates or DOM elements
rather than accessibility roles that are intentionally hidden.
