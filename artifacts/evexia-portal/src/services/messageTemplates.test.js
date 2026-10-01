import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, MESSAGE_TEMPLATES_KEY, SYSTEM_TEMPLATES, deleteMessageTemplate,
  loadMessageTemplates, saveMessageTemplate, validateMessageTemplate,
} from './messageTemplates.js';

function makeStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function serializedLocks() {
  let tail = Promise.resolve();
  return {
    request(_name, _options, operation) {
      const result = tail.then(operation, operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

const email = (overrides = {}) => ({
  channel: 'email',
  name: 'Order email',
  description: 'Order updates',
  content: {
    subject: 'Order {{order_number}}',
    html: '<p>Hello {{recipient_name}}</p>',
    text: 'Hello {{recipient_name}}',
  },
  ...overrides,
});
const sms = (overrides = {}) => ({
  channel: 'sms',
  name: 'Order SMS',
  description: '',
  content: { body: 'Order {{order_number}}', providerTemplateId: '00123' },
  ...overrides,
});

test.beforeEach(() => {
  globalThis.window = { localStorage: makeStorage() };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks: serializedLocks() },
  });
});

test('exports bounded limits and four deeply immutable stable email/SMS starter examples', () => {
  assert.equal(MESSAGE_TEMPLATES_KEY, 'evexia.admin.message-templates.v1');
  assert.deepEqual(LIMITS, {
    name: 100, description: 500, subject: 200, html: 100000, text: 20000,
    body: 2000, providerTemplateId: 160, fileBytes: 100000, records: 100,
  });
  assert.equal(SYSTEM_TEMPLATES.length, 4);
  assert.deepEqual(SYSTEM_TEMPLATES.map(({ id, channel }) => [id, channel]), [
    ['system-email-order-confirmation', 'email'],
    ['system-email-payment-receipt', 'email'],
    ['system-sms-order-confirmation', 'sms'],
    ['system-sms-payment-receipt', 'sms'],
  ]);
  for (const template of SYSTEM_TEMPLATES) {
    assert.equal(template.source, 'system');
    assert.ok(Object.isFrozen(template));
    assert.ok(Object.isFrozen(template.content));
    assert.match(template.name, /example/i);
  }
  for (const template of SYSTEM_TEMPLATES.filter(({ channel }) => channel === 'sms')) {
    assert.equal(template.content.providerTemplateId, '');
  }
  assert.throws(() => { SYSTEM_TEMPLATES[0].content.subject = 'overwritten'; }, TypeError);
});

test('validates and normalizes user content, preserves template IDs as strings, and projects out IDs', () => {
  assert.deepEqual(validateMessageTemplate(email({
    name: '  Order email  ', description: '  Order updates  ', id: 'untrusted-id', source: 'system',
  })), {
    source: 'user',
    channel: 'email',
    name: 'Order email',
    description: 'Order updates',
    content: {
      subject: 'Order {{order_number}}',
      html: '<p>Hello {{recipient_name}}</p>',
      text: 'Hello {{recipient_name}}',
    },
  });
  assert.equal(validateMessageTemplate(sms()).content.providerTemplateId, '00123');
  assert.deepEqual(validateMessageTemplate(email({ description: undefined })).description, '');
  assert.throws(() => validateMessageTemplate({ ...email(), channel: 'waba' }), /Email or SMS/);
  assert.throws(() => validateMessageTemplate(null), /message template/);
});

test('enforces required fields, per-field limits and control-character rules', () => {
  assert.throws(() => validateMessageTemplate(email({ name: ' ' })), /name is required/);
  assert.throws(() => validateMessageTemplate(email({ description: 'x'.repeat(501) })), /Description must be/);
  assert.throws(() => validateMessageTemplate(email({ content: { ...email().content, subject: '' } })), /subject is required/);
  assert.throws(() => validateMessageTemplate(email({ content: { ...email().content, subject: 's'.repeat(201) } })), /subject must be/);
  assert.throws(() => validateMessageTemplate(email({ content: { ...email().content, html: '' } })), /HTML is required/);
  assert.throws(() => validateMessageTemplate(email({ content: { ...email().content, html: 'h'.repeat(100001) } })), /HTML must be/);
  assert.throws(() => validateMessageTemplate(email({ content: { ...email().content, text: '' } })), /plain-text alternative is required/);
  assert.throws(() => validateMessageTemplate(email({ content: { ...email().content, text: 't'.repeat(20001) } })), /plain-text alternative must be/);
  assert.throws(() => validateMessageTemplate(sms({ content: { ...sms().content, body: ' ' } })), /message body is required/);
  assert.throws(() => validateMessageTemplate(sms({ content: { ...sms().content, body: 'b'.repeat(2001) } })), /message body must be/);
  assert.throws(() => validateMessageTemplate(sms({ content: { ...sms().content, providerTemplateId: '' } })), /template ID is required/);
  assert.throws(() => validateMessageTemplate(sms({ content: { ...sms().content, providerTemplateId: 'i'.repeat(161) } })), /template ID must be/);
  assert.throws(() => validateMessageTemplate(email({ name: 'Bad\u0000name' })), /control characters/);
  assert.throws(() => validateMessageTemplate(sms({
    content: { ...sms().content, body: 'Bad\u0007body' },
  })), /control characters/);
  assert.throws(() => validateMessageTemplate(sms({
    content: { ...sms().content, providerTemplateId: 'bad\nid' },
  })), /control characters/);
  assert.equal(validateMessageTemplate(sms({
    content: { ...sms().content, body: 'Line one\nLine two' },
  })).content.body, 'Line one\nLine two');
});

test('attaches field-specific errors using the names consumed by the editor', () => {
  const cases = [
    [email({ name: '' }), 'name'],
    [email({ description: 'd'.repeat(501) }), 'description'],
    [email({ content: { ...email().content, subject: '' } }), 'subject'],
    [email({ content: { ...email().content, html: '' } }), 'html'],
    [email({ content: { ...email().content, text: '' } }), 'text'],
    [sms({ content: { ...sms().content, body: '' } }), 'body'],
    [sms({ content: { ...sms().content, providerTemplateId: '' } }), 'providerTemplateId'],
  ];
  for (const [input, field] of cases) {
    assert.throws(() => validateMessageTemplate(input), (error) => {
      assert.equal(error.fields?.[field], error.message);
      assert.deepEqual(Object.keys(error.fields), [field]);
      return true;
    });
  }
});

test('creates, reloads, edits in place and deletes user templates without changing stable identity', async () => {
  const initial = loadMessageTemplates();
  assert.deepEqual(initial, { raw: null, record: { version: 1, revision: 'empty', templates: [] } });

  let snapshot = await saveMessageTemplate(initial, email());
  const created = snapshot.record.templates[0];
  assert.match(created.id, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/);
  assert.equal(created.source, 'user');
  assert.equal(created.channel, 'email');
  assert.equal(snapshot.record.version, 1);
  assert.notEqual(snapshot.record.revision, 'empty');
  assert.equal(window.localStorage.getItem(MESSAGE_TEMPLATES_KEY), snapshot.raw);

  snapshot = await saveMessageTemplate(snapshot, sms());
  assert.equal(snapshot.record.templates.length, 2);
  assert.equal(snapshot.record.templates[1].content.providerTemplateId, '00123');
  assert.deepEqual(loadMessageTemplates(), snapshot);

  const previousRevision = snapshot.record.revision;
  snapshot = await saveMessageTemplate(snapshot, email({
    name: 'Revised order email',
    content: { ...email().content, subject: 'Updated' },
  }), created.id);
  assert.equal(snapshot.record.templates.length, 2);
  assert.equal(snapshot.record.templates[0].id, created.id);
  assert.equal(snapshot.record.templates[0].name, 'Revised order email');
  assert.equal(snapshot.record.templates[0].content.subject, 'Updated');
  assert.notEqual(snapshot.record.revision, previousRevision);

  const smsId = snapshot.record.templates[1].id;
  snapshot = await deleteMessageTemplate(snapshot, created.id);
  assert.deepEqual(snapshot.record.templates.map(({ id }) => id), [smsId]);
  assert.deepEqual(loadMessageTemplates(), snapshot);
  await assert.rejects(deleteMessageTemplate(snapshot, created.id), /no longer exists/);
});

test('enforces case-insensitive unique names per channel and protects system templates', async () => {
  let snapshot = await saveMessageTemplate(loadMessageTemplates(), email());
  snapshot = await saveMessageTemplate(snapshot, sms({ name: 'Order email' }));
  await assert.rejects(saveMessageTemplate(snapshot, email({ name: 'oRdEr EmAiL' })), /unique template name/);
  await assert.rejects(saveMessageTemplate(snapshot, email(), SYSTEM_TEMPLATES[0].id), /System templates cannot be overwritten/);
  await assert.rejects(deleteMessageTemplate(snapshot, SYSTEM_TEMPLATES[2].id), /System templates cannot be deleted/);
  assert.equal(snapshot.record.templates.length, 2);
  assert.equal(window.localStorage.getItem(MESSAGE_TEMPLATES_KEY), snapshot.raw);
});

test('enforces the user-record limit', async () => {
  let snapshot = loadMessageTemplates();
  for (let index = 0; index < LIMITS.records; index += 1) {
    snapshot = await saveMessageTemplate(snapshot, email({ name: `Template ${index}` }));
  }
  assert.equal(snapshot.record.templates.length, LIMITS.records);
  await assert.rejects(
    saveMessageTemplate(snapshot, email({ name: 'One too many' })),
    /up to 100 user templates/,
  );
});

test('loads without writing and rejects malformed, unsupported, oversized or noncanonical stored records', async () => {
  const storage = window.localStorage;
  const malformed = ['{broken json', 'null', JSON.stringify({ version: 2, revision: 'x', templates: [] })];
  const good = await saveMessageTemplate(loadMessageTemplates(), email());
  const valid = JSON.parse(good.raw);
  const unknownField = structuredClone(valid);
  unknownField.templates[0].extra = 'unexpected';
  const duplicateName = structuredClone(valid);
  duplicateName.templates.push({
    ...duplicateName.templates[0],
    id: 'separate-id',
    name: duplicateName.templates[0].name.toUpperCase(),
  });
  const wrongSource = structuredClone(valid);
  wrongSource.templates[0].source = 'system';
  const badSmsId = structuredClone(valid);
  badSmsId.templates[0].id = SYSTEM_TEMPLATES[0].id;
  const records = [...malformed, JSON.stringify(unknownField), JSON.stringify(duplicateName), JSON.stringify(wrongSource), JSON.stringify(badSmsId)];

  for (const raw of records) {
    storage.setItem(MESSAGE_TEMPLATES_KEY, raw);
    const before = storage.getItem(MESSAGE_TEMPLATES_KEY);
    assert.throws(() => loadMessageTemplates(), /unreadable|invalid/);
    assert.equal(storage.getItem(MESSAGE_TEMPLATES_KEY), before, 'load must not replace corrupt data');
  }
  storage.setItem(MESSAGE_TEMPLATES_KEY, 'x'.repeat(25_000_000));
  const oversized = storage.getItem(MESSAGE_TEMPLATES_KEY);
  assert.throws(() => loadMessageTemplates(), /invalid/);
  assert.equal(storage.getItem(MESSAGE_TEMPLATES_KEY), oversized);
});

test('reports failed storage reads and writes without replacing existing saved bytes', async () => {
  window.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { assert.fail('must not write'); } };
  assert.throws(() => loadMessageTemplates(), /could not be read/);
  await assert.rejects(saveMessageTemplate({ raw: null }, email()), /could not be read/);

  window.localStorage = makeStorage();
  const snapshot = loadMessageTemplates();
  window.localStorage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(saveMessageTemplate(snapshot, email()), /could not be saved/);
  assert.equal(window.localStorage.getItem(MESSAGE_TEMPLATES_KEY), null);
});

test('rejects stale snapshots and fails explicitly when Web Locks are unavailable', async () => {
  const stale = loadMessageTemplates();
  const latest = await saveMessageTemplate(stale, email());
  await assert.rejects(saveMessageTemplate(stale, sms()), /changed in another tab/);
  await assert.rejects(deleteMessageTemplate(stale, latest.record.templates[0].id), /changed in another tab/);
  assert.equal(loadMessageTemplates().raw, latest.raw);

  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  await assert.rejects(saveMessageTemplate(latest, sms()), /requires browser Web Locks/);
  await assert.rejects(deleteMessageTemplate(latest, latest.record.templates[0].id), /requires browser Web Locks/);
  assert.equal(loadMessageTemplates().raw, latest.raw);
});

test('serializes concurrent cross-tab saves and prevents the loser from overwriting the winner', async () => {
  const snapshotA = loadMessageTemplates();
  const snapshotB = loadMessageTemplates();
  const results = await Promise.allSettled([
    saveMessageTemplate(snapshotA, email()),
    saveMessageTemplate(snapshotB, sms()),
  ]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  const rejected = results.find(({ status }) => status === 'rejected');
  assert.match(rejected.reason.message, /changed in another tab/);
  assert.equal(loadMessageTemplates().record.templates.length, 1);
});