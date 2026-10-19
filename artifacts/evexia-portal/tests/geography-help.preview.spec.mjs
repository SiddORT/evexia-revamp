import { test, expect } from '@playwright/test';
if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: {
  executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'] } });
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL;

test('Add/Edit geography help and shared postal draft safety with synthetic APIs only', async ({ page }) => {
  test.setTimeout(120000);
  let mode = 'unique';
  const calls = [];
  const pending = [];
  const choice = { country: 'India', state: 'Maharashtra', city: 'Postal-only locality' };
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/v1/auth/')) {
      return route.fulfill({ json: url.pathname.endsWith('/me')
        ? { id: 'synthetic-admin', email: 'synthetic@example.test', system_role: 'super_admin', permissions: ['admin.access'] }
        : { access_token: 'synthetic-token', expires_in: 900 } });
    }
    if (url.pathname.includes('/postal/')) {
      calls.push(url);
      if (mode === 'held') { pending.push(route); return; }
      if (['503', '403', '429'].includes(mode)) return route.fulfill({ status: Number(mode),
        json: { error: { code: mode === '503' ? 'mr_pin_unavailable' : mode === '429' ? 'mr_pin_rate' : 'forbidden' } } });
      return route.fulfill({ json: { choices: mode === 'multiple' ? [choice, { ...choice, city: 'Second locality' }]
        : mode === 'empty' ? [] : [choice], message: 'No matching location. Enter the address manually.' } });
    }
    // Deny all non-postal master API calls: this test never writes directories.
    return route.fulfill({ status: 403, json: { error: { code: 'fixture_denied' } } });
  });
  await page.route('**/__geography-fixture', (route) => route.fulfill({ contentType: 'text/html', body: `
    <html><body><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/tests/helpers/geographyFixture.jsx');
    </script></body></html>` }));
  await page.goto(`${base()}/__geography-fixture`);
  await page.waitForFunction(() => Boolean(window.geographyFixture));
  await page.evaluate(() => window.geographyFixture.login());
  const mount = async (kind, editing, historical = false) => {
    await page.evaluate(({ kind, editing, historical }) => window.geographyFixture.mount(kind, editing, historical), { kind, editing, historical });
    if (kind !== 'storage') await page.getByTestId(`tab-${kind}-address`).click();
  };
  for (const kind of ['storage', 'mr', 'doctor', 'patient']) {
    for (const editing of [false, true]) {
      await mount(kind, editing);
      // Add Doctor/Patient retain their existing default India contract.
      const country = page.locator(`#${kind}-${kind === 'storage' ? 'countryCode' : 'country'}`);
      if (await country.inputValue()) {
        await country.click();
        await page.getByRole('option', { name: 'Clear country', exact: true }).click();
      }
      for (const field of ['state', 'city']) {
        const control = page.locator(`#${kind}-${field}`);
        await expect(control).toBeDisabled();
        await expect(control).toHaveAttribute('placeholder', `Select ${field === 'state' && kind === 'storage' ? 'state/ut' : field}`);
        const info = page.getByTestId(`button-${kind}-${field}-info`);
        await info.focus();
        const help = page.getByRole('region', { name: `About ${field === 'state' && kind === 'storage' ? 'State/UT' : field === 'state' ? 'State' : 'City'}`, exact: true });
        await expect(help).toContainText(field === 'state' ? 'Select a country first.' : 'Select a country and state first.');
        await info.press('Tab');
        await expect(help.getByRole('link', { name: 'country-state-city', exact: true })).toBeFocused();
        await page.keyboard.press('Tab');
        const license = help.getByRole('link', { name: 'GPL-3.0 license' });
        await expect(license).toBeFocused();
        const licenseText = await license.evaluate(async (link) => {
          const response = await fetch(link.href);
          return { ok: response.ok, type: response.headers.get('Content-Type'), text: await response.text() };
        });
        expect(licenseText.ok).toBe(true);
        expect(licenseText.type).toContain('text/plain');
        expect(licenseText.text).toContain('GNU GENERAL PUBLIC LICENSE');
        expect(licenseText.text).toContain('Version 3, 29 June 2007');
        await page.keyboard.press('Escape');
        await expect(info).toBeFocused();
        await expect(help).toBeHidden();
        await info.click();
        await expect(help).toBeVisible();
        if (kind === 'storage' && !editing && field === 'state') {
          await page.screenshot({ path: 'artifacts/evexia-portal/test-results/geography-help-open.png' });
        }
        await info.press('Escape');
      }
      expect(await page.evaluate(() => window.fixtureSubmits)).toBe(0);
      await page.locator(`#${kind}-pincode`).fill('411001');
      await expect(page.locator(`#${kind}-city`)).toHaveValue(choice.city);
      expect(calls.at(-1).searchParams.get('action')).toBe(editing ? 'edit' : 'add');
      expect(calls.at(-1).pathname).toContain(`/admin/${kind === 'storage' ? 'storage-locations' : kind === 'mr' ? 'mrs' : `${kind}s`}/postal/411001`);
    }
  }
  await mount('storage', true, true);
  await expect(page.locator('#storage-city')).toHaveValue('Historical locality');
  for (const [status, message] of [['503', 'Postal provider is unavailable'], ['429', 'PIN lookup limit reached'], ['403', 'You do not have permission']]) {
    mode = status;
    await page.locator('#storage-pincode').fill(`41100${status === '503' ? '2' : status === '429' ? '3' : '4'}`);
    await expect(page.locator('#storage-pin-feedback')).toContainText(message);
    await expect(page.locator('#storage-city')).toHaveValue('Historical locality');
    await expect(page.locator('#storage-address')).toHaveValue('Original street draft');
    if (status !== '403') {
      mode = 'unique';
      await page.getByRole('button', { name: 'Retry PIN lookup', exact: true }).click();
      await expect(page.locator('#storage-city')).toHaveValue(choice.city);
      await mount('storage', false);
      await mount('storage', true, true);
    } else await expect(page.getByRole('button', { name: 'Retry PIN lookup' })).toHaveCount(0);
  }
  mode = 'multiple';
  await page.locator('#storage-pincode').fill('411005');
  await expect(page.locator('#storage-pin-feedback')).toContainText('Several places');
  await expect(page.locator('#storage-city')).toHaveValue('Historical locality');
  await page.locator('#storage-pin-choice').click();
  await page.getByRole('option', { name: /Second locality/ }).click();
  await expect(page.locator('#storage-city')).toHaveValue('Second locality');
  await page.locator('#storage-pincode').fill('411006');
  await expect(page.getByRole('button', { name: 'Use catalogue selection instead' })).toBeVisible();
  await page.getByRole('button', { name: 'Use catalogue selection instead' }).click();
  await expect(page.locator('#storage-pin-feedback')).toContainText('Catalogue selection confirmed');
  mode = 'held';
  await page.locator('#storage-pincode').fill('411007');
  await expect.poll(() => pending.length).toBe(1);
  await page.locator('#storage-address').fill('Newer street draft');
  await pending.pop().fulfill({ json: { choices: [{ ...choice, city: 'Stale result' }] } }).catch(() => {});
  await expect(page.locator('#storage-city')).toHaveValue('Second locality');
  await expect(page.locator('#storage-address')).toHaveValue('Newer street draft');
  mode = 'empty';
  await page.locator('#storage-pincode').fill('411008');
  await expect(page.locator('#storage-pin-feedback')).toContainText('No matching location');
  await expect(page.locator('#storage-city')).toHaveValue('Second locality');
});
