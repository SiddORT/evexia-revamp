# Role URLs enlarged-text regression

## Result — 2026-10-17

**48 passed, 0 skipped, 0 unexpected failures, 0 flaky, in 2.7 minutes.**
No production CSS or component changes were needed.

| Engine | Reported version | Cases passed |
| --- | --- | --- |
| Chromium | 152.0.7977.64 | 16 |
| Firefox | 155.0 | 16 |
| WebKit | 26.6 | 16 |

WebKit is Safari-engine evidence, not a test of the native macOS/iOS Safari UI.

## Verified checks

`artifacts/evexia-portal/tests/role-urls-layout.preview.spec.mjs` and
`playwright.role-urls-layout.config.mjs` define 48 cases:

- Chromium, Firefox and WebKit (not native Safari).
- Classic light/dark and Modern light/dark.
- 320px, 390px and 768px viewport widths, plus a 1440px viewport with the Role
  URLs panel constrained to at most 650px.
- Computed font sizes doubled from an unmodified snapshot, with explicit
  heading, label, body and DNS-code size-ratio assertions.
- Long reserved `.example` hostnames and an unbroken TXT value; exact DNS
  Type/Name/Value content, multiline ranges, ancestor/control bounds, mapping
  action bounds and no page-wide overflow.
- Mapping and primary editors, expanded deployment instructions, and real
  keyboard Tab entry with visible focus at enlarged text size. All measured
  heading, label, body and code size ratios were exactly 2.

The test mounts the actual portal, client session boundary, Settings screen,
Role URLs component and primary-domain panel in a dedicated Vite instance.
Browser API requests are intercepted: refresh/current-user responses use an
explicit synthetic Super Admin identity and a fake token; portal resolution and
Role URLs reads use synthetic fixtures. Incidental page-view reporting receives
a synthetic response. Unknown API endpoints and Role URLs writes are blocked,
and the test asserts that neither occurs. Vite's API proxy points at an
intentionally closed local port. No database or real credentials are needed.

This verifies presentation only. It does **not** verify server authorization,
session security, persistence, DNS propagation or native Safari behavior.
No challenge creation, DNS verification, activation or revocation is exercised.
No configured database or DNS state was modified.

## Reproduction

```sh
sh scripts/run-role-url-layout-previews.sh
```

The runner prepares the current Firefox/WebKit engines using its existing Nix
adapter and uses Chromium through the shared engine configuration. Missing
engines fail rather than being skipped.

For collection only, without launching browsers:

```sh
EVEXIA_ROLE_URL_LAYOUT_PREVIEW=1 pnpm exec playwright test \
  --config=playwright.role-urls-layout.config.mjs --list
```

The runner preserves the browser command's failure exit status, stops its Vite
process on exit and writes per-case measurements, screenshots and JSON results
to an independent ignored `test-results/role-urls-layout/run-*/` directory.

## Evidence

Completed run: `test-results/role-urls-layout/run-20261017-110903-3947/`.

- `playwright.log`: case outcomes and actual engine versions.
- `results.json`: full Playwright results and per-case measurement attachments.
- `artifacts/`: 48 PNG screenshots, including visible DNS-action focus at 200%.
- Each case records all three states: mapping editor, primary editor and DNS
  actions, including font ratios, text ranges, control/ancestor bounds and
  intercepted request summaries.

JavaScript/shell syntax checks and `git diff --check` also passed.

## Earlier setup failures

The initial backend-backed attempt stopped before browsers because application
schema `0043_email_templates` differed from Alembic head
`0044_purchase_received`. No schema contract, guard or release approval was
changed. The dedicated frontend-only fixture removes that unrelated backend
dependency rather than bypassing its initialization checks.

A subsequent browser worker exhausted its heap because each of thousands of
geometry assertions retained the full diagnostic tree. The test now preserves
all comparisons while aggregating concise violations and attaching the complete
measurements once per state. Only the completed 48-case run above is acceptance
evidence; interrupted attempts are not counted as passes.

The earlier presentation-only access report in
`docs/role-url-presentation-review.md` remains a historical record. This report
provides the later isolated enlarged-text verification without claiming that
the configured backend access limitation has been resolved.

## Completion validation limitation

The configured broader local release validation was attempted after the focused
48-case pass. It reached the completion system's roughly 30-minute polling
limit and its recorded terminal status was `STOPPED`. The release shell stages
were stopped or never scheduled; their named outputs were unavailable. This is
not evidence that those stages passed, and no failing product assertion was
available to repair. The completion code-review step returned exit code 0.

Completion therefore uses the passing isolated presentation matrix and syntax
checks above, with an explicit audited exception for the interrupted broader
validation. The backend release checks and schema guards remain unchanged.
