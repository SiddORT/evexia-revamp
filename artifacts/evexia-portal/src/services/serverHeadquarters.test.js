import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { abbreviation, normalizeCode, normalizeName, validateHeadquarter } from './headquarterCode.js';

test('Unicode abbreviation and validation match backend including overrides and bounds', () => {
  const names = ['Mumbai', 'North Mumbai', 'North-Mumbai', '123', 'École', 'e\u0301cole', 'नवी मुंबई', 'ßeta', '𐐨ab', 'A '.repeat(30), 'a.b_c/d', '東京', 'A\u0085B', 'a\uFEFFb', 'q', ''];
  const python = execFileSync('python3', ['-c',
    'import sys,json;sys.path.insert(0,"artifacts/api-server/backend");from app.schemas.headquarters import abbreviation;print(json.dumps([abbreviation(n) for n in json.loads(sys.argv[1])]))',
    JSON.stringify(names)], { encoding: 'utf8' });
  assert.deepEqual(names.map(abbreviation), JSON.parse(python));
  assert.equal(normalizeName('\u0085 A\tB\u001c'), 'A B');
  assert.equal(normalizeCode(' ß '), 'SS');
  const good = { name: 'HQ', state_code: 'h', status: 'active' };
  assert.deepEqual(validateHeadquarter(good), {});
  for (const bad of [{ name: '' }, { name: 'x'.repeat(201) }, { state_code: '' },
    { state_code: 'x'.repeat(17) }, { name: '\uFEFF' }, { state_code: 'a\nb' }, { status: 'unknown' }]) {
    assert.ok(Object.keys(validateHeadquarter({ ...good, ...bad })).length);
  }
});

test('HQ authenticated transport versions, transfers, uncertain writes and identity decoding guards', async () => {
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_key, work) => work() } } });
  const user = { id: 'synthetic-admin', email: 'synthetic@example.test', system_role: 'super_admin', permissions: ['admin.access'] };
  const calls = [];
  const record = { id: '00000000-0000-0000-0000-000000000001', name: 'City', state_code: 'CI', status: 'active', version: 4 };
  let mode = '';
  let release, arrived;
  globalThis.fetch = async (url, options) => {
    if (url.includes('/admin/headquarters')) {
      calls.push({ url, options });
      if (mode === 'uncertain') throw new TypeError('synthetic connection loss');
      if (mode === 'invalid-json') return { ok: true, status: 200, json: async () => { throw new Error('synthetic decode'); } };
      if (mode === 'decode') return { ok: true, status: 200, json: () => { arrived(); return new Promise((resolve) => { release = () => resolve(record); }); } };
      if (url.includes('/export') || url.includes('/sample')) return new Response('file bytes', { headers: { 'X-Download-Log': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' } });
      return new Response(JSON.stringify(url.includes('/import/commit') ? { imported: 2 }
        : url.includes('/import/review') ? { valid: true, rows: [], digest: 'confirmation' }
        : options.method === 'GET' && url.includes('limit=') ? { items: [record], total: 10, filtered: 2 } : record));
    }
    return new Response(options.method === 'POST' && url.endsWith('/logout') ? null : JSON.stringify(url.endsWith('/me') ? user : { user, access_token: 'synthetic-token', expires_in: 900 }),
      { status: url.endsWith('/logout') ? 204 : 200 });
  };
  const session = await import('../auth/adminSession.js');
  const service = await import('./serverHeadquarters.js');
  await session.loginAdmin(user.email, 'synthetic-password', false);
  assert.equal((await service.listHeadquarters({ query: 'CI', status: 'inactive', limit: 2, offset: 2 })).filtered, 2);
  assert.match(calls[0].url, /query=CI&status=inactive&limit=2&offset=2/);
  await service.createHeadquarter({ name: 'New', status: 'active' });
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: 'New', status: 'active' });
  await service.getHeadquarter(record.id);
  await service.editHeadquarter(record, { name: 'Revised', state_code: 'OV', status: 'inactive' });
  assert.deepEqual(JSON.parse(calls[3].options.body), { name: 'Revised', state_code: 'OV', status: 'inactive', expected_version: 4 });
  await service.statusHeadquarter(record, 'inactive');
  assert.deepEqual(JSON.parse(calls[4].options.body), { status: 'inactive', expected_version: 4 });
  await service.deleteHeadquarter(record);
  assert.deepEqual(JSON.parse(calls[5].options.body), { expected_version: 4 });
  const file = Object.assign(new Blob(['HQ Name,State Code,Status\nName,,active']), { name: 'hq.csv' });
  assert.equal((await service.reviewHeadquarters(file)).digest, 'confirmation');
  assert.equal(calls[6].options.body, file);
  assert.deepEqual(await service.importHeadquarters(file, 'confirmation'), { imported: 2 });
  assert.match(calls[7].url, /digest=confirmation&confirm=true/);
  const controller = new AbortController();
  const blob = await service.exportHeadquarters({ query: 'CI', status: 'inactive' }, 'xlsx', controller.signal);
  assert.equal(await blob.text(), 'file bytes');
  assert.match(calls[8].url, /query=CI&status=inactive&format=xlsx/);
  assert.match(calls[8].options.headers['X-Download-Initiation'], /^[0-9a-f-]{36}$/i);
  assert.equal(await (await service.sampleHeadquarters('csv')).text(), 'file bytes');
  assert.match(calls[9].url, /\/sample\?format=csv/);
  controller.abort();
  await assert.rejects(service.exportHeadquarters({}, 'csv', controller.signal), /abort/i);
  for (const { options } of calls) {
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    assert.equal(options.cache, 'no-store');
  }
  mode = 'uncertain';
  const before = calls.length;
  await assert.rejects(service.editHeadquarter(record, { name: 'Unsure', status: 'active' }), (error) => error.ambiguous);
  assert.equal(calls.length, before + 1, 'Never replay an uncertain write');
  mode = 'invalid-json';
  await assert.rejects(service.deleteHeadquarter(record), (error) => error.ambiguous);
  mode = 'decode';
  const started = new Promise((resolve) => { arrived = resolve; });
  const late = service.getHeadquarter(record.id);
  await started;
  await session.logoutAdmin();
  release();
  await assert.rejects(late, /session changed/i);
  assert.throws(() => session.serverDownloadGuard(blob), /session changed/i);
});
