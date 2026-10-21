// New API-backed email feature only. No browser, real network or local persistence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { loginAdmin, logoutAdmin } from '../auth/adminSession.js';
import { EMAIL_VARIABLES, INVITATION_VARIABLES, loadEmailTemplates, getEmailTemplate, saveEmailTemplate, deleteEmailTemplate } from './emailTemplates.js';
import { buildEmailPreview } from './messageTemplatePreview.js';
import { MESSAGE_TEMPLATES_KEY, loadMessageTemplates, saveMessageTemplate, deleteMessageTemplate } from './messageTemplates.js';

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name, ...args) => args.at(-1)() } } });
const id = 'e7e80000-0000-4000-8000-000000000001';
const newId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row = { id, protected: true, version: 1, name: 'Forgot password', description: 'Recovery',
  event_key: 'password_recovery', subject: 'Reset password', html: '<p>{{reset_url}}</p>', text: '{{reset_url}}' };
const invitation = { ...row, id: 'e7e80000-0000-4000-8000-000000000002', name: 'Invite staff member',
  event_key: 'account_invitation', subject: 'Invitation', html: '<p>{{portal_name}} {{login_id}}</p>', text: '{{portal_name}} {{login_id}}' };
const envelope = (items = [row, invitation]) => ({ items, events: [
  { key: 'password_recovery', label: 'Password recovery', required: true, variables: EMAIL_VARIABLES },
  { key: 'account_invitation', label: 'Staff / MR invitation', required: true, variables: INVITATION_VARIABLES },
] });
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: new Headers() });

async function signedIn(t, work) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/v1/auth/login') return response({ access_token: 'synthetic-in-memory-token', expires_in: 3600 });
    if (url === '/api/v1/auth/me') return response({ id: newId, email: 'admin@example.org', identity_kind: 'super_admin', system_role: 'super_admin', permissions: ['admin.access'] });
    if (url === '/api/v1/auth/logout') return { ok: true, status: 204 };
    calls.push({ url, options });
    return work(url, options);
  };
  t.after(async () => { await logoutAdmin(); globalThis.fetch = previous; });
  await loginAdmin('synthetic-admin', 'synthetic-not-a-real-password', false);
  return calls;
}

test('email list/detail/create/edit/delete use authenticated API and versioned source', async (t) => {
  const calls = await signedIn(t, async (url) => response(url.endsWith(`/${id}`) ? row : envelope()));
  const snapshot = await loadEmailTemplates();
  assert.equal(snapshot.record.templates[0].eventKey, 'password_recovery');
  assert.equal(snapshot.record.templates[1].eventKey, 'account_invitation');
  assert.deepEqual(snapshot.record.events[1].variables, INVITATION_VARIABLES);
  const draft = await getEmailTemplate(id);
  const input = { ...draft, name: 'Edited recovery' };
  await saveEmailTemplate(draft, input);
  assert.equal(calls[2].url, `/api/v1/admin/email-templates/${id}/edit`);
  assert.equal(JSON.parse(calls[2].options.body).version, 1);
  assert.equal(JSON.parse(calls[2].options.body).event_key, 'password_recovery');
  await saveEmailTemplate({ creationId: newId, id: null }, { ...input, eventKey: null });
  assert.equal(JSON.parse(calls[3].options.body).creation_id, newId);
  assert.equal(JSON.parse(calls[3].options.body).event_key, null);
  await deleteEmailTemplate({ id: newId, version: 3 });
  assert.deepEqual(JSON.parse(calls[4].options.body), { version: 3 });
  assert.ok(calls.every(({ options }) => options.cache === 'no-store' && options.credentials === 'same-origin' && options.headers.Authorization === 'Bearer synthetic-in-memory-token'));
});

test('lost email mutation response is uncertain and never automatically replayed', async (t) => {
  const calls = await signedIn(t, async () => { throw new TypeError('synthetic disconnect'); });
  await assert.rejects(() => saveEmailTemplate({ id, version: 1 }, {
    ...row, eventKey: 'password_recovery', content: { subject: row.subject, html: row.html, text: row.text },
  }), (error) => error.ambiguous === true && /reconcile/.test(error.message));
  assert.equal(calls.length, 1);
});

test('HTTP 200 predecessor snapshots fail closed on reads and saves without replay', async (t) => {
  const predecessor = { items: [row], events: [envelope().events[0]] };
  const calls = await signedIn(t, async (url) => response(url.endsWith(`/${id}`) ? row : predecessor));
  await assert.rejects(loadEmailTemplates, (e) => e.ambiguous === true && /invalid response.*draft is kept/.test(e.message));
  const draft = await getEmailTemplate(id);
  const before = structuredClone(draft);
  await assert.rejects(() => saveEmailTemplate(draft, draft), (e) => e.ambiguous === true && /draft is kept/.test(e.message));
  assert.deepEqual(draft, before);
  assert.equal(calls.length, 3, 'one list, one detail and one explicit mutation only');
});

test('invalid responses and stale saves never become local success', async (t) => {
  let mode = 'invalid';
  const calls = await signedIn(t, async () => mode === 'invalid' ? response({ items: [] }) : response({ error: { code: 'conflict' } }, 409));
  await assert.rejects(loadEmailTemplates, (error) => error.ambiguous === true);
  mode = 'conflict';
  await assert.rejects(() => deleteEmailTemplate({ id: newId, version: 1 }), (error) => error.code === 'conflict' && /draft is kept/.test(error.message));
  assert.equal(calls.length, 2);
});

test('load failures distinguish connection, timeout, cancellation and invalid server bodies without leaking details', async (t) => {
  const privateDetail = 'private-response-content-and-credentials';
  for (const [code, work, message] of [
    ['ET_NETWORK', async () => { throw new TypeError(privateDetail); }, /could not complete the connection/],
    ['ET_TIMEOUT', async () => { throw new DOMException(privateDetail, 'TimeoutError'); }, /15 seconds/],
    ['ET_CANCELLED', async () => { throw new DOMException(privateDetail, 'AbortError'); }, /cancelled/],
    ['ET_HTML_RESPONSE', async () => ({ ...response(null), headers: new Headers({ 'Content-Type': 'text/html' }),
      json: async () => { throw new SyntaxError(privateDetail); } }), /HTTP 200 HTML instead of JSON/],
    ['ET_INVALID_JSON', async () => ({ ...response(null, 502), headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => { throw new SyntaxError(privateDetail); } }), /HTTP 502 without readable JSON/],
  ]) {
    await t.test(code, async (subtest) => {
      const calls = await signedIn(subtest, work);
      await assert.rejects(loadEmailTemplates, (error) => error.code === code
        && error.ambiguous === false && message.test(error.message)
        && !error.message.includes(privateDetail));
      assert.equal(calls.length, 1, 'diagnosis must not replay the request');
    });
  }
});

test('unreadable mutation response stays uncertain without replay or leaked body', async (t) => {
  const calls = await signedIn(t, async () => ({ ...response(null), headers: new Headers({ 'Content-Type': 'text/html' }),
    json: async () => { throw new SyntaxError('private-server-response'); } }));
  await assert.rejects(() => deleteEmailTemplate({ id: newId, version: 1 }),
    (error) => error.ambiguous === true && error.code === 'ET_HTML_RESPONSE'
      && /Save outcome could not be confirmed/.test(error.message)
      && !error.message.includes('private-server-response'));
  assert.equal(calls.length, 1);
});

test('collection/API absence is not a deleted record, even on a stale detail route', async (t) => {
  let code = 'not_found', status = 404;
  const calls = await signedIn(t, async () => response({ error: { code } }, status));
  await assert.rejects(loadEmailTemplates, (e) => e.status === 404 && /API is unavailable/.test(e.message) && !/no longer exists/.test(e.message));
  await assert.rejects(() => getEmailTemplate(id), /API is unavailable/);
  await assert.rejects(() => saveEmailTemplate({ id: null, creationId: newId }, {
    name: 'Draft', description: '', eventKey: null, content: { subject: 'Subject', html: '<p>Draft</p>', text: 'Draft' },
  }), /API is unavailable/);
  code = 'email_template_not_found';
  await assert.rejects(() => getEmailTemplate(id), /Template no longer exists.*draft is kept/);
  // A malformed collection response must never imply a particular record was deleted.
  await assert.rejects(loadEmailTemplates, /API is unavailable/);
  status = 503;
  await assert.rejects(loadEmailTemplates, /storage is unavailable/);
  assert.equal(calls.length, 6);
});

test('email previews stay isolated and fictional; source has no copy controls or local email fallback', () => {
  const preview = buildEmailPreview('<p><a href="{{reset_url}}">Reset</a></p><img src="https://external.example/test">', { reset_url: 'https://preview.example.invalid/fictional' });
  assert.ok(preview.includes("default-src 'none'"));
  assert.ok(!preview.includes('<a ') && !preview.includes('src="https:'));
  const settings = fs.readFileSync(new URL('../components/admin/MessageTemplateSettings.jsx', import.meta.url), 'utf8');
  const library = fs.readFileSync(new URL('../components/admin/EmailTemplateLibrary.jsx', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('../components/admin/MessageTemplateEditor.jsx', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('./emailTemplates.js', import.meta.url), 'utf8');
  for (const source of [settings, library, editor]) assert.doesNotMatch(source, /Copy to draft|cloneDraft|copySource|button-(?:drawer-)?copy-template/);
  assert.doesNotMatch(library + service, /localStorage|loadMessageTemplates|SYSTEM_TEMPLATES/);
  const local = fs.readFileSync(new URL('./messageTemplates.js', import.meta.url), 'utf8');
  assert.doesNotMatch(local, /system-email-|fictional password reset request/);
  assert.match(library, /setEditor.*draft: fresh/);
  assert.match(editor, /Load latest to reconcile \(keep draft\)/);
});

test('changed workspace components parse as JSX (no app build or browser run)', async () => {
  const require = createRequire(new URL('../../package.json', import.meta.url));
  const viteRequire = createRequire(require.resolve('vite/package.json'));
  const { transform } = viteRequire('esbuild');
  for (const name of ['MessageTemplateSettings', 'EmailTemplateLibrary', 'MessageTemplateEditor', 'MessageTemplatePreview']) {
    const source = fs.readFileSync(new URL(`../components/admin/${name}.jsx`, import.meta.url), 'utf8');
    const output = await transform(source, { loader: 'jsx', jsx: 'automatic' });
    assert.ok(output.code.length > 0);
  }
});

test('SMS writes retain legacy local emails without exposing, migrating or deleting them', async () => {
  const legacyEmail = { id: newId, source: 'user', channel: 'email', name: 'Legacy local email',
    description: '', content: { subject: 'Legacy subject', html: '<p>Legacy</p>', text: 'Legacy text' } };
  const values = new Map([[MESSAGE_TEMPLATES_KEY, JSON.stringify({ version: 1, revision: 'legacy', templates: [legacyEmail] })]]);
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) } };
  try {
    const baseline = loadMessageTemplates();
    assert.deepEqual(baseline.record.templates, []);
    await assert.rejects(() => saveMessageTemplate(baseline, legacyEmail), /authenticated email service/);
    await assert.rejects(() => deleteMessageTemplate(baseline, newId), /Legacy local email records/);
    const saved = await saveMessageTemplate(baseline, { channel: 'sms', name: 'New SMS', description: '',
      content: { body: 'A synthetic SMS', providerTemplateId: 'synthetic-id' } });
    assert.equal(saved.record.templates.length, 1);
    assert.equal(saved.record.templates[0].channel, 'sms');
    assert.deepEqual(JSON.parse(values.get(MESSAGE_TEMPLATES_KEY)).templates.find((t) => t.id === newId), legacyEmail);
    await deleteMessageTemplate(saved, saved.record.templates[0].id);
    assert.deepEqual(JSON.parse(values.get(MESSAGE_TEMPLATES_KEY)).templates, [legacyEmail]);
  } finally { globalThis.window = previous; }
});
