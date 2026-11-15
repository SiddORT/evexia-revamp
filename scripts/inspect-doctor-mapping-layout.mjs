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
  mrId: uid(1), mrName: mrs[0].name, mrUserId: mrs[0].userId, mrStatus: 'active', version: 1,
  areaId: n === 3 ? null : uid(40), areaVersion: 1, areaName: n === 3 ? '' : `${long} Area`,
  areaHeadquarterName: long, headquarterName: `${long} HQ`, zoneNames: [`${long} Zone`, 'Secondary Zone'],
  status: n === 5 ? 'inactive' : 'active', assignmentWarnings: [] }));
const fixture = `
const items=${JSON.stringify(items)}, mrs=${JSON.stringify(mrs)};
const mode=()=>new URLSearchParams(location.search).get('state');
const wait=()=>new Promise(r=>setTimeout(r,60));
export async function listDoctorMappings(params) { if(mode()==='loading')return new Promise(()=>{});
  await wait(); if(mode()==='error')throw Error('Synthetic read error. Retry preserves filters.');
  return {items:mode()==='empty'?[]:items,total:3,filtered:mode()==='empty'?0:3,limit:25,offset:0}; }
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
        await page.screenshot({ path: path.join(out, `${width}-${theme}-${appearance}-${surface}.png`), fullPage: true });
      }
      await measure('doctor');
      await page.getByRole('tab', { name: 'MR-wise' }).click();
      await measure('mr');
      await page.getByRole('tab', { name: 'Doctor-wise' }).click();
      await page.getByTestId('button-transfer-' + uid(3)).click();
      await page.getByRole('combobox', { name: 'New MR', exact: true }).click();
      await page.getByRole('option').filter({ hasText: 'MR-002' }).click();
      await page.getByTestId('input-mapping-transfer-reason').fill('MR no longer covers this Area. ' + long.repeat(6));
      await measure('transfer');
      await page.keyboard.press('Tab');
      const trapped = await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]'));
      records.push({ width, theme, appearance, surface: 'dialog-keyboard', trapped });
      await page.keyboard.press('Escape');
      records.push({ width, theme, appearance, surface: 'focus-return',
        restored: await page.getByTestId('button-transfer-' + uid(3)).evaluate((e) => e === document.activeElement) });
      await page.getByTestId('button-area-' + uid(3)).click();
      await measure('area');
      await page.keyboard.press('Escape');
      await page.getByTestId('button-history-' + uid(3)).click();
      await page.getByTestId('list-assignment-history').waitFor();
      await measure('history');
      await page.keyboard.press('Escape');
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
