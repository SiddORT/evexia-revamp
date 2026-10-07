import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { PATIENT_CSV_COLUMNS } from './patients.js';

test('Patient transfers retain the exact legacy 17-column CSV and prefer-not-to-say gender', () => {
  const data = execFileSync('python3', ['-c',
    'import sys,json;sys.path.insert(0,"artifacts/api-server/backend");from app.services.patient_transfer import LEGACY;print(json.dumps(LEGACY))'], { encoding: 'utf8' });
  assert.deepEqual(PATIENT_CSV_COLUMNS.map(([, label]) => label), JSON.parse(data));
});

test('Patient transport protects filters, expected versions, review bytes and late decoding', async () => {
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_key, fn) => fn() } } });
  const admin = { id: 'synthetic-admin', email: 'test@example.com', system_role: 'super_admin', permissions: ['admin.access', 'domain.provision', 'domain.assign_patient'] };
  const saved = { id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', version: 9 };
  let mode = '', arrived, release;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/admin/patients')) {
      if (mode === 'uncertain') throw new TypeError('Synthetic lost response');
      if (mode === 'late') return { ok: true, status: 200, json: () => { arrived(); return new Promise((r) => { release = () => r({ items: [] }); }); } };
      if (url.includes('/sample') || url.includes('/export')) return new Response('prepared workbook', { headers: { 'X-Download-Log': saved.id } });
      return Response.json({ items: [], total: 0, filtered: 0 });
    }
    return new Response(url.endsWith('/logout') ? null : JSON.stringify(url.endsWith('/me') ? admin
      : { user: admin, access_token: 'synthetic-token', expires_in: 900 }), { status: url.endsWith('/logout') ? 204 : 200 });
  };
  const session = await import('../auth/adminSession.js');
  const service = await import('./serverPatients.js');
  try {
    await session.loginAdmin('test@example.com', 'Synthetic password', false);
    await service.listPatients({ query: 'PAT-search', zone_id: saved.id, status: 'inactive', limit: 2, offset: 2 });
    await service.editPatient(saved, { name: 'Edited', dateOfBirth: '2000-01-01', dialCountry: 'GB', phone: '0712345678' });
    await service.statusPatient(saved, 'inactive');
    const file = new File(['exact synthetic bytes'], 'patients.csv');
    await service.reviewPatients(file);
    await service.importPatients(file, 'd'.repeat(64));
    const edit = calls.find((c) => c.url.includes('/edit'));
    assert.equal(JSON.parse(edit.options.body).expected_version, 9);
    assert.equal(JSON.parse(edit.options.body).dialCountry, 'GB');
    assert.equal(calls.find((c) => c.url.includes('/import/review')).options.body, file);
    assert.equal(calls.find((c) => c.url.includes('/import/commit')).options.body, file);
    assert.equal(await (await service.exportPatients({ mr_id: saved.id }, 'xlsx')).text(), 'prepared workbook');
    const exported = calls.find((c) => c.url.includes('/export'));
    assert.match(exported.options.headers['X-Download-Initiation'], /^[0-9a-f-]{36}$/i);
    for (const call of calls.filter((c) => c.url.includes('/admin/patients'))) assert.equal(call.options.cache, 'no-store');
    mode = 'uncertain';
    const before = calls.length;
    await assert.rejects(service.createPatient({}), (e) => e.ambiguous);
    assert.equal(calls.length, before + 1);
    mode = 'late';
    const ready = new Promise((r) => { arrived = r; });
    const pending = service.listPatients();
    await ready;
    await session.logoutAdmin();
    release();
    await assert.rejects(pending, /session|sign in/i);
    await assert.rejects(service.listPatients(), /access|session|sign in/i);
  } finally { await session.logoutAdmin(); }
});
