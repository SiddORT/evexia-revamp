/**
 * Presentation inspection ONLY. Bundles the actual mapping/layout/controls with
 * synthetic read-only services, listens on an unregistered 127.0.0.1 port, and
 * denies every browser request outside that static listener. No application
 * server, credentials, database, migration or regression runner is involved.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const root = process.cwd();
const portal = path.join(root, 'artifacts/evexia-portal');
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite/package.json', { paths: [portal] }));
const { build } = viteRequire('esbuild');
const playwrightPackage = (await fs.readdir(path.join(root, 'node_modules/.pnpm'))).find((p) => /^playwright@\d/.test(p));
if (!playwrightPackage) throw Error('An installed Playwright browser driver is required for static inspection.');
const { chromium } = require(path.join(root, 'node_modules/.pnpm', playwrightPackage, 'node_modules/playwright'));
const out = path.join(root, 'generated-artifacts/doctor-mapping-layout');
await fs.mkdir(out, { recursive: true });
const long = 'Synthetic Long Clinical Network Name With Multiple Words';
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mrs = [1, 2].map((n) => ({ id: uid(n), name: `${long} MR ${n}`, userId: `MR-00${n}`,
  zoneId: uid(20), zoneName: `${long} Zone`, status: 'active', usable: true, deleted: false }));
const items = [3, 4, 5].map((n) => ({ id: uid(n), name: `${long} Doctor ${n}`, doctorNumber: `DOC-000${n}`,
  mrId: mrs[n === 5 ? 1 : 0].id, mrName: mrs[n === 5 ? 1 : 0].name, mrUserId: mrs[n === 5 ? 1 : 0].userId, mrStatus: 'active', version: 1,
  areaId: n === 3 ? null : uid(40), areaVersion: 1, areaName: n === 3 ? '' : `${long} Area`,
  areaHeadquarterName: long, headquarterName: `${long} HQ`, zoneNames: [`${long} Zone`, 'Secondary Zone'],
  status: n === 5 ? 'inactive' : 'active', assignmentWarnings: [] }));
const fixture = `
const items=${JSON.stringify(items)}, mrs=${JSON.stringify(mrs)};
const mode=()=>new URLSearchParams(location.search).get('state');
const wait=()=>new Promise(r=>setTimeout(r,60));
export async function listDoctorMappings(params) { if(mode()==='loading')return new Promise(()=>{});
  (window.__mappingInspectionRequests ||= []).push(params);
  await wait(); if(mode()==='error')throw Error('Synthetic read error. Retry preserves filters.');
  const matching=mode()==='empty'?[]:items.filter(r=>
    (!params.area_id || (params.area_id==='unset'?!r.areaId:r.areaId===params.area_id)) &&
    (!params.mr_id || r.mrId===params.mr_id) && (!params.doctor_id || r.id===params.doctor_id) &&
    (params.status==='all' || r.status===params.status));
  return {items:matching.slice(params.offset,params.offset+params.limit),total:3,filtered:matching.length,limit:params.limit,offset:params.offset}; }
export async function doctorMappingReferences(kind,params) { await wait(); return {items:kind==='doctor'
  ?items.map(r=>({...r,userId:r.doctorNumber,usable:true,deleted:false}))
  :[{id:'${uid(40)}',name:'${long} Area / Parent HQ',userId:'',status:'active',usable:true,deleted:false}],total:1,limit:50,offset:0}; }
export async function doctorMRChoices() { await wait(); return {items:mrs,total:2,limit:100,offset:0}; }
export async function doctorAssignmentHistory() { await wait();return {items:[
 {id:'${uid(61)}',kind:'transfer',recordedAt:'2026-11-15T10:00:00Z',details:{doctor:items[0],previousMR:{...mrs[0],number:'MR-001'},
 newMR:{...mrs[1],number:'MR-002'},actor:{id:'${uid(70)}',name:'Synthetic Authorized Staff (EVX001)'},reason:'MR no longer covers this area. '+ '${long} '.repeat(12)}},
 {id:'${uid(60)}',kind:'baseline',recordedAt:'2026-11-14T10:00:00Z',details:{newMR:{...mrs[0],number:'MR-001'},
 actor:{id:null,name:'Opening/current-state baseline; original actor unknown'},reason:'Original assignment date and reason unknown'}}],total:2,limit:20,offset:0};}
export const setDoctorArea=()=>{throw Error('Static fixture: writes denied')};
export const bulkDoctors=()=>{throw Error('Static fixture: writes denied')};
export const lookupDoctorPIN=()=>{throw Error('Static fixture: postal calls denied')};
`;
const adminSession = `
export const reportingIdentityGuard=()=>()=>{};
export const subscribeSession=()=>()=>{};
export const contactReadScope=()=> 'synthetic-read-only';
export const sessionEpoch=()=>1;
const session={status:'authenticated',user:{id:'synthetic-admin',identity_kind:'super_admin',permissions:['admin.access']}};
export const getSession=()=>session;
export const reportingRequest=()=>{throw Error('Static fixture: reporting denied')};
export const serverDownloadGuard=()=>{throw Error('Static fixture: downloads denied')};
export const mrRequest=()=>{throw Error('Static fixture: MR API denied')};
export const logoutAdmin=()=>{throw Error('Static fixture: logout denied')};
`;
const entry = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import './src/index.css';
import DoctorMRMapping from './src/pages/admin/DoctorMRMapping.jsx';
createRoot(document.getElementById('root')).render(<DoctorMRMapping/>);
`;
await build({
  stdin: { contents: entry, resolveDir: portal, sourcefile: 'mapping-inspection.jsx', loader: 'jsx' },
  bundle: true, write: true, outdir: out, entryNames: 'fixture', jsx: 'automatic', conditions: ['browser', 'style'],
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' },
  loader: { '.png': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.svg': 'dataurl' },
  plugins: [{
    name: 'synthetic-read-only-boundaries',
    setup(b) {
      b.onLoad({ filter: /[/\\]services[/\\]serverDoctors\.js$/ }, () => ({ contents: fixture, loader: 'js' }));
      b.onLoad({ filter: /[/\\]auth[/\\]adminSession\.js$/ }, () => ({ contents: adminSession, loader: 'js' }));
      b.onLoad({ filter: /[/\\]auth[/\\]AdminBoundary\.jsx$/ }, () => ({
        contents: `export const useAdminSession=()=>({user:{id:'${uid(99)}',identity_kind:'super_admin',display_name:'Synthetic Admin',username:'EVX-SYNTHETIC',permissions:['admin.access']}});`, loader: 'js',
      }));
      b.onLoad({ filter: /[/\\]activity[/\\]activityTracker\.js$/ }, () => ({
        contents: 'export const recordPageVisit=()=>{};export const flushActivityBeforeExit=()=>{};', loader: 'js',
      }));
      b.onLoad({ filter: /[/\\]services[/\\]localActivity\.js$/ }, () => ({
        contents: 'export const recordLocalAction=()=>{};', loader: 'js',
      }));
      b.onLoad({ filter: /[/\\](NotificationBell|ActivityRecordingStatus)\.jsx$/ }, () => ({
        contents: 'export default function(){return null}', loader: 'js',
      }));
    },
  }],
});
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api')) { res.writeHead(403); res.end('API access denied'); return; }
  if (['/fixture.js', '/fixture.css'].includes(pathname)) {
    res.setHeader('Content-Type', pathname.endsWith('css') ? 'text/css' : 'text/javascript');
    res.end(await fs.readFile(path.join(out, pathname.slice(1))));
  } else if (pathname === '/favicon.png') { res.writeHead(204); res.end(); }
  else if (pathname === '/images/evexia-logo.png') {
    res.setHeader('Content-Type', 'image/png');
    res.end(await fs.readFile(path.join(portal, 'public/images/evexia-logo.png')));
  }
  else { res.setHeader('Content-Type', 'text/html'); res.end(html); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/repl/tools/bin/chromium', headless: true, args: ['--no-sandbox'] });
const records = [], errors = [], denied = [];
try {
  for (const width of [390, 768, 1440]) {
    for (const theme of ['classic', 'modern']) for (const appearance of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/*', async (route) => {
        if (!route.request().url().startsWith(`${origin}/`) || route.request().method() !== 'GET') {
          denied.push(route.request().url()); await route.abort(); return;
        }
        await route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${origin}/admin/masters/doctor-mr-mapping`);
      await page.locator('[data-testid="button-history-' + uid(3) + '"]').waitFor();
      await page.evaluate(({ theme, appearance }) => {
        document.querySelector('.admin-shell').dataset.adminTheme = theme;
        document.querySelector('.admin-shell').dataset.adminAppearance = appearance;
      }, { theme, appearance });
      async function measure(surface) {
        const geometry = await page.evaluate(() => ({
          pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          dialog: (() => { const r = document.querySelector('[role="dialog"][aria-modal="true"]')?.getBoundingClientRect();
            return r ? { left: r.left, right: r.right, bottom: r.bottom, top: r.top } : null; })(),
        }));
        records.push({ width, theme, appearance, surface, ...geometry });
        await page.screenshot({ path: path.join(out, `${width}-${theme}-${appearance}-${surface}.png`) });
      }
      await measure('doctor');
      const filterToggle = page.getByTestId('button-toggle-mapping-filters');
      const filterDetails = page.locator('.doctor-mapping__filters details');
      assert.equal(await filterDetails.getAttribute('open'), null);
      // Real Tab entry, rather than programmatic focus, checks keyboard focus styles.
      for (let i = 0; i < 80 && !await filterToggle.evaluate((e) => e === document.activeElement); i++) await page.keyboard.press('Tab');
      assert.ok(await filterToggle.evaluate((e) => e === document.activeElement && getComputedStyle(e).outlineStyle !== 'none'));
      await page.keyboard.press('Enter');
      assert.notEqual(await filterDetails.getAttribute('open'), null);
      await measure('filters-open');
      await page.getByTestId('select-mapping-status').selectOption('active');
      await page.getByTestId('text-mapping-count').filter({ hasText: 'of 2 Doctors' }).waitFor();
      await filterToggle.click();
      assert.match(await filterToggle.innerText(), /1 active/);
      assert.equal(await page.getByTestId('button-reset-mapping-filters').isVisible(), true);
      await page.getByTestId('button-reset-mapping-filters').click();
      await page.getByTestId('text-mapping-count').filter({ hasText: 'of 3 Doctors' }).waitFor();
      await page.getByRole('tab', { name: 'MR-wise' }).click();
      const group1 = page.getByTestId('button-toggle-mapping-group-' + uid(1));
      const group2 = page.getByTestId('button-toggle-mapping-group-' + uid(2));
      assert.equal(await group1.getAttribute('aria-expanded'), 'false');
      assert.equal(await group2.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.getByTestId('button-history-' + uid(3)).isVisible(), false);
      await measure('mr-collapsed');
      await page.getByTestId('checkbox-group-' + uid(1)).check();
      assert.equal(await group1.getAttribute('aria-expanded'), 'false');
      assert.match(await page.getByTestId('text-mapping-selected').innerText(), /2 selected/);
      await page.getByTestId('checkbox-group-' + uid(1)).focus();
      await page.keyboard.press('Shift+Tab');
      assert.ok(await group1.evaluate((e) => e === document.activeElement && getComputedStyle(e).outlineStyle !== 'none'));
      await page.keyboard.press('Space');
      assert.equal(await group1.getAttribute('aria-expanded'), 'true');
      assert.equal(await group2.getAttribute('aria-expanded'), 'false');
      await group2.click();
      assert.equal(await group1.getAttribute('aria-expanded'), 'true');
      await measure('mr-expanded');
      await group1.click();
      assert.match(await page.getByTestId('text-mapping-selected').innerText(), /2 selected/);
      const beforeDisclosure = await page.evaluate(() => window.__mappingInspectionRequests.length);
      await filterToggle.click();
      await filterToggle.click();
      assert.equal(await page.evaluate(() => window.__mappingInspectionRequests.length), beforeDisclosure);
      assert.match(await page.getByTestId('text-mapping-selected').innerText(), /2 selected/);
      await page.getByTestId('button-transfer-selected').click();
      assert.equal(await page.locator('[data-testid^="row-transfer-"]').count(), 2);
      await page.getByRole('combobox', { name: 'New MR', exact: true }).click();
      await page.getByRole('option').filter({ hasText: 'MR-002' }).click();
      await page.getByTestId('input-mapping-transfer-reason').fill('Synthetic inspection only; no write is allowed.');
      assert.equal(await page.getByTestId('button-confirm-transfer').isEnabled(), false);
      await page.getByTestId('checkbox-transfer-reviewed').check();
      assert.equal(await page.getByTestId('button-confirm-transfer').isEnabled(), true);
      await page.keyboard.press('Escape');
      assert.ok(await page.getByTestId('button-transfer-selected').evaluate((e) => e === document.activeElement));
      await page.getByTestId('button-clear-mapping-selection').click();
      assert.equal(await page.getByTestId('text-mapping-selected').count(), 0);
      // Inspect all six filter controls in both presentations using read-only fixtures.
      if (width === 390 && theme === 'classic' && appearance === 'light') {
        for (const view of ['doctor', 'mr']) {
          await page.getByTestId('tab-mapping-' + view).click();
          await filterToggle.click();
          for (const [label, key, expected] of [
            ['Doctor Area', 'area_id', uid(40)], ['Current MR HQ', 'headquarter_id', uid(40)],
            ['Current MR Zone', 'zone_id', uid(40)], ['Current MR', 'mr_id', uid(1)], ['Doctor', 'doctor_id', uid(4)],
          ]) {
            await page.getByRole('combobox', { name: label, exact: true }).click();
            await page.getByRole('option').filter({ hasText: label === 'Doctor' ? 'Doctor 4' : label === 'Current MR' ? 'MR-001' : 'Area / Parent HQ' }).click();
            await page.waitForFunction(({ key, expected }) => window.__mappingInspectionRequests.at(-1)?.[key] === expected, { key, expected });
          }
          await page.getByTestId('select-mapping-status').selectOption('active');
          await page.getByTestId('text-mapping-count').filter({ hasText: 'of 1 Doctors' }).waitFor();
          await filterToggle.click();
          assert.match(await filterToggle.innerText(), /6 active/);
          await filterToggle.click();
          await page.getByTestId('checkbox-filter-area-unset').check();
          await page.waitForFunction(() => window.__mappingInspectionRequests.at(-1)?.area_id === 'unset');
          await page.getByTestId('button-reset-mapping-filters').click();
          await page.getByTestId('text-mapping-count').filter({ hasText: 'of 3 Doctors' }).waitFor();
          assert.equal(await page.getByTestId('checkbox-filter-area-unset').isChecked(), false);
          assert.equal(await page.getByTestId('select-mapping-status').inputValue(), 'all');
          await filterToggle.click();
        }
        await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('2');
        await page.getByRole('button', { name: 'Next page', exact: true }).click();
        await page.getByTestId('text-mapping-count').filter({ hasText: '3–3' }).waitFor();
        await page.getByTestId('checkbox-group-' + uid(2)).check();
        await filterToggle.click();
        await filterToggle.click();
        assert.match(await page.getByTestId('text-mapping-count').innerText(), /3–3/);
        assert.match(await page.getByTestId('text-mapping-selected').innerText(), /1 selected/);
        await page.getByRole('button', { name: 'Previous page', exact: true }).click();
        await page.getByTestId('text-mapping-count').filter({ hasText: '1–2' }).waitFor();
        assert.equal(await page.getByTestId('text-mapping-selected').count(), 0);
        assert.equal(await page.getByTestId('checkbox-group-' + uid(1)).isChecked(), false);
      }
      if (theme === 'classic' && appearance === 'light') {
        for (const state of ['empty', 'loading', 'error']) {
          await page.goto(`${origin}/admin/masters/doctor-mr-mapping?state=${state}`);
          await page.waitForTimeout(150);
          await measure(state);
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
await fs.writeFile(path.join(out, 'measurements.json'), JSON.stringify({ records, errors, denied }, null, 2));
console.log(JSON.stringify({ states: records.length, errors, denied,
  overflow: records.filter((r) => r.pageOverflow), focusIssues: records.filter((r) => r.trapped === false || r.restored === false),
  evidence: path.relative(root, out) }, null, 2));
