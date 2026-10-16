# Browser release-gate repair verification

Starting commit: `c2a1e57cd86fe9240e66bb7aec1c1ba21d407bc7`.

**Final status: NO-GO.** All identified failures have focused fixes, but the
final complete gate remains unverified after repeated workspace restarts killed
the test process. No repair commit, push or deployment was performed.

## Original failures and classification

The locations below refer to the original release-gate log,
`/tmp/evexia-policy-release.log`, before these test edits.

| # | Original failure | Classification | Correction and retained coverage |
| --- | --- | --- | --- |
| 1 | Allergen desktop, `allergens-backend.preview.spec.mjs:195` | Stale test | Include the search input between Refresh and the disclosure in keyboard order; still assert focus and keyboard disclosure behavior. |
| 2 | Allergen mobile, same location | Stale test | Same correction; retain mobile/dark persistence, conflicts, filters and deletion checks. |
| 3 | Order-entry layout, `order-entry-layout.preview.spec.mjs:47` | Stale accessible-name locator | Locate the actual `Selected patients (scrolls horizontally)` region; retain row-height, real doubled text, focus, overflow and arrow-key assertions. |
| 4 | Host resolution, `role-urls.preview.spec.mjs:222` | Stale Doctor entry expectation | Doctor now uses its explicitly fictional IMMUNO entry, not the retired generic Doctor authentication form. Assert the actual assigned entry, incompatible-route isolation, demo validation and zero authentication requests. |
| 5 | Mapped MR authentication, `role-urls.preview.spec.mjs:273` | Stale interaction | Open the profile menu before reading its account identity and signing out; retain host-bound cookies, renewal, reload, logout and wrong-identity rejection. |
| 6 | Role directory, `roles-permissions.preview.spec.mjs:224` | Stale pagination interaction | Use bounded cursor append through the scroll region instead of removed numbered-page controls. Assert 52 loaded roles, retained selection, draft guard on changing role, cancel behavior and refresh back to the first 50. |
| 7 | SPT layout, `spt-orders.preview.spec.mjs:124` | Stale accessible-name locator | Use the current patients region name; retain focus, horizontal scrolling, doubled text and responsive geometry checks. |
| 8 | Staff persistence/conflicts/export, `staff-backend.preview.spec.mjs:134` | Stale native-select interaction | Select the country through the named combobox and exact country-code option, rather than an ambiguous label/native `selectOption`; retain all server persistence, conflict and export assertions. |
| 9 | Staff retry/duplicate handling, `staff-backend.preview.spec.mjs:193` | Stale native-select interaction | Same country helper correction; retain ambiguous-create handling, draft preservation and server uniqueness checks. |
| 10 | Staff mobile credentials, `staff-backend.preview.spec.mjs:225` | Stale native-select/value expectation | Assert the displayed country/code on the actual combobox and saved telephone, retaining geometry and credential-clearing assertions. |
| 11 | Vendor catalogue, `vendors-backend.preview.spec.mjs:46` | Stale native-select interaction | Exercise the searchable catalogue and keyboard selection instead of native `<option>` children. Retain the catalogue-size lower bound, distinct Canada/US shared-code choices, invalid-number rejection and saved phone checks. |
| 12 | Vendor desktop, `vendors-backend.preview.spec.mjs:87` | Stale native-select/value expectation | Use the searchable country control and its displayed `IN +91` default; retain saved values, conflicts, status and deletion checks. |
| 13 | Vendor mobile, same location | Stale native-select/value expectation | Same correction, retaining mobile and dark-theme coverage. |

These classifications describe the original failing operations. Follow-on
failures discovered after correcting a locator must be investigated rather than
assumed stale or waived.

## Additional application defects exposed by the complete coverage

The first complete rerun passed all **209 main Chromium tests**, then exposed two
previously unreached WebKit failures at 1440px/200% text in Roles' classic/dark and
modern/dark appearances. These were a **real application layout defect**, not
stale assertions: WebKit allocated the refresh button its 40px minimum height
while its wrapped label required 72px, overflowing the button, footer and panel.

A label span and a grid-button trial did not solve the allocated-height issue;
both trial changes were removed. Temporary geometry diagnostics measured sizing
alternatives without changing the original failing assertions. Explicit
`height: fit-content` gave the button and footer their intrinsic content height.
The final application correction is scoped to `.rp-roles__footer .admin-button`
in `roles-permissions.css`. It retains the existing minimum hit-area height and
does not alter permissions, actions or unrelated controls.

The full, unchanged **45-case Roles matrix passed** with this correction:
15 each in Chromium 152.0.7977.64, Firefox 155.0 and WebKit 26.6. WebKit is engine
coverage, not a test of native Safari/macOS. All temporary diagnostic mutations
and unsuccessful markup/grid changes were removed.

The downstream Opening Balance compact-layout case exposed a second genuine
application defect, previously hidden behind its stale Doctor locator. At
900×360, its upward Doctor menu had a top coordinate of 364px and a collapsed
10px outer height, leaving the option outside the viewport. Setting inline
`top` to `undefined` exposed the shared stylesheet's downward `top` rule even
while the component supplied an upward `bottom` anchor.

The component now explicitly sets the unused anchor to `auto`, retaining its
existing fixed positioning, viewport sizing, query handling and modal keyboard
behavior. The compact-layout test retains real pointer selection and adds
viewport-bound checks for the popup across every existing theme/size case.
Temporary hit-testing diagnostics and the temporary shortened click timeout
were removed; no forced clicks or stacking-order workarounds were added.

The Sales Target matrix subsequently exposed a genuine Firefox desktop
enlarged-text defect: the maximum supported quarter value needed 217.65px for
text plus 22px padding, but its input had only 235px of client width. The
fixed 860px dialog width did not scale with enlarged text. A small fixed-width
increase fixed Firefox but still failed WebKit, so that trial was replaced
with `min(100%, max(860px, 50em))`: normal-size text retains the existing 860px
width, while enlarged text can use available viewport space. This reduces
neither text size nor monetary limits, hides no precision, and leaves the
responsive column rules and 100%-of-available-width cap intact. The original
clipping assertions are unchanged; temporary metric logging was removed.
The focused desktop enlarged-text case subsequently passed in all three engines.

The resumed full gate then exposed an intermittent Doctor deletion focus race
after **391 browser passes** (including four of five deletion cases). The
desktop case lost Refresh focus while the successful mutation's follow-up
reload toggled that button disabled. The Doctor hook previously incremented its
reload revision before its passive fetch effect marked
`loading`. The parent could briefly see an idle state, consume its focus-return
request, then lose focus when that late loading update disabled Refresh.

The Doctor hook now marks loading synchronously when requesting a reload. Its
existing focus-return effect therefore waits for the authoritative refetch to
settle before consuming the request. Mutation endpoints, persistence, deletion
retention rules and permissions are unchanged. The desktop/mobile Doctor and
Patient deletion regression now holds each post-delete list request, verifies
the loading indicator and Doctor Refresh's disabled state, releases it, and retains the original focus and
exactly-one-delete assertions. Held route handlers are settled before removal.
Patient Refresh intentionally remains available while loading; its hook and that
existing behavior are unchanged.

The focus repair passed all five deletion cases and all six Doctor CRUD cases.
The additional Patient regression pass exposed a stale readiness assumption in
its export-keyboard case: after typing a name filter, it could observe Export
briefly enabled between debounce completion and the ensuing fetch's loading
render, focus it, then lose focus as loading disabled it. The test now waits for
the exact successful name-filter response to finish before checking availability
and focusing Export. Its keyboard, Escape, download and import assertions remain;
no delay, force-focus loop or Patient application change was introduced.

## Downstream failures previously hidden by fail-fast

An independent sequential pass ran every remaining release browser group instead
of waiting through the backend and main Chromium checks again for each blocker.
It found these additional test/fixture mismatches:

| Suite | Observed failures | Classification and correction |
| --- | --- | --- |
| Patient layout matrix | 12 failures, 4 passes, 14 not run | Ten cases reached the ambiguous country label, matching both its combobox and disclosure button. Worker restarts consumed synthetic MR credential quotas, causing the final two setup failures. Use the exact named combobox; retain quota limits, real doubled text, saved phone checks and all three engines. |
| MR backend | 1 failure, 5 passes | The current stylesheet intentionally uses four assignment columns above 1050px, two below that breakpoint and one below 600px. The test still expected two at 1280px. Assert actual field geometry, equal widths and row-major order for four/two/one columns; add 1024px to retain explicit two-column coverage. A later assertion also measured the transparent semantic listbox instead of its painted shared-menu parent: assert the listbox remains visible, then check the full painted menu's bounds and contrasting opaque background. |
| Sales Target matrix | 1 failure, 35 not run; its 5 ordinary backend cases passed | The shared master toolbar now puts Refresh before Search and defines `gap: 12px` in `components/admin/masterFilters.css`. Correct the signed gap calculation and retain the original ±1px tolerance around that current 12px contract, not the retired 8px contract. Ordinary backend cases leave their own inactive targets, so use this fixture's unique MR name and assert its active row is visible before checking that inactive filtering is empty. Name search is an encrypted bounded section, not a global count: assert its exact applied-filter feedback and the named encrypted-search region rather than inventing `0 matching`. Alignment, dimensions, keyboard, disclosure and enlarged-text checks remain. |
| Opening Balance | 8 failures, 1 pass | Seven cases used the obsolete exact accessible name `Doctor` instead of the required-field name `Doctor *`. The remaining recovery case expected a picker error before opening its collapsed popup, and later tried to click its hidden continuation after Escape. Update the exact name, open the picker before error/retry assertions, and explicitly verify Escape closes the popup before reopening for continuation. Retain inactive-reference protection, drafts, conflicts, response timing and logout/late-response checks. |
| Directory deletion | 1 failure, 4 passes | The delete-only staff fixture supplied retired designation text instead of an active `designation_id`. Provision a real synthetic designation through the existing service and pass its ID; keep permissions and delete-confirmation assertions unchanged. |

The same pass completed these unchanged groups successfully: Downloads **30**,
MR workspace **3**, master/staff permissions **8**, Orders navigation **6**, role
lifecycle **1**, Patients backend **5**, password recovery **4**, development
compatibility **3**, date preferences **3**. Fresh reruns passed Patient layout
**30**, MR backend **6**, Directory deletion **5** and Opening Balance **9**.
Sales Target's complete rerun also passed: **5 ordinary cases + 36 matrix cases**.
The final full-gate rerun used frozen application/test source but was terminated
by another workspace restart before it could complete.

## Verification status

- `python -B -m unittest discover -s scripts/tests -v`: **98 passed**.
- Original 13-case targeted run: **10 passed, 3 failed** at later Vendor edit
  value assertions (`CA`/`AE` versus displayed `CA +1`/`AE +971`). Those assertions
  were then corrected, with no application change.
- `sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/vendors-backend.preview.spec.mjs`:
  **5 passed**, including all three Vendor failures and the two existing
  import/export and draft/session regressions.
- Final focus/data-flow checks: Directory deletion **5 passed**, Doctor backend
  browser flows **6 passed**, Patient backend browser flows **5 passed**. The
  Patient rerun includes the corrected filter-response wait.
- `pnpm run validate:release`: **NO-GO / incomplete final verification**.
  A completed attempt failed the Doctor deletion focus assertion after 391
  browser passes; that failure was fixed and passed the focused checks above.
  The subsequent full attempt was terminated by a workspace restart during
  backend checks. It produced no completed exit status, so it is not a pass.
- `pnpm verify:development`: **passed**, including candidate identity, ingress,
  running API and readiness, after restoring the Replit development processes.
- The policy unit suite was rerun after the final source changes: **98 passed,
  exit 0**. Its printed negative-authorization rejection is expected test output;
  it does not issue or claim a release authorization.

The first full-gate attempt exited 1 after 792 backend passes, 209 main Chromium
passes, and 43/45 Roles matrix passes. Its two WebKit failures are described
above. The intrinsic-height correction then passed all 45 Roles matrix cases.
The previously unreached downstream browser suites subsequently passed in
independent fixtures before starting the final full-gate rerun.

A subsequent full attempt was interrupted by a workspace restart. Its observed
progress included 792 backend passes and 117/209 main Chromium cases, but no
completed gate result survived; this is not counted as a pass. Source changes
survived unchanged on `main` at the original base commit. After the restart,
Chromium, Firefox and WebKit all passed actual launch/page-creation smoke checks.
The full rerun now retains output and explicit exit status in the already ignored
`.local/state/browser-release-repair/` workspace directory.
The later restart also terminated the new final attempt. Unlike temporary
logs, its durable output survived. Its stale running marker has been explicitly
marked interrupted rather than left as an apparent active or successful run.
The remaining requirement is one uninterrupted, successful full gate on the
current source before any local commit.

Complete affected-suite reruns used:

```sh
EVEXIA_ROLES_LAYOUT_ONLY=1 sh scripts/run-authenticated-previews.sh \
  artifacts/evexia-portal/tests/roles-permissions.preview.spec.mjs
# 45 passed across Chromium, Firefox and WebKit.

for spec in patients-layout mrs-backend directory-deletion opening-balances-backend sales-targets-backend; do
  sh scripts/run-authenticated-previews.sh "artifacts/evexia-portal/tests/$spec.preview.spec.mjs"
done
# Final successful individual reruns: 30, 6, 5, 9, and 5+36 passed, respectively.
```

The final release command is `pnpm run validate:release`, without a browser grep,
engine opt-out, skipped-test addition or altered quota/performance threshold.

The targeted run selected the original failing cases using Playwright's
`file:line` syntax, so it did not skip, invert or globally suppress test names:

```sh
sh scripts/run-authenticated-previews.sh \
  artifacts/evexia-portal/tests/allergens-backend.preview.spec.mjs:195 \
  artifacts/evexia-portal/tests/order-entry-layout.preview.spec.mjs:47 \
  artifacts/evexia-portal/tests/role-urls.preview.spec.mjs:222 \
  artifacts/evexia-portal/tests/role-urls.preview.spec.mjs:281 \
  artifacts/evexia-portal/tests/roles-permissions.preview.spec.mjs:224 \
  artifacts/evexia-portal/tests/spt-orders.preview.spec.mjs:124 \
  artifacts/evexia-portal/tests/staff-backend.preview.spec.mjs:137 \
  artifacts/evexia-portal/tests/staff-backend.preview.spec.mjs:196 \
  artifacts/evexia-portal/tests/staff-backend.preview.spec.mjs:228 \
  artifacts/evexia-portal/tests/vendors-backend.preview.spec.mjs:47 \
  artifacts/evexia-portal/tests/vendors-backend.preview.spec.mjs:89
```

The final Vendor edit moves its parameterized test declaration to line 90;
the full-spec rerun above does not depend on that line number.

## Scope

Changes are limited to the browser specs/helpers identified above, the scoped
Roles CSS, Opening Balance anchor, Sales Target dialog-width and Doctor reload-state corrections,
and this report. The existing
enlarged-text agent-memory note also records why text-bound checks alone were
insufficient during this investigation.

Approval policies, signature verification, artifact-integrity checks, migration
files and fresh-install guards remain unchanged. Tests use disposable
PostgreSQL/API fixtures, not production.

Exact changed files:

```text
.agents/memory/enlarged-text-whitespace.md
.agents/memory/frontend-test-hmr-isolation.md
artifacts/evexia-portal/src/components/admin/OpeningBalanceDoctorSelect.jsx
artifacts/evexia-portal/src/hooks/useDoctors.js
artifacts/evexia-portal/src/roles-permissions.css
artifacts/evexia-portal/src/salesTarget.css
artifacts/evexia-portal/tests/allergens-backend.preview.spec.mjs
artifacts/evexia-portal/tests/directory-deletion.preview.spec.mjs
artifacts/evexia-portal/tests/helpers/salesTargetToolbarSuite.mjs
artifacts/evexia-portal/tests/mrs-backend.preview.spec.mjs
artifacts/evexia-portal/tests/opening-balances-backend.preview.spec.mjs
artifacts/evexia-portal/tests/order-entry-layout.preview.spec.mjs
artifacts/evexia-portal/tests/patients-backend.preview.spec.mjs
artifacts/evexia-portal/tests/patients-layout.preview.spec.mjs
artifacts/evexia-portal/tests/role-urls.preview.spec.mjs
artifacts/evexia-portal/tests/roles-permissions.preview.spec.mjs
artifacts/evexia-portal/tests/spt-orders.preview.spec.mjs
artifacts/evexia-portal/tests/staff-backend.preview.spec.mjs
artifacts/evexia-portal/tests/vendors-backend.preview.spec.mjs
docs/browser-release-repair-verification.md
```
