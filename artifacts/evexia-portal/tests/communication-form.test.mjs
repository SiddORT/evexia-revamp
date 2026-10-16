// In-process form event tests. No browser/server or provider is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { transformSync } = createRequire(require.resolve('vite'))('esbuild');
import { configurationFields, CHANNELS } from '../src/services/communicationSettings.js';

function harness(props, { file = '../src/components/admin/CommunicationForm.jsx', imports = {} } = {}) {
  let cursor = 0;
  const states = [];
  const effects = [];
  const React = {
    createElement: (tag, attributes, ...children) => ({ tag, props: attributes || {}, children: children.flat(Infinity).filter(Boolean) }),
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], (v) => { states[index] = typeof v === 'function' ? v(states[index]) : v; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = { current: initial };
      return states[index];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = effects[index];
      if (!previous || deps.some((v, i) => v !== previous.deps[i])) {
        previous?.cleanup?.();
        effects[index] = { deps, cleanup: fn() };
      }
    },
  };
  const code = transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, React, AbortController, require: (name) => name === 'react' ? React : (imports[name] ?? { configurationFields, CHANNELS }) });
  const render = () => { cursor = 0; return module.exports.default(props); };
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined;
    if (predicate(node)) return node;
    return [...(node.children || []), node.props?.extra, node.props?.footer]
      .map((child) => find(child, predicate)).find(Boolean);
  };
  return {
    render, find,
    byId: (id) => find(render(), (n) => n.props?.['data-testid'] === id),
    unmount: () => effects.forEach((e) => e?.cleanup?.()),
  };
}

const configId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const configId2 = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
function sharedSnapshot(version = 1, configurations = []) {
  return { record: { channels: Object.fromEntries(CHANNELS.map((c) => [c, { version, defaultId: c === 'email' ? configurations[0]?.id || null : null, configurations: c === 'email' ? configurations : [] }])) } };
}
const record = { id: configId, type: 'smtp', version: 1, name: 'Synthetic saved name', host: 'smtp.example.test', port: '587', fromEmail: 'sender@example.test', credentialPresent: true };
function settingsHarness(service, identity = 'super_admin') {
  function Form() {}
  const h = harness({}, {
    file: '../src/components/admin/CommunicationSettings.jsx',
    imports: {
      './communicationSettings.css': {},
      './Dialog.jsx': function Dialog() {},
      './CommunicationForm.jsx': { __esModule: true, default: Form, CHANNEL_LABELS: { email: 'Email', sms: 'SMS', waba: 'WABA' }, TYPE_LABELS: { smtp: 'SMTP', api: 'API' } },
      '../../auth/AdminBoundary.jsx': { useAdminSession: () => ({ user: { id: 'synthetic-admin', identity_kind: identity } }) },
      '../../services/communicationSettings.js': { CHANNELS, ...service },
    },
  });
  h.form = () => h.find(h.render(), (node) => node.tag === Form);
  return h;
}

test('settings load shared records, keep stale/uncertain drafts mounted, require review, and submit the reviewed version', async () => {
  let latest = sharedSnapshot(2, [record]);
  let mode = 'stale', sent;
  const h = settingsHarness({
    loadCommunicationSnapshot: async () => latest,
    saveConfiguration: async (...args) => {
      sent = args;
      if (mode === 'stale') throw Object.assign(new Error('Changed; draft kept'), { status: 409 });
      if (mode === 'uncertain') throw Object.assign(new Error('Outcome uncertain'), { ambiguous: true });
      return latest;
    },
  });
  h.render(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.byId(`card-communication-${configId}`).props['data-testid'], `card-communication-${configId}`);
  h.byId(`button-edit-communication-${configId}`).props.onClick();
  const originalKey = h.form().props.key;
  await h.form().props.onSubmit({ type: 'smtp', name: 'Non-secret draft' });
  assert.equal(h.form().props.blocked, true);
  latest = sharedSnapshot(4, [{ ...record, name: 'Current server name', version: 3 }]);
  await h.form().props.recovery.run();
  assert.equal(h.form().props.key, originalKey, 'reload must not remount/discard the form draft');
  assert.equal(h.form().props.blocked, true, 'loading is not review');
  const review = h.find(h.render(), (node) => node.tag === 'button' && node.children.includes('I reviewed the saved settings; keep my draft'));
  review.props.onClick();
  assert.equal(h.form().props.blocked, false);
  mode = 'uncertain';
  await h.form().props.onSubmit({ type: 'smtp', name: 'Non-secret draft' });
  assert.equal(sent[4], 3, 'use explicitly reviewed record version');
  assert.equal(sent[0].record.channels.email.version, 4);
  assert.equal(h.form().props.blocked, true);
  await h.form().props.recovery.run();
  h.find(h.render(), (node) => node.tag === 'button' && node.children.includes('I reviewed the saved settings; keep my draft')).props.onClick();
  mode = 'ok';
  await h.form().props.onSubmit({ type: 'smtp', name: 'Non-secret draft' });
  assert.equal(h.form(), undefined, 'successful save closes the editor');
  h.unmount();
});

test('settings default/delete controls carry explicit replacement, recover load failures and restrict non-admins', async () => {
  let latest = sharedSnapshot(3, [record, { ...record, id: configId2, name: 'Second synthetic' }]);
  let loadFailure = true, removed, chosen;
  const h = settingsHarness({
    loadCommunicationSnapshot: async () => { if (loadFailure) throw new Error('Storage unavailable'); return latest; },
    chooseCommunicationDefault: async (...args) => { chosen = args; return latest; },
    deleteConfiguration: async (...args) => { removed = args; return sharedSnapshot(4); },
  });
  h.render(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.byId('button-add-communication').props.disabled, true);
  loadFailure = false;
  await h.byId('button-communication-reload').props.onClick();
  await h.byId(`button-default-communication-${configId2}`).props.onClick();
  assert.equal(chosen[2], configId2);
  h.byId(`button-delete-communication-${configId}`).props.onClick();
  await h.byId('button-confirm-delete-communication').props.onClick();
  assert.equal(removed, undefined, 'cannot delete a default without replacement and confirmation');
  h.find(h.render(), (node) => node.tag === 'input' && node.props.type === 'radio').props.onChange();
  h.find(h.render(), (node) => node.tag === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  await h.byId('button-confirm-delete-communication').props.onClick();
  assert.equal(removed[2], configId); assert.equal(removed[3], configId2);
  assert.equal(h.byId(`card-communication-${configId}`), undefined);
  h.unmount();
  let reads = 0;
  const restricted = settingsHarness({ loadCommunicationSnapshot: async () => { reads++; return latest; } }, 'staff');
  const tree = restricted.render();
  assert.equal(reads, 0);
  assert.ok(restricted.find(tree, (node) => node.props.role === 'alert'));
  restricted.unmount();
});

test('form submits credentials without blur discard, retains non-secret drafts on failed save, and keeps saved secrets empty', () => {
  let submitted;
  const props = { channel: 'email', initial: { type: 'smtp', name: 'Saved name', username: 'Saved username', credentialPresent: true }, editing: true, onSubmit: (v) => { submitted = v; }, onCancel() {} };
  const h = harness(props);
  assert.equal(h.byId('input-communication-secret').props.value, '');
  assert.equal(h.byId('input-communication-secret').props.onBlur, undefined);
  h.byId('input-communication-name').props.onChange({ target: { value: 'Non-secret draft' } });
  h.byId('input-communication-secret').props.onChange({ target: { value: 'synthetic-secret' } });
  h.byId('form-communication').props.onSubmit({ preventDefault() {} });
  assert.equal(submitted.secret, 'synthetic-secret');
  assert.equal(h.byId('input-communication-secret').props.value, '');
  props.error = { message: 'Failed save; draft kept' };
  assert.equal(h.byId('input-communication-name').props.value, 'Non-secret draft');
  h.byId('form-communication').props.onSubmit({ preventDefault() {} });
  assert.equal(Object.hasOwn(submitted, 'secret'), false, 'blank replacement preserves saved credential');
  h.byId('input-communication-secret').props.onChange({ target: { value: 'second-secret' } });
  h.byId('select-communication-type').props.onChange({ target: { value: 'api' } });
  assert.equal(h.byId('input-communication-secret').props.value, '', 'type switch clears incompatible transient credential');
  props.busy = true;
  assert.equal(h.byId('button-communication-save').props.disabled, true);
  assert.equal(h.byId('button-communication-cancel').props.disabled, true);
  h.unmount();
});

test('all form schemas submit every field and cancel clears the transient credential', () => {
  for (const [channel, type] of [['email', 'smtp'], ['email', 'api'], ['email', 'platform'], ['sms', 'api'], ['waba', 'api']]) {
    let submitted, cancelled = false;
    const h = harness({ channel, initial: { type }, onSubmit: (v) => { submitted = v; }, onCancel: () => { cancelled = true; } });
    for (const field of configurationFields(channel, type)) {
      const input = h.byId(`${field === 'security' ? 'select' : 'input'}-communication-${field}`);
      input.props.onChange({ target: { value: `synthetic-${field}` } });
    }
    h.byId('input-communication-secret').props.onChange({ target: { value: 'synthetic-secret' } });
    h.byId('form-communication').props.onSubmit({ preventDefault() {} });
    assert.equal(submitted.type, type);
    for (const field of configurationFields(channel, type)) assert.equal(submitted[field], `synthetic-${field}`);
    assert.equal(submitted.secret, 'synthetic-secret');
    h.byId('input-communication-secret').props.onChange({ target: { value: 'secret-to-clear' } });
    h.byId('button-communication-cancel').props.onClick();
    assert.equal(cancelled, true);
    assert.equal(h.byId('input-communication-secret').props.value, '');
    h.unmount();
  }
});
