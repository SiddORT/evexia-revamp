# Platform message-dialog audit

## Scope and evidence

Source inspection only. The starting inventory contained **24 `window.confirm`
calls across 12 shipped source files**, plus leave-tab warning registrations in
**8 files**. No application alert/prompt calls or aliases to those native message
APIs were found. Ordinary local functions named `confirm` (payment, master
import, and Opening Balance actions) are business handlers, not browser dialogs.
Test-fixture strings containing `alert(...)` are not shipped message flows and
were not changed.

**No tests, browser tools, test harnesses, builds, release commands, or runtime
verification were run.** The findings below describe implementation and static
inspection, not observed browser behavior.

## Workflow inventory and replacements

| Workflow / trigger | Approved continuation | Restrictions retained |
| --- | --- | --- |
| Purchase Received: Cancel, sidebar/link, profile/sign-out, history traversal | Cancel editor or perform the originally requested navigation after themed confirmation | Busy saves, unresolved receipt requests, and uncertain outcomes block leaving; receipt reconciliation is unchanged. A review is treated as unsaved work. |
| Purchase Orders: Cancel and navigation, including restored/unconfirmed saves | Discard ordinary draft, or leave with the existing recovery identity retained | Busy requests block leaving. Unconfirmed-save copy explicitly explains reopening to retry the same request. No pending journal is cleared by navigation. |
| Purchase Orders: conflict reload | Reload latest order only after explicit discard acceptance | Busy ref is rechecked; save/retry and stale-review rules are unchanged. |
| Opening Balance: reload current server details | Perform the existing guarded detail read after acceptance | Busy/unmounted forms cannot continue. Uncertain creates still require inspecting the shared list; reload does not infer an uncommitted save. |
| Doctor / Patient: refresh saved details | Retry record read and replace form only after acceptance | Existing blocked-save and identity logic are unchanged. |
| Role URLs: replace/open draft, Cancel, Settings section/link/history/profile/sign-out navigation | Change editor or navigate only after acceptance | Shared role/domain busy state blocks leaving. Conflict/uncertain reload/review behavior is unchanged. |
| Primary domain: cancel edited hostname | Clear local draft after acceptance | Existing busy restrictions retained; no save or DNS action is triggered by discard. |
| Hostname ownership: Revoke | Perform the existing versioned revoke request after explicit destructive acceptance | Existing locked/uncertain/stale restrictions retained. No revoke request is sent before approval. |
| Email/SMS templates: channel switch, select/create/delete action, drawer/editor close, Settings/navigation | Perform the selected action only after acceptance | Busy editor/library operations remain blocked. Async guard consumers await the result; no Promise is treated as approval. Existing save/reconciliation identities and unknown-outcome restrictions are unchanged. |
| Email template: imported HTML replacement | Replace HTML draft only after acceptance, without saving | File-read errors preserve the draft; busy state remains set while deciding. |
| Email/SMS template: reopen latest | Fetch/reopen saved version after explicit discard acceptance | Existing stale-version and reconciliation behavior is unchanged; reopening does not resend a save. |
| MR unsaved demo forms: links, menus, history, sign-out | Continue the first navigation/action only after acceptance | Cancellation retains memory-only data. Sign-out retains the actual logout callback, not merely its destination. |
| Doctor demo: payment editor close/Cancel and payment navigation | Close or navigate after a topmost themed choice, keeping the payment editor mounted until then | The local payment-commit handler is not a native dialog and is unchanged; discard does not submit payment. |
| Doctor demo: other dirty-page navigation | Existing platform discard dialog remains | One pending action is retained rather than replaced by later requests. |
| Roles & Permissions / Immunotherapy | Existing platform navigation dialogs remain | Native unload registration removed; existing save rules retained. Shared modal layering keeps editor/confirmation keyboard handling separate. |

## Shared presentation and continuation rules

- A role-neutral confirmation host uses the current workspace's theme variables.
  It imports no Admin navigation, identity, or data services.
- One outstanding choice; additional requests cancel rather than queue. An owner
  unmount cancels its choice. Confirmation resolves once.
- Cancel receives initial focus. Escape and backdrop dismissal mean cancellation.
  The layer traps focus and makes its sibling content inert, then restores prior
  inert state and focus (including a stable dropdown trigger fallback).
- Native HTML editor drawers retain their top-layer ownership: confirmation is
  portalled inside the open drawer, not hidden behind it. Existing editor dialogs
  do not handle the confirmation's keyboard events. Dialog labels are unique.
- Captured links and profile/sign-out requests preserve their original
  continuation. Internal links stay client-side and respect the artifact base.
  Same-document Back/Forward restores the current entry while deciding and replays
  the accepted traversal without requesting confirmation again. History entries
  predating portal initialization lack position metadata; their fallback preserves
  the mounted editor on cancellation rather than promising exact history topology.
- No browser message API is overridden.

## Browser limitations and exclusions

No application handler registers `beforeunload` or requests its native warning.
**Hard reload and closing a tab/window cannot display a replacement custom HTML
confirmation, and no longer receive the former unsaved-changes warning.**
Memory-only drafts can therefore be lost. Cross-document browser history exits,
browser termination and operating-system termination are also outside the
same-document navigation guard; no autosave or new draft persistence was added.

File pickers, print dialogs, browser permissions, password-manager UI, native
date controls, and other operating-system/browser-owned UI are unchanged.
Platform `<dialog>` elements contain application-styled content; they are not
hostname/OK/Cancel browser message dialogs.
