import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
globalThis.BroadcastChannel = undefined;
const auth = await import('../auth/adminSession.js');
const { downloadBlob, downloadServerBlob } = await import('./downloads.js');
const { releaseBlob } = await import('./downloadRelease.js');
const { buildInvoicePdf } = await import('./poInvoicePdf.js');

test('release waits for durable metadata acceptance; retries, repeat clicks, privacy and identity changes', async () => {
  const user = { id: 'synthetic-download-user', email: 'synthetic@example.test', system_role: 'super_admin', permissions: ['admin.access'] };
  let mode = 'ok', resume, starts = [], clicks = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_name, work) => work() } } });
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/downloads/initiate')) {
      starts.push(JSON.parse(options.body));
      if (mode === 'offline') throw new Error('offline');
      if (mode === 'deferred') await new Promise((r) => { resume = r; });
      return new Response(JSON.stringify({ id: crypto.randomUUID(), provenance: 'browser_reported' }));
    }
    return new Response(JSON.stringify(url.endsWith('/me') ? user : { access_token: 'synthetic-token', expires_in: 900 }));
  };
  globalThis.document = { createElement: () => ({ click() { clicks++; if (mode === 'handoff') throw new Error('blocked'); }, remove() {} }), body: { appendChild() {} } };
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {};
  const metadata = { source: 'patient', kind: 'export', format: 'CSV' };
  const blob = new Blob(['PRIVATE DOCTOR PATIENT RECORDS']);
  const run = () => downloadBlob(blob, 'sensitive-local-filename.csv', metadata);
  try {
    await auth.loginAdmin(user.email, 'synthetic-password', false);
    mode = 'offline';
    await assert.rejects(run(), /No file was released.*Retry/);
    assert.equal(clicks, 0);
    const failedId = starts.at(-1).initiation_id;
    mode = 'deferred';
    const first = run();
    while (!resume) await new Promise((r) => setTimeout(r, 0));
    await assert.rejects(run(), /already being prepared/);
    assert.equal(clicks, 0);
    resume(); await first; resume = null;
    assert.equal(starts.at(-1).initiation_id, failedId);
    assert.equal(clicks, 1);
    mode = 'ok'; await run();
    assert.notEqual(starts.at(-1).initiation_id, failedId);
    for (const body of starts) {
      assert.deepEqual(Object.keys(body).sort(), ['format', 'initiation_id', 'kind', 'source']);
      assert.ok(!JSON.stringify(body).includes('PRIVATE'));
      assert.ok(!JSON.stringify(body).includes('sensitive'));
    }
    const before = starts.length;
    assert.throws(() => buildInvoicePdf([])); // builders/failed preparation never initiate
    assert.equal(starts.length, before);
    assert.throws(() => downloadServerBlob(blob, 'unaccepted.csv'), /acceptance is missing/);
    mode = 'handoff'; await assert.rejects(run(), /Initiation was recorded/);
    const acknowledged = starts.at(-1).initiation_id;
    mode = 'ok'; await run();
    assert.notEqual(starts.at(-1).initiation_id, acknowledged);
    mode = 'deferred';
    const pending = run();
    while (!resume) await new Promise((r) => setTimeout(r, 0));
    const rejection = assert.rejects(pending, /No file was released/);
    const clicksBefore = clicks;
    await auth.logoutAdmin();
    await auth.loginAdmin(user.email, 'synthetic-password', false);
    resume(); await rejection;
    assert.equal(clicks, clicksBefore);
  } finally {
    await auth.logoutAdmin();
    URL.createObjectURL = create; URL.revokeObjectURL = revoke;
    delete globalThis.document;
  }
});

test('handoff guards run before URL creation and again before click; refused handoffs clean up', async () => {
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  let creates = 0, clicks = 0, removes = 0, revokes = 0;
  globalThis.document = {
    createElement: () => ({ click() { clicks++; }, remove() { removes++; } }),
    body: { appendChild() {} },
  };
  URL.createObjectURL = () => { creates++; return 'blob:synthetic-handoff'; };
  // Earlier test handoffs have delayed cleanup too; count only this test's URL.
  URL.revokeObjectURL = (url) => { if (url === 'blob:synthetic-handoff') revokes++; };
  try {
    for (const failAt of [1, 2]) {
      let guards = 0;
      assert.throws(() => releaseBlob(new Blob(['synthetic']), 'synthetic.csv', () => {
        if (++guards === failAt) throw Object.assign(new Error('session changed'), { status: 401 });
      }), /recorded.*handoff failed.*Retry.*Your session changed/);
      assert.equal(guards, failAt);
      assert.equal(clicks, 0);
    }
    assert.equal(creates, 1); // the first guard prevented any object URL
    assert.equal(removes, 2);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(revokes, 1);
  } finally {
    URL.createObjectURL = create; URL.revokeObjectURL = revoke;
    delete globalThis.document;
  }
});

test('all app-controlled file releases remain centralized; rendering URLs are not download actions', () => {
  const root = new URL('../', import.meta.url);
  const files = [];
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.(jsx|js)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(child);
    }
  }
  walk(root.pathname);
  const raw = files.filter((p) => /\.download\s*=|\.saveAs\(|XLSX\.writeFile\(/.test(readFileSync(p, 'utf8')));
  assert.deepEqual(raw.map((p) => p.split('/').at(-1)), ['downloadRelease.js']);
});
