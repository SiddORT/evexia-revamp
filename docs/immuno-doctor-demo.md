# IMMUNO PORTAL Doctor demo

## Boundaries

The existing EVEXIA web artifact contains `/doctor` and `/doctor/*`. No backend,
database, hostname configuration, authentication, account recovery, or real
Admin/MR workspace was changed to implement this demo.

- **No account:** Enter demo collects nothing. The optional form accepts only the
  displayed `doctor@example.invalid` / `demo-only-pass` fictional pair and calls
  the transition demo entry, never verified sign-in. Recovery only displays a
  local acknowledgement: no email sent and no password changed.
- **No business storage:** all Doctor business records and submission references
  are module memory only. Ordinary client navigation retains them; a full reload
  reconstructs fictional samples. Exit demo clears them. A deep link to a new
  record after reload shows record unavailable, not another user's data.
- **No business traffic:** there are no Doctor network clients, uploads, gateways,
  SMS/email/push providers or analytics/activity calls. The unchanged portal
  hostname resolver is routing infrastructure and still restricts incompatible
  portal hosts.
- **Shared preferences only:** the existing Admin theme, appearance and date
  preference machinery is reused. The profile explains that appearance is
  browser-local and shared with other EVEXIA screens. Preference actions from
  Doctor suppress activity observations; Admin's existing default remains intact.
- **No clinical inference:** sample tests record entered values and units, not
  diagnoses or recommendations. Doses require explicit manually entered details.
  Fulfillment, payments and dosage completion never imply each other.

## Connected workflows

- Dashboard derives patient counts, doses, recent tests, active orders and
  outstanding money from the same records used by the lists and profiles.
- New patients belong only to the fictional doctor. Their initial note is dated;
  no tests, past treatment or orders are automatically generated.
- Allergy-test entry has patient/date, entered results/controls/units, review and
  save steps, then a printable sample report and profile history link.
- Scheduled doses preserve the original scheduled date separately from the
  manually recorded completion date. Repeated completion is idempotent. Reminders
  are visible in-app date examples only; nothing runs while the app is closed.
- Orders use a small fictional catalogue with integer minor-unit prices, positive
  whole quantities up to 999 and review before draft/place. Drafts have no
  payable balance until placed. Submission references prevent duplicate orders.
- Demo payments review exact string amounts before recording integer minor units.
  Zero, negatives, excess precision, non-decimal forms and over-balance amounts
  reject. Partial/full labels and dashboard balances derive from one ledger.
  Printable acknowledgements say DEMO and no money moved.
- My MR is a fictional, read-only current mapping and dated previous/sample
  activity timeline, not a live directory or contact action.
- Reports derive patient history, tests, dosage, orders and payment summaries
  from current records with patient/date/status filters. Inverted dates show a
  recoverable error.
- Clinic Reviews and System Feedback are separate. Review averages follow the
  displayed/selected sample set. The A4 clinic sheet excludes patient contact
  and clinical details and disclaims verification or publication permission.
  Portal feedback is held only in memory and explicitly not sent to support.

## Presentation and navigation

Doctor components reuse Admin semantic colors and presentation styles, the
official EVEXIA logo, searchable selectors, dialog focus handling and pagination.
No Admin layout, permission checks, mutation services or business records are
used. Doctor-only CSS scopes print behavior; page-size rules are mounted only
with the active printable preview, so leaving it does not change later printing.

Draft guards cover local links, history traversal, Exit demo and browser unload.
The mobile navigation uses an inert background, focus trap and Escape return.
Unknown routes/records remain safe within hostname restrictions.

## Focused checks

```sh
pnpm --filter @workspace/evexia-portal run test:doctor-demo
EVEXIA_PREVIEW_BASE_URL=http://127.0.0.1:25965 \
  EVEXIA_CHROMIUM_PATH=/repl/tools/bin/chromium \
  pnpm --filter @workspace/evexia-portal run test:doctor-demo:browser
pnpm --filter @workspace/evexia-portal run build
```

Use the actual running Vite listener for the browser command. The focused suite
requires no account or database; it stubs only hostname resolution, records
storage writes, rejects business/auth requests and uses synthetic inputs.
It covers connected care/commerce, recovery, reports/reviews/feedback, unsaved
navigation, printing and Classic/Modern light/dark at 1440/768/390/320 pixels.
Browser printing/Save as PDF is the supported export; no PDF engine or server
export is introduced. Chromium evidence is not native Safari or Firefox evidence.

The completion-time full `pnpm run validate:release` attempt passed its service/API
groups but stopped before browser execution: the configured
`EVEXIA_NIX_BROWSER_LIBRARY_SOURCE` directory was absent. The available
preinstalled replacement contained Chromium only, not the Firefox/WebKit
dependency bundles required by that adapter. No release checks were weakened.
The Doctor-specific Chromium suite, focused regression tests and portal
compilation were verified separately; this is not a full release-gate pass.
