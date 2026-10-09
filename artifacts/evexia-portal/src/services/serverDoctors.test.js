import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { DOCTOR_CSV_COLUMNS } from './doctors.js';

test('Doctor transfer retains exact earlier full business CSV columns', () => {
  const headers = execFileSync('python3', ['-c',
    'import sys,json;sys.path.insert(0,"artifacts/api-server/backend");from app.services.doctor_transfer import HEADERS;print(json.dumps(HEADERS))'],
    { encoding: 'utf8' });
  assert.deepEqual(DOCTOR_CSV_COLUMNS.map(([, label]) => label), JSON.parse(headers));
});

test('Doctor transport guards identity, downloads, full MR choices and ambiguous writes', async () => {
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_key, fn) => fn() } } });
  const admin = { id: 'synthetic-admin', email: 'test@example.com', system_role: 'super_admin', permissions: ['admin.access', 'domain.provision'] };
  const saved = { id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', version: 7 };
  let mode = '', arrived, release;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/admin/doctors')) {
      if (mode === 'uncertain') throw new TypeError('Synthetic lost response');
      if (mode === 'late') return { ok: true, status: 200, json: () => { arrived(); return new Promise((r) => { release = () => r({ items: [] }); }); } };
      if (url.includes('/sample') || url.includes('/export')) return new Response('prepared workbook', { headers: { 'X-Download-Log': saved.id } });
      if (url.includes('/references')) {
        const offset = Number(new URL(url, 'http://test').searchParams.get('offset'));
        return Response.json({ items: [...Array.from({ length: offset ? 5 : 100 }, (_, index) => ({ id: `mr-${index + offset}` })), { id: 'saved-deleted', deleted: true }], total: 105, limit: 100 });
      }
      return Response.json({ items: [], total: 0, filtered: 0 });
    }
    if (url.includes('/admin/doctors/postal')) return Response.json({ pincode: '110001', choices: [] });
    return new Response(url.endsWith('/logout') ? null : JSON.stringify(url.endsWith('/me') ? admin
      : { user: admin, access_token: 'synthetic-token', expires_in: 900 }), { status: url.endsWith('/logout') ? 204 : 200 });
  };
  const session = await import('../auth/adminSession.js');
  const service = await import('./serverDoctors.js');
  try {
    await session.loginAdmin('test@example.com', 'Synthetic password', false);
    const all = await service.allDoctorMRChoices(undefined, saved.id);
    assert.equal(all.length, 106, 'No silent truncation at page 1; include missing/deleted saved assignment.');
    await service.editDoctor(saved, { name: 'Edited', paymentLimit: '9999999999999.99' });
    await service.deleteDoctor(saved);
    assert.deepEqual(JSON.parse(calls.find((c) => c.url.includes('/delete')).options.body), { expected_version: 7 });
    await service.bulkDoctors([saved], 'verification', 'verified');
    await service.lookupDoctorPIN('110001');
    const edit = calls.find((c) => c.url.includes('/edit'));
    assert.equal(JSON.parse(edit.options.body).expected_version, 7);
    assert.equal(JSON.parse(edit.options.body).paymentLimit, '9999999999999.99');
    const bulk = calls.find((c) => c.url.includes('/bulk'));
    assert.deepEqual(JSON.parse(bulk.options.body).selected, [{ id: saved.id, expected_version: 7 }]);
    assert.equal(await (await service.exportDoctors({ state: 'Delhi', mr_id: saved.id }, 'xlsx')).text(), 'prepared workbook');
    const download = calls.find((c) => c.url.includes('/export'));
    assert.match(download.options.headers['X-Download-Initiation'], /^[0-9a-f-]{36}$/i);
    assert.ok(download.url.includes('mr_id=' + saved.id));
    mode = 'uncertain';
    const before = calls.length;
    await assert.rejects(service.deleteDoctor(saved), (e) => e.ambiguous);
    assert.equal(calls.length, before + 1, 'Writes are never automatically replayed.');
    mode = 'late';
    const ready = new Promise((r) => { arrived = r; });
    const pending = service.listDoctors();
    await ready;
    await session.logoutAdmin();
    release();
    await assert.rejects(pending, /session|sign in/i);
    await assert.rejects(service.listDoctors(), /not permitted|permission|access|session|sign in/i);
  } finally { await session.logoutAdmin(); }
});
