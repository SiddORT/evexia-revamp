import { test, expect } from '@playwright/test';
import { authenticateAdmin } from './helpers/authenticateAdmin.mjs';
import { candidateIdentity } from '../../../scripts/development-identity.mjs';

if (process.env.EVEXIA_CHROMIUM_PATH) test.use({ launchOptions: {
  executablePath: process.env.EVEXIA_CHROMIUM_PATH, args: ['--no-sandbox'],
} });
test.skip(process.env.EVEXIA_TEST_DEVELOPMENT_GATE !== '1', 'Dedicated development gate fixture only');
const base = () => process.env.EVEXIA_PREVIEW_BASE_URL.replace(/\/$/, '');
const expectedIdentity = candidateIdentity();
async function runtime(page, mode) {
  await page.route('**/api/v1/development/compatibility', route => {
    const setting = mode();
    if (setting === 'html') return route.fulfill({ contentType: 'text/html', body: '<html>fallback</html>' });
    return route.fulfill({ status: setting === 'pending' ? 503 : 200, contentType: 'application/json',
      body: JSON.stringify({ format: 1, identity: setting === 'stale'
        ? { ...expectedIdentity, source: '0'.repeat(64) } : expectedIdentity, ready: setting !== 'pending' }) });
  });
}
async function invalidate(page) {
  await page.evaluate(async () => {
    const release = await import('/src/development/releaseState.js');
    release.invalidateRelease();
  });
}

test('initial incompatible load never mounts normal content and explicit retry verifies ingress', async ({ page }) => {
  let mode = 'stale';
  await runtime(page, () => mode);
  await page.goto(`${base()}/admin/masters/zones`);
  await expect(page.getByRole('heading', { name: 'Development setup pending' })).toBeVisible();
  await expect(page.getByTestId('development-content')).toBeEmpty();
  mode = 'html';
  await page.getByRole('button', { name: 'Retry compatibility check' }).click();
  await expect(page.getByRole('status')).toContainText('could not be verified');
  await expect(page.getByText('API compatibility check returned a page instead of JSON')).toBeVisible();
  await expect(page.getByTestId('development-content')).toBeEmpty();
  mode = 'ready';
  await page.getByRole('button', { name: 'Retry compatibility check' }).click();
  await expect(page.getByTestId('development-content')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Development setup pending' })).toHaveCount(0);
});

test('retry remains visibly checking while waiting and candidate HTML never reaches the API', async ({ page }) => {
  let mode = 'html';
  let unblock;
  let entered;
  const entry = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { unblock = resolve; });
  let apiCalls = 0;
  await page.route('**/__development-release', async route => {
    if (mode === 'html') return route.fulfill({ contentType: 'text/html', body: '<html>fallback</html>' });
    entered();
    await hold;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ format: 1, identity: expectedIdentity }) });
  });
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/v1/development/compatibility') apiCalls++;
  });
  await runtime(page, () => 'ready');
  await page.goto(base());
  await expect(page.getByText('Preview check returned a page instead of JSON')).toBeVisible();
  expect(apiCalls).toBe(0);
  mode = 'ready';
  await page.getByRole('button', { name: 'Retry compatibility check' }).click();
  await entry;
  await expect(page.getByRole('button', { name: 'Checking compatibility…' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Checking the running API');
  unblock();
  await expect(page.getByTestId('development-content')).toBeVisible();
  expect(apiCalls).toBe(1);
});

test('mounted real editor and auth identity survive HMR, failed checks, late replies and explicit recovery', async ({ page }) => {
  let hotSocket;
  await page.routeWebSocket(/.*/, socket => {
    socket.connectToServer();
    hotSocket = socket;
  });
  await authenticateAdmin(page);
  let mode = 'ready';
  await runtime(page, () => mode);
  const requests = [];
  page.on('request', req => { if (/\/api\/v1\/auth\/(refresh|logout)/.test(req.url())) requests.push(req.url()); });
  await page.goto(`${base()}/admin/orders/spt/new`);
  const draft = page.getByTestId('input-spt-remarks');
  await expect(draft).toBeVisible();
  await draft.fill('Synthetic unsaved draft survives development recovery');
  const node = await draft.elementHandle();
  await page.getByTestId('button-admin-profile').click();
  const profileMenu = page.getByRole('menu', { includeHidden: true });
  await expect(profileMenu).toBeVisible();
  const before = requests.length;
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  // Deliver a Vite HMR event over its real browser websocket without modifying
  // shared source (which would disturb concurrently running previews).
  expect(hotSocket).toBeTruthy();
  hotSocket.send(JSON.stringify({ type: 'update', updates: [] }));
  await expect(page.getByTestId('development-content')).toBeHidden();
  expect(await page.getByTestId('development-content').getAttribute('inert')).not.toBeNull();
  expect(await node.evaluate(el => el.isConnected)).toBe(true);
  expect(await node.inputValue()).toContain('Synthetic unsaved draft');
  await expect(profileMenu).toBeHidden(); // real body portal is also isolated
  await page.evaluate(async () => {
    const session = await import('/src/auth/adminSession.js');
    await session.verifySession(true);
  });
  expect(requests.length).toBe(before); // no cookie rotation while blocked
  mode = 'pending';
  await page.getByRole('button', { name: 'Retry compatibility check' }).click();
  await expect(page.getByRole('status')).toContainText('could not be verified');
  mode = 'ready';
  await page.getByRole('button', { name: 'Retry compatibility check' }).click();
  await expect(draft).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(draft).toHaveValue('Synthetic unsaved draft survives development recovery');
  expect(await draft.evaluate((el, old) => el === old, node)).toBe(true);
  expect(navigations).toBe(0);
  expect(requests.length).toBe(before);

  // An older success cannot reopen content after a newer invalidation.
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  let entered;
  const entry = new Promise(resolve => { entered = resolve; });
  await page.unroute('**/api/v1/development/compatibility');
  await page.route('**/api/v1/development/compatibility', async route => {
    entered();
    await hold;
    await route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ format: 1, identity: expectedIdentity, ready: true }) }).catch(() => {});
  });
  await page.evaluate(async () => {
    const state = await import('/src/development/releaseState.js');
    void state.retryRelease();
  });
  await entry;
  await invalidate(page);
  release();
  await expect(page.getByTestId('development-content')).toBeHidden();
  expect(await node.inputValue()).toContain('Synthetic unsaved draft');
  hotSocket.send(JSON.stringify({ type: 'full-reload', path: '*' }));
  await expect(page.getByText('Check: frontend reload required')).toBeVisible();
  // The Vite debounce must run; no actual page navigation may occur.
  await page.waitForTimeout(150);
  expect(navigations).toBe(0);
  expect(await node.evaluate(el => el.isConnected)).toBe(true);
  await page.getByRole('button', { name: 'Retry compatibility check' }).click();
  await expect(page.getByTestId('development-content')).toBeHidden();
  await expect(page.getByRole('link', { name: 'open a separate preview tab' })).toBeVisible();
});
