# Role URLs presentation regression coverage

## Running the suite

From the repository root:

```sh
pnpm --filter @workspace/evexia-portal run test:role-urls-presentation:browser
```

The existing authenticated preview harness creates a private, socket-only
PostgreSQL database, starts isolated API and Vite listeners, supplies synthetic
credentials, and removes its database on exit. The suite is also included in
the harness's default run. Do not point it at a deployment or a normal
development database.

## Assertions

`artifacts/evexia-portal/tests/role-urls-presentation.preview.spec.mjs`
defines 24 Chromium cases: direct entry and in-app navigation, each at desktop
(1440 × 1000), tablet (768 × 1024), and mobile (390 × 844), with Classic and
Modern in both light and dark appearance.

- Authenticate using the existing real API helper without first loading a page,
  so a direct Settings visit cannot inherit CSS from a previously rendered route.
- For navigation, enter Settings through the profile menu, then enter Role URLs
  from General and revisit it from every other Settings category.
- Assert the authorized panel and primary-domain panel finish loading.
- Assert actual computed sans-serif typography: body/search/button 14px, title
  20px, section headings 18px, supporting boundary text 13px, editor title 16px.
- Assert semantic heading levels, bold heading weights, all four outer padding
  values and the visible intro inset, and no document horizontal overflow.
- Repeat after a direct reload or each category transition, and after moving
  the actual shared Admin and Settings stylesheet nodes after the panel styles.
  This last check intentionally uses Vite's development stylesheet markers.
- Open and cancel an unchanged local editor draft; never submit it.
- Repeat the panel checks with a verified 32px root font size (200% rem text).
- Block and report any attempted non-GET Role URLs API request. No mapping,
  domain, DNS challenge, verification, activation, or live configuration is changed.
- Save representative desktop/tablet/mobile screenshots for both entry paths.

The suite does not test backend authorization, DNS/provider integration,
nonempty directory/DNS layouts, removal dialogs, or Firefox/WebKit. It does not
replace existing authenticated behavior tests.

## Execution evidence — 2026-10-17

The isolated runner was invoked once for this spec. Its four preliminary
bootstrap checks passed. Before API startup or browser collection, initialization
failed with:

```text
RuntimeError: Preview application revision must match the single repository head.
```

The application's declared revision was `0043_email_templates`, while the
repository's single Alembic head was `0044_purchase_received`. This is unrelated
to a clean/dirty Git working tree. No test assertion or screenshot was produced,
and none of the 24 browser cases has been verified by that attempt.

Do not disable this guard, change the normal API workflow, or apply a migration
to a shared database to get presentation evidence. After the separately scoped
development schema synchronization work restores a consistent application
revision and migration head, rerun the command above and record its actual result.
The earlier preview-access record in `role-url-presentation-review.md` remains
historical evidence, not a successful review of the protected page.

After authoring, `node --check` passed for the spec, `sh -n` passed for the
harness, `git diff --check` passed, and Playwright `--list` successfully
collected exactly 24 tests in this one spec. Collection is not browser execution.
