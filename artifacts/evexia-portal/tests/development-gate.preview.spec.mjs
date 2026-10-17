import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: {
  executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'],
} });
test.skip(process.env.EVEXIA_TEST_DEVELOPMENT_GATE !== '1', 'Dedicated development fixture only');
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');

async function observe(page) {
  const diagnostics = [];
  const headers = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/__development-release') || path === '/api/v1/development/compatibility') diagnostics.push(path);
    if (path.startsWith('/api/')) headers.push(request.headers()['x-evexia-development-contract']);
  });
  // If an accidental probe slips through it fails, rather than testing only
  // the healthy path and hiding an unexpected compatibility quarantine.
  await page.route('**/api/v1/development/compatibility', route => route.fulfill({
    status: 503, contentType: 'text/html', body: '<html>Unavailable diagnostics</html>',
  }));
  await page.route('**/__development-release', route => route.abort());
  return { diagnostics, headers };
}

test('normal initial access and lifecycle events never probe or bypass authentication', async ({ page, context }) => {
  const observed = await observe(page);
  await page.clock.install();
  await page.goto(base());
  await expect(page.getByRole('heading', { name: 'Welcome to EVEXIA.' })).toBeVisible();
  await page.clock.fastForward(31000);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await context.setOffline(false);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new CustomEvent('evexia:compatibility-invalidated'));
  });
  await page.goto(`${base()}/admin/masters/zones`);
  await expect(page.getByRole('textbox', { name: 'Email or username' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Development setup pending' })).toHaveCount(0);
  expect(observed.diagnostics).toEqual([]);
  expect(observed.headers.length).toBeGreaterThan(0);
  expect(observed.headers.every(value => value === undefined)).toBe(true);
});

test('HMR and reconnect/full-reload messages retain a mounted draft without quarantine or probes', async ({ page }) => {
  let hotSocket;
  await page.routeWebSocket(/.*/, socket => {
    socket.connectToServer();
    hotSocket = socket;
  });
  await authenticateAdmin(page);
  const observed = await observe(page);
  await page.goto(`${base()}/admin/orders/spt/new`);
  const draft = page.getByTestId('input-spt-remarks');
  await expect(draft).toBeVisible();
  await draft.fill('Synthetic unsaved manual-only draft');
  const node = await draft.elementHandle();
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  expect(hotSocket).toBeTruthy();
  hotSocket.send(JSON.stringify({ type: 'update', updates: [] }));
  hotSocket.send(JSON.stringify({ type: 'custom', event: 'evexia:compatibility-invalidated', data: {} }));
  hotSocket.send(JSON.stringify({ type: 'full-reload', path: '*' }));
  // Allow Vite's full-reload debounce to run.
  await page.waitForTimeout(250);
  await expect(draft).toBeVisible();
  await expect(draft).toHaveValue('Synthetic unsaved manual-only draft');
  expect(await draft.evaluate((el, old) => el === old, node)).toBe(true);
  expect(navigations).toBe(0);
  expect(observed.diagnostics).toEqual([]);
  expect(observed.headers.every(value => value === undefined)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Development setup pending' })).toHaveCount(0);
});
