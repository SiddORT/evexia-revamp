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

This also applies to actions inside nonmodal combobox popups: keep paging
buttons focusable while pending and return focus before final-page or retry
actions disappear.

**Why:** Disabling a focused paging action can emit a blur with no destination,
which an outside-focus handler interprets as dismissal before new choices appear.

**How to apply:** Guard duplicate requests synchronously, use `aria-disabled`
for pending actions, and test keyboard focus through paging and retry transitions.

For server-paged choices, preserve the search/page when dismissal merely moves
focus to a paging control. Reopening the selector must not silently request
page zero or erase the current filter.

**Why:** Local-only selectors commonly clear their search when closed or
focused. Reusing that behavior for a server-paged Doctor picker made a selected
later page unreachable when the user reopened the menu after paging.

**How to apply:** Make search retention opt-in for server-paged consumers,
retaining existing local-selector behavior. Explicit search changes/clears and
completed selections may reset paging; test selection from the actual later
page rather than re-searching the target's unique identifier. When paging
controls sit outside the overlaid menu, dismiss it first; do not force clicks
through the popup and bypass normal pointer hit testing.

When closing a record dialog also refreshes its list, restore focus by stable
record/action identity after the refreshed list is ready, not only by keeping
the original element reference.

**Why:** A dialog's normal cleanup returned focus correctly, but the subsequent
loading state removed that row and lost the focus again. Enlarged-text keyboard
tests revealed this even though closing and refreshing both succeeded.

**How to apply:** Treat refresh readiness and focus return as one transition.
If the original row was deleted or filtered away, return to a stable page
action instead. Do not retain stale rows or weaken save/version checks just
to preserve a DOM element.
