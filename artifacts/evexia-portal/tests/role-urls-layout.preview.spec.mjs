import { test, expect } from '@playwright/test';

const base = () => process.env.EVEXIA_PREVIEW_BASE_URL?.replace(/\/$/, '');
const hostname = ['legal', 'a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60), 'end', 'example'].join('.');
const longTxt = 'synthetic-txt-unbroken-'.repeat(18);
const fakeToken = 'synthetic-role-urls-layout-only-token';
const identity = {
  id: 'synthetic-role-urls-layout-super-admin',
  email: 'layout-admin@fixture.example',
  username: 'layout-admin',
  system_role: 'super_admin',
  identity_kind: 'super_admin',
  permissions: ['admin.access', 'staff.manage', 'roles.manage'],
};
const fixture = {
  items: [
    { id: 'fixture-admin', hostname, role: 'admin', enabled: true, version: 1 },
    { id: 'fixture-doctor', hostname: 'doctor-layout.example', role: 'doctor', enabled: false, version: 1 },
  ],
  domains: [{
    hostname, kind: 'role', status: 'pending', active: false, version: 1,
    challenge_name: `_evexia-verification.${hostname}`,
    challenge_value: longTxt,
    challenge_expires_at: '2099-01-01T00:00:00Z',
    verified_at: null, verification_expires_at: null, last_checked_at: null,
  }],
  bootstrap_hosts: ['recovery-layout.example'],
};

const widths = [
  { name: 'mobile-390', viewport: 390, panel: null },
  { name: 'mobile-320', viewport: 320, panel: null },
  { name: 'tablet-768', viewport: 768, panel: null },
  { name: 'desktop-panel-650', viewport: 1440, panel: 650 },
];
const modes = [
  ['classic', 'light'], ['classic', 'dark'], ['modern', 'light'], ['modern', 'dark'],
];
let lastMeasurements = null;

test.afterEach(async ({ page }, info) => {
  if (lastMeasurements) {
    await info.attach('latest-layout-measurements.json', {
      body: JSON.stringify(lastMeasurements, null, 2), contentType: 'application/json',
    });
  }
  if (info.status !== info.expectedStatus && !page.isClosed()) {
    await info.attach('failure-viewport.png', { body: await page.screenshot(), contentType: 'image/png' });
  }
  lastMeasurements = null;
});

async function openSettings(page, theme, appearance, width) {
  await page.setViewportSize({ width: width.viewport, height: 1000 });
  // Establish the application origin before touching localStorage.
  await page.goto(base());
  await page.evaluate(({ theme, appearance }) => {
    localStorage.setItem('evexia.admin.theme', theme);
    localStorage.setItem('evexia.admin.appearance', appearance);
  }, { theme, appearance });
  await page.goto(`${base()}/admin/settings?section=role-urls`);
  await expect(page.getByTestId('button-admin-profile')).toBeVisible();
  await page.getByTestId('input-settings-search').fill('hostname');
  await page.getByTestId('link-settings-role-urls').click();
  await expect(page.getByTestId('panel-primary-domain')).toBeVisible();
  await expect(page.getByTestId('row-role-url-fixture-admin')).toBeVisible();
  if (width.panel) {
    await page.locator('.role-urls').evaluate((node, maxWidth) => {
      node.style.width = '100%';
      node.style.maxWidth = `${maxWidth}px`;
      node.style.marginInline = 'auto';
    }, width.panel);
  }
}

async function doubleRenderedText(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.role-urls');
    const samples = {
      heading: root.querySelector('.role-urls__intro h2'),
      label: root.querySelector('.role-urls__label'),
      body: root.querySelector('.role-urls__description'),
      code: root.querySelector('.role-urls__txt code'),
    };
    const all = [root, ...root.querySelectorAll('*')];
    // Snapshot every computed size before writing any inline sizes, so a
    // parent's override cannot change an unmeasured descendant's baseline.
    const snapshots = all.map((node) => ({ node, size: parseFloat(getComputedStyle(node).fontSize) }));
    const before = Object.fromEntries(Object.entries(samples).map(([key, node]) =>
      [key, parseFloat(getComputedStyle(node).fontSize)]));
    for (const { node, size } of snapshots) {
      if (Number.isFinite(size) && size > 0) node.style.setProperty('font-size', `${size * 2}px`, 'important');
    }
    const after = Object.fromEntries(Object.entries(samples).map(([key, node]) =>
      [key, parseFloat(getComputedStyle(node).fontSize)]));
    return { before, after, ratios: Object.fromEntries(Object.keys(before).map((key) => [key, after[key] / before[key]])) };
  });
}

async function clearTextEnlargement(page) {
  await page.evaluate(() => {
    const root = document.querySelector('.role-urls');
    for (const node of [root, ...root.querySelectorAll('*')]) node.style.removeProperty('font-size');
  });
}

async function inspectTextBounds(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.role-urls');
    const candidates = [...root.querySelectorAll('h2, h3, h4, p, label, button, summary, strong, small, dt, dd, code')];
    const textRows = candidates.filter((node) => node.textContent.trim() && node.getClientRects().length).map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((rect) => rect.width || rect.height);
      const ancestors = [];
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const box = parent.getBoundingClientRect();
        const parentStyle = getComputedStyle(parent);
        ancestors.push({ tag: parent.tagName, className: typeof parent.className === 'string' ? parent.className : '',
          left: box.left, right: box.right, top: box.top, bottom: box.bottom,
          overflowX: parent.scrollWidth > parent.clientWidth + 1,
          clips: ['hidden', 'clip'].includes(parentStyle.overflowX) || ['hidden', 'clip'].includes(parentStyle.overflowY) });
        if (parent === root) break;
      }
      const style = getComputedStyle(node);
      const lineClamp = Number.parseFloat(style.webkitLineClamp);
      return {
        text: node.textContent,
        tag: node.tagName,
        lines: rects.length,
        rangeRects: rects.map(({ x, y, width, height }) => ({ x, y, width, height })),
        ancestors,
        overflowX: ancestors.some((ancestor) => ancestor.overflowX),
        ellipsis: style.textOverflow === 'ellipsis' || (Number.isFinite(lineClamp) && lineClamp > 0),
        clipped: ancestors.some((ancestor) => ancestor.clips),
      };
    });
    const controls = [...root.querySelectorAll('button, input, select, summary')].filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    }).map((node) => {
      const box = node.getBoundingClientRect();
      const ancestors = [];
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const r = ancestor.getBoundingClientRect();
        ancestors.push({ tag: ancestor.tagName, className: typeof ancestor.className === 'string' ? ancestor.className : '',
          left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        if (ancestor === root) break;
      }
      return {
        name: node.getAttribute('aria-label') || node.textContent.trim() || node.getAttribute('placeholder') || node.tagName,
        left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        ancestors,
        viewportWidth: innerWidth,
        text: (() => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return [...range.getClientRects()].map(({ x, y, width, height }) => ({ x, y, width, height }));
        })(),
        focusVisible: node.matches(':focus-visible'),
        outline: { style: getComputedStyle(node).outlineStyle, width: parseFloat(getComputedStyle(node).outlineWidth) },
      };
    });
    const mapping = root.querySelector('[data-testid="row-role-url-fixture-admin"]');
    // During the mapping editor, that row is replaced by a form. Keep an
    // action-group geometry sample in every state via the DNS row controls.
    const actions = mapping?.querySelector('.role-urls__actions')
      || root.querySelector('.role-urls__list--domains .role-urls__actions');
    const actionButtons = actions ? [...actions.querySelectorAll('button')].map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }) : [];
    return {
      panel: (() => { const r = root.getBoundingClientRect(); return { left:r.left,right:r.right,width:r.width,scrollWidth:root.scrollWidth,clientWidth:root.clientWidth }; })(),
      doc: { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      targets: textRows, controls, actionBox: actions ? (() => { const r=actions.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; })() : null,
      actionButtons,
    };
  });
}

async function keyboardTabTo(page, target, maxTabs = 60) {
  await page.getByTestId('input-role-url-search').focus();
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error(`Could not reach ${await target.getAttribute('data-testid')} by Tab within ${maxTabs} keys.`);
}

async function expectVisibleKeyboardFocus(locator) {
  await expect(locator).toBeFocused();
  const focus = await locator.evaluate((node) => ({
    visible: node.matches(':focus-visible'),
    outlineStyle: getComputedStyle(node).outlineStyle,
    outlineWidth: parseFloat(getComputedStyle(node).outlineWidth),
  }));
  expect(focus.visible && focus.outlineStyle !== 'none' && focus.outlineWidth >= 2, JSON.stringify(focus)).toBe(true);
}

async function measureAndAssert(page, context) {
  const sizes = await doubleRenderedText(page);
  for (const sample of ['heading', 'label', 'body', 'code']) {
    expect(sizes.before[sample], `${context} ${sample} baseline size`).toBeGreaterThan(0);
    expect(sizes.ratios[sample], `${context} ${sample} 200% ratio: ${JSON.stringify(sizes)}`).toBe(2);
  }
  const geometry = await inspectTextBounds(page);
  const diagnostics = { context, sizes, geometry };
  lastMeasurements = diagnostics;
  // Do not create thousands of Playwright assertion steps, each retaining the
  // entire geometry tree. Keep full measurements once, and report violations
  // together without weakening any bounds.
  const violations = [];
  const check = (passes, message) => { if (!passes) violations.push(message); };
  check(geometry.doc.scrollWidth <= geometry.doc.width + 1, 'page-wide overflow');
  check(geometry.panel.scrollWidth <= geometry.panel.clientWidth + 1, 'panel overflow');
  for (const target of geometry.targets) {
    const name = `${target.tag}: ${target.text.slice(0, 80)}`;
    check(target.lines > 0, `${name}: no rendered text`);
    check(!target.overflowX, `${name}: ancestor overflow`);
    check(!target.ellipsis, `${name}: ellipsis or line clamp`);
    check(!target.clipped, `${name}: clipping ancestor`);
    for (const rect of target.rangeRects) {
      for (const ancestor of target.ancestors) {
        check(rect.x >= ancestor.left - 1 && rect.x + rect.width <= ancestor.right + 1,
          `${name}: text outside ${ancestor.className || ancestor.tag} (${rect.x}..${rect.x + rect.width} vs ${ancestor.left}..${ancestor.right})`);
      }
    }
  }
  const txtValue = geometry.targets.find((target) => target.text === longTxt);
  check(Boolean(txtValue) && txtValue.lines > 1, 'long TXT must be present and wrap');
  check(geometry.targets.find((target) => target.text === hostname)?.lines > 1, 'long hostname must be present and wrap');
  for (const control of geometry.controls) {
    const name = control.name.slice(0, 80);
    check(control.left >= -1 && control.right <= control.viewportWidth + 1, `${name}: control outside viewport`);
    for (const ancestor of control.ancestors) {
      check(control.left >= ancestor.left - 1 && control.right <= ancestor.right + 1,
        `${name}: control outside ${ancestor.className || ancestor.tag}`);
    }
    for (const rect of control.text) {
      check(rect.x >= control.left - 1 && rect.x + rect.width <= control.right + 1, `${name}: text outside control`);
    }
  }
  const mapping = geometry.actionBox;
  check(Boolean(mapping), 'missing action group');
  if (mapping) {
    check(mapping.left >= geometry.panel.left - 1 && mapping.right <= geometry.panel.right + 1, 'action group outside panel');
  }
  for (const button of geometry.actionButtons) {
    check(Boolean(mapping) && button.left >= mapping.left - 1 && button.right <= mapping.right + 1
      && button.top >= mapping.top - 1 && button.bottom <= mapping.bottom + 1, 'button outside action group');
  }
  expect(violations, `${context}: full geometry is attached once in latest-layout-measurements.json`).toEqual([]);
  return { sizes, geometry };
}

for (const [theme, appearance] of modes) {
  for (const width of widths) {
    test(`Role URLs 200% readable layout ${width.name} ${theme}/${appearance}`, async ({ page, browser, browserName }, info) => {
      test.setTimeout(60000);
      console.log(`Role URLs layout engine: ${browserName} ${browser.version()}`);
      lastMeasurements = null;
      const requests = [], mutations = [], unexpectedApiRequests = [], activityRequests = [];
      await page.context().route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        requests.push({ method, pathname: url.pathname });
        if (url.pathname === '/api/v1/portal/resolve' && method === 'GET') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{"role":null}' });
        }
        if (url.pathname === '/api/v1/auth/refresh' && method === 'POST') {
          return route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ access_token: fakeToken, expires_in: 3600 }) });
        }
        if (url.pathname === '/api/v1/auth/me' && method === 'GET') {
          const authorization = (await request.allHeaders()).authorization;
          if (authorization !== `Bearer ${fakeToken}`) unexpectedApiRequests.push({ method, pathname: url.pathname, reason: 'unexpected bearer' });
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(identity) });
        }
        if (url.pathname === '/api/v1/admin/reporting/activity' && method === 'POST') {
          // The real Admin shell reports a page-view on authenticated mount.
          // A no-content fixture keeps that incidental telemetry synthetic.
          activityRequests.push({ method, pathname: url.pathname });
          return route.fulfill({ status: 204 });
        }
        if (url.pathname.startsWith('/api/v1/admin/role-urls')) {
          if (method === 'GET' && url.pathname === '/api/v1/admin/role-urls') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
          }
          if (method !== 'GET') mutations.push({ method, pathname: url.pathname });
          else unexpectedApiRequests.push({ method, pathname: url.pathname });
          return route.abort('blockedbyclient');
        }
        unexpectedApiRequests.push({ method, pathname: url.pathname });
        return route.abort('blockedbyclient');
      });

      await openSettings(page, theme, appearance, width);
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-theme', theme);
      await expect(page.locator('.admin-shell')).toHaveAttribute('data-admin-appearance', appearance);
      const challenge = page.getByTestId(`text-challenge-${hostname}`);
      await expect(challenge).toBeVisible();
      await expect(challenge.locator('dt')).toHaveText(['Type', 'Name', 'Value']);
      await expect(challenge.locator('dd').nth(0)).toHaveText('TXT');
      await expect(challenge.locator('dd code').nth(0)).toHaveText(`_evexia-verification.${hostname}`);
      await expect(challenge.locator('dd code').nth(1)).toHaveText(longTxt);
      await page.getByText('Deployment operator checklist', { exact: true }).click();
      await expect(page.locator('.role-urls__deployment details')).toHaveAttribute('open', '');

      const mapping = page.getByTestId('row-role-url-fixture-admin');
      const mappingActions = mapping.locator('.role-urls__actions');
      await expect(mappingActions.getByRole('button')).toHaveCount(3);
      await mapping.getByRole('button', { name: `Edit ${hostname}` }).click();
      await expect(page.getByTestId('form-role-url')).toBeVisible();
      const mappingSizes = await measureAndAssert(page, 'mapping-editor');
      await keyboardTabTo(page, page.getByTestId('input-role-url-hostname'));
      await expectVisibleKeyboardFocus(page.getByTestId('input-role-url-hostname'));
      const mappingGeometry = await inspectTextBounds(page);
      await clearTextEnlargement(page);
      await page.getByTestId('button-role-url-cancel').click();
      await page.getByTestId('button-primary-edit').click();
      await expect(page.getByTestId('form-primary-domain')).toBeVisible();
      const primarySizes = await measureAndAssert(page, 'primary-editor');
      await keyboardTabTo(page, page.getByTestId('input-primary-hostname'));
      await expectVisibleKeyboardFocus(page.getByTestId('input-primary-hostname'));
      const primaryGeometry = await inspectTextBounds(page);
      await clearTextEnlargement(page);
      await page.getByTestId('button-primary-cancel').click();

      const baseline = await measureAndAssert(page, 'dns-actions');
      const challengeButton = page.getByTestId(`button-domain-challenge-${hostname}`);
      await expect(challengeButton).toBeEnabled();
      await keyboardTabTo(page, challengeButton);
      await expectVisibleKeyboardFocus(challengeButton);
      const geometry = await inspectTextBounds(page);
      const diagnostics = {
        engine: `${browserName} ${browser.version()}`, viewport: page.viewportSize(), theme, appearance, width,
        baseline, mappingSizes, mappingGeometry, primarySizes, primaryGeometry, geometry, requests, activityRequests,
      };
      await info.attach('role-urls-layout-measurements.json', { body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json' });
      await page.screenshot({ path: info.outputPath(`${width.name}-${theme}-${appearance}-200-percent.png`) });
      expect(requests.some(({ pathname }) => pathname === '/api/v1/auth/refresh')).toBe(true);
      expect(requests.some(({ pathname }) => pathname === '/api/v1/auth/me')).toBe(true);
      expect(requests.some(({ pathname }) => pathname === '/api/v1/portal/resolve')).toBe(true);
      expect(requests.some(({ pathname, method }) => pathname === '/api/v1/admin/role-urls' && method === 'GET')).toBe(true);
      expect(mutations, JSON.stringify(requests)).toEqual([]);
      expect(unexpectedApiRequests, JSON.stringify(requests)).toEqual([]);
    });
  }
}
