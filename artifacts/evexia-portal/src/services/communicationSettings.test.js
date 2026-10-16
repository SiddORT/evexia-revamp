import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANNELS, configurationFields, validateConfiguration, snapshotFromResponse, loadCommunicationSnapshot, saveConfiguration, chooseCommunicationDefault, deleteConfiguration } from './communicationSettings.js';
import { loginAdmin, logoutAdmin, communicationRequest } from '../auth/adminSession.js';

const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const id2 = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const smtp = { type: 'smtp', name: 'Synthetic SMTP', host: 'smtp.example.test', port: '587', security: 'starttls', username: 'synthetic', fromName: 'Synthetic', fromEmail: 'sender@example.test' };
const fixtures = [
  ['email', smtp],
  ['email', { type: 'api', name: 'Email API', provider: 'Synthetic', endpoint: 'https://mail.example.test', fromName: 'Synthetic', fromEmail: 'sender@example.test' }],
  ['email', { type: 'platform', name: 'Platform', provider: 'Synthetic', endpoint: 'https://platform.example.test', fromName: 'Synthetic', fromEmail: 'sender@example.test' }],
  ['sms', { type: 'api', name: 'SMS', provider: 'Synthetic', endpoint: 'https://sms.example.test', senderId: 'SYNTH', dltEntityId: '', dltTemplateId: '' }],
  ['waba', { type: 'api', name: 'WABA', provider: 'Synthetic', endpoint: 'https://waba.example.test', businessAccountId: 'business', phoneNumberId: 'phone', senderPhone: '+91 98765 43210', apiVersion: '' }],
];
const empty = () => ({ channels: Object.fromEntries(CHANNELS.map((c) => [c, { version: 1, configurations: [], defaultId: null }])) });
const saved = () => {
  const data = empty();
  const { type, ...values } = smtp;
  data.channels.email = { version: 2, defaultId: id, configurations: [{ id, type, version: 1, values, credentialPresent: true }] };
  return data;
};

test('channel/type schemas retain every entered value, include only explicit secret replacements and reject unknown fields', () => {
  for (const [channel, body] of fixtures) {
    assert.deepEqual(validateConfiguration(channel, body), body);
    assert.deepEqual(configurationFields(channel, body.type).sort(), Object.keys(body).filter((k) => k !== 'type').sort());
    assert.equal(validateConfiguration(channel, { ...body, secret: 'synthetic-secret' }).secret, 'synthetic-secret');
    assert.equal('secret' in validateConfiguration(channel, { ...body, secret: '' }), false);
    assert.throws(() => validateConfiguration(channel, { ...body, password: 'not-an-allowed-field' }), /Unsupported/);
  }
  for (const endpoint of ['http://example.test', 'https://user:secret@example.test', 'https://example.test?credential=secret', 'https://example.test#secret']) {
    assert.throws(() => validateConfiguration('sms', { ...fixtures[3][1], endpoint }), (e) => !e.message.includes('credential=secret'));
  }
  assert.throws(() => validateConfiguration('email', { ...smtp, secret: 'x'.repeat(4097) }), /4096/);
  assert.throws(() => configurationFields('sms', 'smtp'), /valid/);
});

test('response projection never accepts returned credentials or corrupt default state', () => {
  const valid = saved();
  assert.equal(snapshotFromResponse(valid).record.channels.email.configurations[0].name, smtp.name);
  valid.channels.email.configurations[0].secret = 'synthetic-secret';
  assert.throws(() => snapshotFromResponse(valid), /invalid response/);
  const invalid = saved();
  invalid.channels.email.defaultId = id2;
  assert.throws(() => snapshotFromResponse(invalid), /invalid response/);
});

test('authenticated CRUD uses only application API, preserves legacy storage, carries versions and never retries uncertain writes', async () => {
  const oldFetch = globalThis.fetch;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_, fn) => fn() } } });
  const oldWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem() { assert.fail('legacy storage must not be read'); }, setItem() { assert.fail('legacy storage must not be changed'); }, removeItem() { assert.fail('legacy storage must not be deleted'); } } };
  let mode = '', responseData = saved();
  const calls = [];
  const admin = { id: 'synthetic-admin', email: 'admin@example.test', identity_kind: 'super_admin', system_role: 'super_admin', permissions: ['admin.access'] };
  globalThis.fetch = async (url, options) => {
    if (url.startsWith('/api/v1/auth')) return new Response(url.endsWith('/logout') ? null : JSON.stringify(url.endsWith('/me') ? admin : { access_token: 'synthetic-token', expires_in: 900 }), { status: url.endsWith('/logout') ? 204 : 200 });
    calls.push({ url, options });
    assert.ok(url.startsWith('/api/v1/admin/communication'), 'no provider requests');
    if (mode === 'network') throw new Error('synthetic-secret-must-not-echo');
    if (mode === 'invalid') return new Response('broken-json');
    if (mode === 'stale') return new Response(JSON.stringify({ error: { code: 'communication_stale', message: 'synthetic-secret-must-not-echo' } }), { status: 409 });
    if (mode === 'forbidden') return new Response(JSON.stringify({ error: { message: 'synthetic-secret-must-not-echo' } }), { status: 403 });
    return new Response(JSON.stringify(responseData));
  };
  try {
    await loginAdmin(admin.email, 'synthetic-password', false);
    let snapshot = await loadCommunicationSnapshot();
    assert.equal(snapshot.record.channels.email.defaultId, id);
    await saveConfiguration(snapshot, 'email', { ...smtp, secret: 'synthetic-replacement' }, id, 1);
    let sent = JSON.parse(calls.at(-1).options.body);
    assert.equal(sent.secret, 'synthetic-replacement');
    assert.deepEqual(sent.values, Object.fromEntries(Object.entries(smtp).filter(([key]) => key !== 'type')));
    assert.equal(sent.version, 1); assert.equal(sent.channelVersion, 2);
    await saveConfiguration(snapshot, 'email', smtp, id, 1);
    assert.equal('secret' in JSON.parse(calls.at(-1).options.body), false);
    await chooseCommunicationDefault(snapshot, 'email', id);
    assert.ok(calls.at(-1).url.endsWith('/default'));
    await deleteConfiguration(snapshot, 'email', id, id2);
    assert.equal(JSON.parse(calls.at(-1).options.body).replacementId, id2);
    for (const [channel, fixture] of fixtures) {
      await saveConfiguration(snapshot, channel, { ...fixture, secret: 'synthetic-secret' });
      assert.equal(JSON.parse(calls.at(-1).options.body).channel, channel);
    }
    for (mode of ['network', 'invalid', 'stale', 'forbidden']) {
      const count = calls.length;
      await assert.rejects(saveConfiguration(snapshot, 'email', { ...smtp, secret: 'synthetic-secret' }, id), (error) => {
        assert.equal(error.message.includes('synthetic-secret'), false);
        if (mode === 'network' || mode === 'invalid') assert.equal(error.ambiguous, true);
        return true;
      });
      assert.equal(calls.length, count + 1, 'no automatic mutation replay');
    }
    mode = '';
    await assert.rejects(communicationRequest('/unsupported', {}), /Unsupported/);
    await logoutAdmin();
    await assert.rejects(loadCommunicationSnapshot(), /session changed/);
  } finally {
    await logoutAdmin();
    globalThis.fetch = oldFetch;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
});
