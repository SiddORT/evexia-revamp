import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNELS, COMMUNICATION_KEY, chooseCommunicationDefault, configurationFields,
  deleteConfiguration, loadCommunicationSnapshot, resetCommunication, saveConfiguration,
  validateConfiguration,
} from './communicationSettings.js';

function makeStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

const smtp = (overrides = {}) => ({
  type: 'smtp', name: 'Primary SMTP', host: 'mail.example.com', port: '587',
  security: 'starttls', username: 'mailer', fromName: 'Example', fromEmail: 'mail@example.com',
  ...overrides,
});
const emailApi = (overrides = {}) => ({
  type: 'api', name: 'Cloud Mail', provider: 'Example Mail', endpoint: 'https://mail.example.com/v1/send',
  fromName: 'Example', fromEmail: 'mail@example.com', ...overrides,
});
const platform = (overrides = {}) => ({
  type: 'platform', name: 'Platform Preview', provider: 'Unconnected Platform', endpoint: 'https://platform.example.com/send',
  fromName: 'Example', fromEmail: 'mail@example.com', ...overrides,
});
const sms = (overrides = {}) => ({
  type: 'api', name: 'SMS Primary', provider: 'Example SMS', senderId: 'EVEXIA',
  endpoint: 'https://sms.example.com/v1/messages', dltEntityId: '', dltTemplateId: '', ...overrides,
});
const waba = (overrides = {}) => ({
  type: 'api', name: 'WhatsApp Primary', provider: 'Example WABA', endpoint: 'https://graph.example.com/v23.0',
  businessAccountId: 'business-123', phoneNumberId: 'phone-456', senderPhone: '+91 98765 43210',
  apiVersion: 'v23.0', ...overrides,
});

test.beforeEach(() => {
  globalThis.window = { localStorage: makeStorage() };
});

test('exports the three channels and exact schemas for SMTP, API/platform email, SMS and WABA', () => {
  assert.deepEqual(CHANNELS, ['email', 'sms', 'waba']);
  assert.deepEqual(configurationFields('email', 'smtp'),
    ['name', 'host', 'port', 'security', 'username', 'fromName', 'fromEmail']);
  assert.deepEqual(configurationFields('email', 'api'),
    ['name', 'provider', 'endpoint', 'fromName', 'fromEmail']);
  assert.deepEqual(configurationFields('email', 'platform'),
    ['name', 'provider', 'endpoint', 'fromName', 'fromEmail']);
  assert.deepEqual(configurationFields('sms', 'api'),
    ['name', 'provider', 'senderId', 'endpoint', 'dltEntityId', 'dltTemplateId']);
  assert.deepEqual(configurationFields('waba', 'api'),
    ['name', 'provider', 'endpoint', 'businessAccountId', 'phoneNumberId', 'senderPhone', 'apiVersion']);

  assert.deepEqual(validateConfiguration('email', smtp()), { ...smtp(), type: 'smtp' });
  assert.deepEqual(validateConfiguration('email', emailApi()), emailApi());
  assert.deepEqual(validateConfiguration('email', platform()), platform());
  assert.deepEqual(validateConfiguration('sms', sms()), sms());
  assert.deepEqual(validateConfiguration('waba', waba()), waba());
  assert.throws(() => configurationFields('voice', 'api'), /Email, SMS or WABA/);
  assert.throws(() => configurationFields('email', 'smtp-api'), /Email configuration type/);
  assert.throws(() => configurationFields('sms', 'smtp'), /API configuration type/);
});

test('requires all non-optional fields and accepts omitted/blank optional provider metadata', () => {
  const schemas = [
    ['email', 'smtp', smtp()],
    ['email', 'api', emailApi()],
    ['email', 'platform', platform()],
    ['sms', 'api', sms()],
    ['waba', 'api', waba()],
  ];
  for (const [channel, type, config] of schemas) {
    for (const field of configurationFields(channel, type)) {
      if (['dltEntityId', 'dltTemplateId', 'apiVersion'].includes(field)) continue;
      const missing = { ...config };
      delete missing[field];
      assert.throws(() => validateConfiguration(channel, missing), /required/, `${channel}/${type} requires ${field}`);
    }
  }
  assert.equal(validateConfiguration('sms', sms({ dltEntityId: undefined, dltTemplateId: '' })).dltEntityId, '');
  assert.equal(validateConfiguration('waba', waba({ apiVersion: undefined })).apiVersion, '');
  assert.throws(() => validateConfiguration('email', smtp({ name: '   ' })), /required/);
  assert.throws(() => validateConfiguration('sms', sms({ dltEntityId: 17 })), /must be text/);
  assert.throws(() => validateConfiguration('email', emailApi({ provider: 4 })), /must be text/);
  assert.throws(() => validateConfiguration('email', { ...emailApi(), type: 'bogus' }), /Email configuration type/);
  assert.throws(() => validateConfiguration('waba', { ...waba(), type: 'smtp' }), /API configuration type/);

  const normalized = validateConfiguration('sms', sms({ name: '  Text Provider  ', provider: ' Example ', senderId: ' ABC ' }));
  assert.equal(normalized.name, 'Text Provider');
  assert.equal(normalized.provider, 'Example');
  assert.equal(normalized.senderId, 'ABC');
});

test('validates SMTP hosts, ports and security choices', () => {
  for (const host of ['localhost', 'smtp.example.com', '192.168.1.1', 'MAIL.Example.COM']) {
    assert.equal(validateConfiguration('email', smtp({ host })).host, host);
  }
  for (const host of ['https://mail.example.com', 'mail.example.com/path', 'user@mail.example.com', '256.1.1.1', 'mail example.com', '-bad.example']) {
    assert.throws(() => validateConfiguration('email', smtp({ host })), /SMTP host|valid SMTP host/);
  }
  for (const port of ['1', '25', '65535']) assert.equal(validateConfiguration('email', smtp({ port })).port, port);
  for (const port of ['0', '65536', '-1', '587.5', 'abc', '123456']) {
    assert.throws(() => validateConfiguration('email', smtp({ port })), /SMTP port/);
  }
  assert.throws(() => validateConfiguration('email', smtp({ port: 587 })), /must be text/);
  for (const security of ['starttls', 'tls', 'none']) assert.equal(validateConfiguration('email', smtp({ security })).security, security);
  assert.throws(() => validateConfiguration('email', smtp({ security: 'ssl' })), /Choose STARTTLS/);
});

test('validates sender email syntax, bounded text and control characters', () => {
  for (const fromEmail of ['person@example.com', 'one.two+tag@sub.example.org']) {
    assert.equal(validateConfiguration('email', emailApi({ fromEmail })).fromEmail, fromEmail);
  }
  for (const fromEmail of ['plain-address', 'missing@domain', '@example.com', 'person @example.com', 'person@domain.']) {
    assert.throws(() => validateConfiguration('email', emailApi({ fromEmail })), /valid sender\/from email/);
  }
  assert.throws(() => validateConfiguration('email', smtp({ username: 'x'.repeat(161) })), /too long/);
  assert.throws(() => validateConfiguration('sms', sms({ senderId: 'A\u0000B' })), /unsupported characters/);
  assert.throws(() => validateConfiguration('email', emailApi({ name: 12 })), /must be text/);
});

test('accepts only absolute HTTPS endpoints without credentials, queries, fragments or unsafe syntax', () => {
  for (const endpoint of ['https://api.example.com', 'https://api.example.com/v2/messages']) {
    assert.equal(validateConfiguration('sms', sms({ endpoint })).endpoint, endpoint);
  }
  const rejected = [
    'https://user:password@api.example.com/v1',
    'https://api.example.com/v1?token=unique-query-canary',
    'https://api.example.com/v1#unique-fragment-canary',
    'http://api.example.com/v1',
    'ftp://api.example.com/v1',
    'javascript:alert(1)',
    '/relative/path',
    'https://api.example.com/path with-space',
    'https://api.example.com\\private',
  ];
  for (const endpoint of rejected) {
    assert.throws(() => validateConfiguration('sms', sms({ endpoint })), (error) => {
      assert.match(error.message, /endpoint|HTTPS/);
      assert.equal(error.message.includes(endpoint), false, 'validation errors must not echo endpoint input');
      assert.equal(error.message.includes('unique-query-canary'), false);
      assert.equal(error.message.includes('unique-fragment-canary'), false);
      return true;
    });
  }
  assert.throws(() => validateConfiguration('email', emailApi({ endpoint: 17 })), /must be text/);
});

test('validates WABA phone numbers and optional API version', () => {
  for (const senderPhone of ['+1 555-010-1234', '(555) 010 1234', '555-0101']) {
    assert.equal(validateConfiguration('waba', waba({ senderPhone })).senderPhone, senderPhone);
  }
  for (const senderPhone of ['abcde', '1234', '+1-555-010-1234 ext 7', '555.010.1234']) {
    assert.throws(() => validateConfiguration('waba', waba({ senderPhone })), /sender\/display phone/);
  }
  for (const apiVersion of ['v23.0', '23', '1.2']) {
    assert.equal(validateConfiguration('waba', waba({ apiVersion })).apiVersion, apiVersion);
  }
  assert.throws(() => validateConfiguration('waba', waba({ apiVersion: 'v23-beta' })), /Optional API version/);
});

test('saves all channel schemas, assigns first defaults, and reloads only metadata', () => {
  let snapshot = loadCommunicationSnapshot();
  assert.equal(snapshot.raw, null);
  for (const [channel, config] of [
    ['email', smtp()], ['email', emailApi()], ['email', platform()], ['sms', sms()], ['waba', waba()],
  ]) {
    snapshot = saveConfiguration(snapshot, channel, config);
  }
  const persisted = loadCommunicationSnapshot();
  assert.equal(persisted.record.version, 1);
  assert.ok(persisted.record.revision);
  for (const channel of CHANNELS) {
    const state = persisted.record.channels[channel];
    assert.equal(state.configurations.length, channel === 'email' ? 3 : 1);
    assert.equal(state.defaultId, state.configurations[0].id);
  }
  assert.deepEqual(loadCommunicationSnapshot().record, persisted.record);
  assert.equal(window.localStorage.getItem(COMMUNICATION_KEY), persisted.raw);
  for (const state of Object.values(persisted.record.channels)) {
    for (const config of state.configurations) {
      assert.ok(config.id);
      assert.equal(Object.hasOwn(config, 'password'), false);
      assert.equal(Object.hasOwn(config, 'apiKey'), false);
    }
  }
});

test('allows multiple providers but rejects case-insensitive duplicate names within a channel', () => {
  let snapshot = saveConfiguration(loadCommunicationSnapshot(), 'sms', sms());
  snapshot = saveConfiguration(snapshot, 'sms', sms({ name: 'Another SMS', provider: 'Different SMS' }));
  assert.equal(snapshot.record.channels.sms.configurations.length, 2);
  const raw = snapshot.raw;
  assert.throws(() => saveConfiguration(snapshot, 'sms', sms({ name: 'sMs PrImArY' })), /unique configuration name/);
  assert.equal(window.localStorage.getItem(COMMUNICATION_KEY), raw);
  snapshot = saveConfiguration(snapshot, 'email', smtp());
  assert.throws(() => saveConfiguration(snapshot, 'email', emailApi({ name: 'primary smtp' })), /unique configuration name/);
});

test('Email has one default across SMTP, API and platform configurations; choosing another is atomic', () => {
  let snapshot = loadCommunicationSnapshot();
  snapshot = saveConfiguration(snapshot, 'email', smtp());
  const smtpId = snapshot.record.channels.email.defaultId;
  snapshot = saveConfiguration(snapshot, 'email', emailApi());
  const apiId = snapshot.record.channels.email.configurations[1].id;
  assert.equal(snapshot.record.channels.email.defaultId, smtpId);
  snapshot = chooseCommunicationDefault(snapshot, 'email', apiId);
  assert.equal(snapshot.record.channels.email.defaultId, apiId);
  snapshot = saveConfiguration(snapshot, 'email', platform());
  const platformId = snapshot.record.channels.email.configurations[2].id;
  assert.equal(snapshot.record.channels.email.defaultId, apiId);
  snapshot = chooseCommunicationDefault(snapshot, 'email', platformId);
  assert.equal(snapshot.record.channels.email.defaultId, platformId);
  assert.equal(snapshot.record.channels.email.configurations.filter(({ id }) => id === snapshot.record.channels.email.defaultId).length, 1);
  assert.throws(() => chooseCommunicationDefault(snapshot, 'email', 'not-an-id'), /existing configuration/);
});

test('edits a saved configuration in place without changing its identity or unrelated defaults', () => {
  let snapshot = saveConfiguration(loadCommunicationSnapshot(), 'email', smtp());
  snapshot = saveConfiguration(snapshot, 'email', emailApi());
  snapshot = saveConfiguration(snapshot, 'sms', sms());
  const emailState = snapshot.record.channels.email;
  const original = emailState.configurations[0];
  const emailDefault = emailState.defaultId;
  const smsDefault = snapshot.record.channels.sms.defaultId;
  snapshot = saveConfiguration(snapshot, 'email', smtp({ name: 'Edited SMTP', host: 'smtp.new.example.com' }), original.id);
  assert.equal(snapshot.record.channels.email.configurations.length, 2);
  assert.equal(snapshot.record.channels.email.configurations[0].id, original.id);
  assert.equal(snapshot.record.channels.email.configurations[0].name, 'Edited SMTP');
  assert.equal(snapshot.record.channels.email.defaultId, emailDefault);
  assert.equal(snapshot.record.channels.sms.defaultId, smsDefault);
  assert.throws(() => saveConfiguration(snapshot, 'email', smtp(), 'missing-id'), /no longer exists/);
  assert.throws(() => saveConfiguration(snapshot, 'email', smtp({ name: 'Cloud Mail' }), original.id), /unique configuration name/);
});

test('deleting a default requires an explicit replacement; deletion can leave an empty channel', () => {
  let snapshot = saveConfiguration(loadCommunicationSnapshot(), 'email', smtp());
  snapshot = saveConfiguration(snapshot, 'email', emailApi());
  const [first, second] = snapshot.record.channels.email.configurations;
  const unchanged = snapshot.raw;
  assert.throws(() => deleteConfiguration(snapshot, 'email', first.id), /replacement default/);
  assert.throws(() => deleteConfiguration(snapshot, 'email', first.id, 'not-a-config'), /replacement default/);
  assert.equal(window.localStorage.getItem(COMMUNICATION_KEY), unchanged);
  snapshot = deleteConfiguration(snapshot, 'email', first.id, second.id);
  assert.equal(snapshot.record.channels.email.defaultId, second.id);
  assert.deepEqual(snapshot.record.channels.email.configurations.map(({ id }) => id), [second.id]);
  snapshot = deleteConfiguration(snapshot, 'email', second.id);
  assert.deepEqual(snapshot.record.channels.email.configurations, []);
  assert.equal(snapshot.record.channels.email.defaultId, null);
  assert.throws(() => deleteConfiguration(snapshot, 'email', second.id), /no longer exists/);
});

test('projects unknown input properties out and never stores credential canaries', () => {
  const canary = 'DUMMY-SECRET-CANARY-90817';
  const input = emailApi({
    apiKey: canary, accessToken: canary, password: canary, arbitraryCredentialField: canary,
    unknownMetadata: canary,
  });
  const snapshot = saveConfiguration(loadCommunicationSnapshot(), 'email', input);
  const saved = snapshot.record.channels.email.configurations[0];
  assert.deepEqual(Object.keys(saved).sort(), ['endpoint', 'fromEmail', 'fromName', 'id', 'name', 'provider', 'type'].sort());
  assert.equal(snapshot.raw.includes(canary), false);
  assert.equal(JSON.stringify(snapshot.record).includes(canary), false);
  assert.equal(Object.hasOwn(saved, 'apiKey'), false);
  assert.equal(Object.hasOwn(saved, 'accessToken'), false);
  assert.equal(Object.hasOwn(saved, 'password'), false);
});

test('rejects malformed saved JSON and every strict-record shape without replacing stored bytes', () => {
  let snapshot = saveConfiguration(loadCommunicationSnapshot(), 'email', emailApi());
  snapshot = saveConfiguration(snapshot, 'sms', sms());
  const valid = JSON.parse(snapshot.raw);
  const invalid = [];
  invalid.push(null, [], 'not-a-record');
  invalid.push({ ...valid, extra: true });
  invalid.push(Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'version')));
  invalid.push(Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'revision')));
  invalid.push(Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'channels')));
  invalid.push({ ...valid, version: 2 });
  invalid.push({ ...valid, revision: '' });
  invalid.push({ ...valid, revision: 'has spaces' });
  invalid.push({ ...valid, channels: { ...valid.channels, voice: { configurations: [], defaultId: null } } });
  invalid.push({ ...valid, channels: { email: valid.channels.email, sms: valid.channels.sms } });

  const stateExtra = structuredClone(valid);
  stateExtra.channels.email.extra = true;
  invalid.push(stateExtra);
  const stateMissing = structuredClone(valid);
  delete stateMissing.channels.sms.defaultId;
  invalid.push(stateMissing);
  const stateMissingConfigurations = structuredClone(valid);
  delete stateMissingConfigurations.channels.waba.configurations;
  invalid.push(stateMissingConfigurations);
  const stateWrongShape = structuredClone(valid);
  stateWrongShape.channels.waba = [];
  invalid.push(stateWrongShape);
  const configsNotArray = structuredClone(valid);
  configsNotArray.channels.email.configurations = {};
  invalid.push(configsNotArray);
  const tooMany = structuredClone(valid);
  tooMany.channels.email.configurations = Array(101).fill(tooMany.channels.email.configurations[0]);
  invalid.push(tooMany);
  const invalidDefault = structuredClone(valid);
  invalidDefault.channels.email.defaultId = 'missing';
  invalid.push(invalidDefault);
  const emptyWithDefault = structuredClone(valid);
  emptyWithDefault.channels.waba.defaultId = 'missing';
  invalid.push(emptyWithDefault);

  const missingConfigField = structuredClone(valid);
  delete missingConfigField.channels.email.configurations[0].provider;
  invalid.push(missingConfigField);
  const missingConfigId = structuredClone(valid);
  delete missingConfigId.channels.email.configurations[0].id;
  invalid.push(missingConfigId);
  const missingConfigType = structuredClone(valid);
  delete missingConfigType.channels.email.configurations[0].type;
  invalid.push(missingConfigType);
  const unknownConfigKey = structuredClone(valid);
  unknownConfigKey.channels.email.configurations[0].arbitrary = 'unexpected';
  invalid.push(unknownConfigKey);
  for (const credentialField of ['password', 'apiKey', 'accessToken', 'token']) {
    const credentialConfig = structuredClone(valid);
    credentialConfig.channels.email.configurations[0][credentialField] = 'SAVED-CREDENTIAL-CANARY';
    invalid.push(credentialConfig);
  }
  const badConfigId = structuredClone(valid);
  badConfigId.channels.email.configurations[0].id = 'has spaces';
  invalid.push(badConfigId);
  const duplicateAcrossChannels = structuredClone(valid);
  duplicateAcrossChannels.channels.sms.configurations[0].id = duplicateAcrossChannels.channels.email.configurations[0].id;
  invalid.push(duplicateAcrossChannels);
  const duplicateName = structuredClone(valid);
  duplicateName.channels.email.configurations.push({
    ...duplicateName.channels.email.configurations[0],
    id: 'separate-id', name: duplicateName.channels.email.configurations[0].name.toUpperCase(),
  });
  invalid.push(duplicateName);
  const nonCanonicalValue = structuredClone(valid);
  nonCanonicalValue.channels.email.configurations[0].name = ` ${nonCanonicalValue.channels.email.configurations[0].name} `;
  invalid.push(nonCanonicalValue);
  const badType = structuredClone(valid);
  badType.channels.email.configurations[0].endpoint = 19;
  invalid.push(badType);
  const badEmailType = structuredClone(valid);
  badEmailType.channels.email.configurations[0].type = 'smtp';
  invalid.push(badEmailType);

  for (const record of invalid) {
    const raw = JSON.stringify(record);
    window.localStorage.setItem(COMMUNICATION_KEY, raw);
    assert.throws(() => loadCommunicationSnapshot(), /Saved Communication metadata is invalid/, raw);
    assert.equal(window.localStorage.getItem(COMMUNICATION_KEY), raw, 'load must never repair or replace malformed saved data');
  }

  window.localStorage.setItem(COMMUNICATION_KEY, '{broken json');
  assert.throws(() => loadCommunicationSnapshot(), /unreadable/);
  assert.equal(window.localStorage.getItem(COMMUNICATION_KEY), '{broken json');
  window.localStorage.setItem(COMMUNICATION_KEY, 'x'.repeat(400001));
  assert.throws(() => loadCommunicationSnapshot(), /invalid/);
  const corruptRaw = window.localStorage.getItem(COMMUNICATION_KEY);
  assert.throws(() => saveConfiguration({ raw: corruptRaw }, 'email', smtp()), /invalid/);
  assert.equal(window.localStorage.getItem(COMMUNICATION_KEY), corruptRaw);
});

test('storage reads fail explicitly and failed writes preserve the previous record', () => {
  window.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { assert.fail('must not write'); } };
  assert.throws(() => loadCommunicationSnapshot(), /could not be read/);
  assert.throws(() => saveConfiguration({ raw: null }, 'email', smtp()), /could not be read/);

  const attemptFailure = (prepare, operation) => {
    const localStorage = makeStorage();
    globalThis.window.localStorage = localStorage;
    const snapshot = prepare ? prepare() : loadCommunicationSnapshot();
    const before = localStorage.getItem(COMMUNICATION_KEY);
    localStorage.setItem = () => { throw new Error('quota'); };
    assert.throws(() => operation(snapshot), /could not be saved/);
    assert.equal(localStorage.getItem(COMMUNICATION_KEY), before);
  };
  attemptFailure(null, (snapshot) => saveConfiguration(snapshot, 'email', smtp()));
  attemptFailure((() => {
    let setup;
    return () => {
      setup = saveConfiguration(loadCommunicationSnapshot(), 'email', smtp());
      return saveConfiguration(setup, 'email', emailApi());
    };
  })(), (snapshot) => chooseCommunicationDefault(snapshot, 'email', snapshot.record.channels.email.configurations[1].id));
  attemptFailure(() => {
    let setup = saveConfiguration(loadCommunicationSnapshot(), 'email', smtp());
    return saveConfiguration(setup, 'email', emailApi());
  }, (snapshot) => deleteConfiguration(snapshot, 'email', snapshot.record.channels.email.configurations[1].id));
  attemptFailure(null, (snapshot) => resetCommunication(snapshot));
});

test('stale snapshots cannot write through save, default selection, deletion or reset', () => {
  const staleError = /changed in another tab/;

  let stale = loadCommunicationSnapshot();
  saveConfiguration(stale, 'email', smtp());
  assert.throws(() => saveConfiguration(stale, 'email', emailApi()), staleError);

  globalThis.window.localStorage = makeStorage();
  let current = loadCommunicationSnapshot();
  current = saveConfiguration(current, 'email', smtp());
  current = saveConfiguration(current, 'email', emailApi());
  stale = loadCommunicationSnapshot();
  saveConfiguration(stale, 'sms', sms());
  assert.throws(() => chooseCommunicationDefault(stale, 'email', current.record.channels.email.configurations[1].id), staleError);

  globalThis.window.localStorage = makeStorage();
  current = loadCommunicationSnapshot();
  stale = current;
  current = saveConfiguration(current, 'waba', waba());
  assert.throws(() => deleteConfiguration(stale, 'waba', current.record.channels.waba.configurations[0].id), staleError);

  globalThis.window.localStorage = makeStorage();
  stale = loadCommunicationSnapshot();
  saveConfiguration(stale, 'sms', sms());
  assert.throws(() => resetCommunication(stale), staleError);
});

test('revision changes detect an ABA return to identical channel contents', () => {
  let initial = resetCommunication(loadCommunicationSnapshot());
  const stale = initial;
  const initialChannels = structuredClone(initial.record.channels);
  let changed = saveConfiguration(initial, 'sms', sms());
  changed = deleteConfiguration(changed, 'sms', changed.record.channels.sms.configurations[0].id);
  assert.deepEqual(changed.record.channels, initialChannels);
  assert.notEqual(changed.record.revision, initial.record.revision);
  assert.notEqual(changed.raw, initial.raw);
  assert.throws(() => resetCommunication(stale), /changed in another tab/);
});

test('reset clears only Communication metadata and preserves all other storage keys', () => {
  let snapshot = saveConfiguration(loadCommunicationSnapshot(), 'email', smtp());
  window.localStorage.setItem('evexia.admin.basic.v1', '{"theme":"dark"}');
  window.localStorage.setItem('evexia.admin.master-records', 'master data');
  const unrelatedBefore = [...window.localStorage.values.entries()]
    .filter(([key]) => key !== COMMUNICATION_KEY);
  snapshot = resetCommunication(snapshot);
  assert.deepEqual(snapshot.record.channels, {
    email: { configurations: [], defaultId: null },
    sms: { configurations: [], defaultId: null },
    waba: { configurations: [], defaultId: null },
  });
  assert.equal(window.localStorage.getItem(COMMUNICATION_KEY), snapshot.raw);
  assert.deepEqual([...window.localStorage.values.entries()].filter(([key]) => key !== COMMUNICATION_KEY), unrelatedBefore);
});

test('metadata operations perform no outbound provider calls', () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; throw new Error('unexpected network call'); };
  try {
    let snapshot = loadCommunicationSnapshot();
    snapshot = saveConfiguration(snapshot, 'email', emailApi());
    snapshot = chooseCommunicationDefault(snapshot, 'email', snapshot.record.channels.email.defaultId);
    snapshot = deleteConfiguration(snapshot, 'email', snapshot.record.channels.email.defaultId);
    resetCommunication(snapshot);
    assert.equal(calls, 0);
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  }
});