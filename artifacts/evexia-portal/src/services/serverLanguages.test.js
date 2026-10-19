import test from 'node:test';
import assert from 'node:assert/strict';
import { loginAdmin, logoutAdmin, languageRequest } from '../auth/adminSession.js';
import { listLanguages, getLanguage, createLanguage, editLanguage, deleteLanguage, getLanguageHistory } from './serverLanguages.js';

test('Language CRUD transport carries names/versions, rejects bad results and never replays uncertain mutations', async () => {
  const originalFetch = globalThis.fetch;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_, fn) => fn() } } });
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: {
    getItem() { assert.fail('No local business storage'); },
    setItem() { assert.fail('No local business storage'); },
    removeItem() { assert.fail('No local business storage'); },
  } };
  const admin = { id: 'synthetic-admin', identity_kind: 'super_admin', system_role: 'super_admin',
    email: 'synthetic@example.test', permissions: ['admin.access'] };
  const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const at = '2026-10-19T10:00:00Z';
  const record = { id, name: 'मराठी', version: 1, createdBy: 'Super Admin', updatedBy: 'Super Admin',
    createdAt: at, updatedAt: at, deletedBy: null, deletedAt: null };
  const calls = [];
  let mode = '', next = record;
  globalThis.fetch = async (url, options) => {
    if (url.startsWith('/api/v1/auth')) return new Response(url.endsWith('/logout') ? null
      : JSON.stringify(url.endsWith('/me') ? admin : { access_token: 'synthetic-token', expires_in: 900 }),
    { status: url.endsWith('/logout') ? 204 : 200 });
    assert.ok(url.startsWith('/api/v1/admin/languages'));
    calls.push({ url, options });
    if (mode === 'network') throw new Error('synthetic-private-body');
    if (mode === 'unavailable') return new Response(JSON.stringify({ error: {
      code: 'language_unavailable', message: 'Language persistence is unavailable. Retry later.',
    } }), { status: 503 });
    if (mode === 'stale') return new Response(JSON.stringify({ error: {
      code: 'language_stale', message: 'Language changed. Review current details.',
    } }), { status: 409 });
    if (mode === 'duplicate') return new Response(JSON.stringify({ error: {
      code: 'language_duplicate', message: 'A non-deleted language already uses this name.',
    } }), { status: 409 });
    if (mode === 'invalid-json') return new Response('not-json');
    return new Response(JSON.stringify(next));
  };
  try {
    await loginAdmin(admin.email, 'synthetic-password', false);
    await createLanguage({ name: 'मराठी' });
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { name: 'मराठी' });
    assert.equal(calls.at(-1).options.method, 'POST');
    assert.equal(calls.at(-1).options.credentials, 'same-origin');
    assert.equal((await getLanguage(id)).id, id);
    next = { items: [record], total: 2, filtered: 1, limit: 10, offset: 0 };
    assert.equal((await listLanguages({ query: 'मराठी', limit: 10, offset: 0 })).filtered, 1);
    assert.equal(new URL(calls.at(-1).url, 'https://synthetic.test').searchParams.get('query'), 'मराठी');
    next = { ...record, name: 'Marathi', version: 2 };
    await editLanguage(record, { name: 'Marathi' });
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { name: 'Marathi', expected_version: 1 });
    const edited = next;
    next = { ...edited, version: 3, deletedBy: 'Super Admin', deletedAt: at };
    await deleteLanguage(edited);
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { expected_version: 2 });
    next = { record: next, items: [{ id, action: 'delete', version: 3, actor: 'Super Admin',
      at, beforeName: 'Marathi', afterName: 'Marathi' }], total: 3, limit: 1, offset: 2,
    summary: { scope: 'All committed changes for this language, including deletion',
      creates: 1, edits: 1, deletes: 1, total: 3, latestChange: at } };
    const history = await getLanguageHistory(id, { limit: 1, offset: 2 });
    assert.equal(history.items.length, 1);
    assert.equal(history.summary.total, 3);
    for (const failure of ['network', 'invalid-json', 'unavailable']) {
      mode = failure;
      const before = calls.length;
      await assert.rejects(createLanguage({ name: 'Draft preserved' }),
        (e) => e.ambiguous === true && !e.message.includes('synthetic-private-body'));
      assert.equal(calls.length, before + 1, 'uncertain create must not replay');
    }
    mode = '';
    next = {};
    await assert.rejects(createLanguage({ name: 'Draft preserved' }), (e) => e.ambiguous === true);
    next = { ...record, id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' };
    await assert.rejects(editLanguage(record, { name: 'Draft preserved' }), (e) => e.ambiguous === true);
    mode = 'stale';
    await assert.rejects(editLanguage(record, { name: 'Draft preserved' }),
      (e) => e.status === 409 && e.code === 'language_stale' && !e.ambiguous);
    mode = 'duplicate';
    await assert.rejects(createLanguage({ name: 'मराठी' }),
      (e) => e.status === 409 && e.code === 'language_duplicate' && !e.ambiguous);
    const count = calls.length;
    for (const path of ['/export', '/sample', '/trash', `/${id}/restore`, `/${id}/status`]) {
      await assert.rejects(languageRequest(path), /Unsupported Language operation/);
    }
    assert.equal(calls.length, count, 'out-of-scope operations never reach the network');
  } finally {
    await logoutAdmin();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});
