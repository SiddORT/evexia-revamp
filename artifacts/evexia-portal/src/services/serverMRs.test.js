import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { emptyMRValues, payloadFromValues, validateMRValues } from './serverMRs.js';
import { CSV_COLUMNS as LEGACY_COLUMNS } from './mrs.js';

const values = { ...emptyMRValues(), name: 'Synthetic MR', phone: '', email: '', contactRequirement: 'optional',
  userId: 'synthetic.mr', employeeCode: 'MR-01', hq: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  zoneId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', dateOfJoining: '2020-01-01', designation_id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
  addressLine1: 'Synthetic address', landmark: 'Synthetic landmark', pincode: '110001',
  city: 'Delhi', state: 'Delhi', country: 'India', paymentLimit: '', doctorDaysLimit: '' };

test('MR bounded frontend/business validation agrees with authoritative Python defaults', () => {
  const headers = execFileSync('python3', ['-c',
    'import sys,json;sys.path.insert(0,"artifacts/api-server/backend");from app.services.mr_transfer import HEADERS;print(json.dumps(HEADERS))'],
    { encoding: 'utf8' });
  assert.deepEqual(LEGACY_COLUMNS.map(([, label]) => label), JSON.parse(headers), 'Preserve the exact shipped legacy CSV header');
  const cases = [values, ...[
    ['name', ''], ['name', 'x'.repeat(201)], ['userId', 'a@b.com'], ['email', 'bad'], ['phone', '123'],
    ['dateOfJoining', '2020-02-30'], ['pincode', '012345'], ['paymentLimit', '-1'], ['paymentLimit', '1.001'],
    ['doctorDaysLimit', '3651'], ['doctorDaysLimit', '1.5'], ['contactRequirement', 'required'],
    ['designation_id', ''], ['designation_id', 'Free text'],
  ].map(([key, value]) => ({ ...values, [key]: value }))];
  const python = execFileSync('python3', ['-c',
    'import sys,json;sys.path.insert(0,"artifacts/api-server/backend");from app.schemas.mrs import MRFields;out=[]\nfor b in json.loads(sys.argv[1]):\n b["reportingManagerId"]=b["reportingManagerId"] or None\n try: MRFields.model_validate(b);out.append(True)\n except ValueError: out.append(False)\nprint(json.dumps(out))', JSON.stringify(cases)], { encoding: 'utf8' });
  assert.deepEqual(cases.map((v) => Object.keys(validateMRValues(v)).length === 0), JSON.parse(python));
  assert.equal(payloadFromValues(values).paymentLimit, '0.00');
  assert.equal(payloadFromValues(values).doctorDaysLimit, 0);
});

test('MR transport is no-store, versioned, ledger-backed and never replays ambiguous writes or late decoding', async () => {
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_key, fn) => fn() } } });
  const admin = { id: 'synthetic-admin', email: 'test@example.com', system_role: 'super_admin', permissions: ['admin.access', 'domain.provision'] };
  const mr = { id: 'synthetic-mr', mr_id: values.hq, email: null, username: values.userId,
    system_role: 'mr', identity_kind: 'mr', permissions: [] };
  const calls = [];
  let mode = '', identity = admin, release, arrived;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/admin/mrs')) {
      if (mode === 'uncertain') throw new TypeError('Synthetic uncertain transport');
      if (mode === 'decode') return { ok: true, status: 200, json: () => { arrived(); return new Promise((resolve) => { release = () => resolve(values); }); } };
      if (url.includes('/sample') || url.includes('/export')) return new Response('synthetic workbook', { headers: { 'X-Download-Log': values.hq } });
      return new Response(JSON.stringify({ items: [values], total: 1, filtered: 1 }));
    }
    return new Response(url.endsWith('/logout') ? null : JSON.stringify(url.endsWith('/me') ? identity
      : { user: identity, access_token: 'synthetic-memory-token', expires_in: 900 }), { status: url.endsWith('/logout') ? 204 : 200 });
  };
  const session = await import('../auth/adminSession.js');
  const service = await import('./serverMRs.js');
  try {
    await session.loginAdmin(admin.email, 'Synthetic password', false);
    await service.listMRs({ status: 'inactive', zone_id: values.zoneId, hq_id: values.hq });
    await service.createMR(payloadFromValues(values), 'Synthetic manual initial password');
    await service.editMR({ id: values.hq, version: 7 }, payloadFromValues(values));
    await service.resetMRPassword({ id: values.hq, version: 7 });
    await service.resolveMRAccount(values.userId);
    const reset = calls.find((c) => c.url.includes('/reset?'));
    assert.deepEqual(JSON.parse(reset.options.body), { expected_version: 7 });
    const edit = calls.find((c) => c.url.includes('/edit?'));
    assert.equal(JSON.parse(edit.options.body).initialPassword, undefined);
    const blob = await service.exportMRs({ query: 'name', zone_id: values.zoneId }, 'xlsx');
    assert.equal(await blob.text(), 'synthetic workbook');
    const exported = calls.find((c) => c.url.includes('/export'));
    assert.match(exported.options.headers['X-Download-Initiation'], /^[0-9a-f-]{36}$/i);
    for (const c of calls.filter((c) => c.url.includes('/admin/mrs'))) {
      assert.equal(c.options.cache, 'no-store');
      assert.equal(c.options.headers.Authorization, 'Bearer synthetic-memory-token');
      assert.ok(!c.url.includes('password'));
    }
    mode = 'uncertain';
    const before = calls.length;
    await assert.rejects(service.createMR(payloadFromValues(values)), (e) => e.ambiguous);
    assert.equal(calls.length, before + 1);
    mode = 'decode';
    const decoding = new Promise((r) => { arrived = r; });
    const late = service.listMRs({});
    await decoding;
    await session.logoutAdmin();
    release();
    await assert.rejects(late, /session|sign in/i);
    identity = mr; mode = '';
    await session.loginMr(values.userId, 'Synthetic password', true);
    assert.equal(session.getSession().user.identity_kind, 'mr');
    await session.verifySession();
    assert.equal(session.getSession().user.identity_kind, 'mr');
    await assert.rejects(service.listMRs({}), /not permitted|permission|access/i);
  } finally { await session.logoutAdmin(); }
});
