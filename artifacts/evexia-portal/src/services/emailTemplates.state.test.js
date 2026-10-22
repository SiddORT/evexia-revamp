// Deterministic component-hook tests, not a DOM/browser or live API test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMAIL_VARIABLES, INVITATION_VARIABLES, emailSnapshot } from './emailTemplates.js';
import * as emailApi from './emailTemplates.js';

const require = createRequire(new URL('../../package.json', import.meta.url));
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const components = fileURLToPath(new URL('../components/admin/', import.meta.url));

async function fixture(name, api) {
  const output = await build({
    entryPoints: [path.join(components, `${name}.jsx`)], bundle: true, write: false,
    platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external',
    plugins: [{
      name: 'isolated-hooks-and-transport',
      setup(b) {
        b.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'fixture' }));
        b.onResolve({ filter: /\/emailTemplates\.js$/ }, () => ({ path: 'api', namespace: 'fixture' }));
        b.onResolve({ filter: /^\.\/MessageTemplate(?:Drawer|Preview|Editor)\.jsx$/ }, (args) => ({
          path: path.basename(args.path, '.jsx'), namespace: 'child',
        }));
        b.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'empty' }));
        b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '' }));
        b.onLoad({ filter: /.*/, namespace: 'child' }, (args) => ({
          contents: `export default function ${args.path}(){return null}`,
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: args.path === 'hooks'
            ? 'export const {useState,useEffect,useMemo,useRef,useCallback,useId}=globalThis.__emailHooks;'
            : `export const {${Object.keys(emailApi).join(',')}}=globalThis.__emailApi;`,
        }));
      },
    }],
  });
  const slots = [], effects = [], cleanups = [];
  let index = 0;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const unexpected = async () => { throw new Error('Unexpected email transport in isolated fixture'); };
  globalThis.__emailApi = {
    ...emailApi,
    loadEmailTemplates: unexpected, getEmailTemplate: unexpected,
    saveEmailTemplate: unexpected, deleteEmailTemplate: unexpected,
    getModernEmailLayout: unexpected, sendEmailTemplateTest: unexpected,
    ...api,
  };
  globalThis.__emailHooks = {
    useCallback(callback, deps) {
      return globalThis.__emailHooks.useMemo(() => callback, deps);
    },
    useId() {
      const i = index++;
      return slots[i] ||= `email-fixture-${i}`;
    },
    useState(value) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value;
      return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef(value) {
      const i = index++;
      return slots[i] ||= { current: value };
    },
    useMemo(work, deps) {
      const i = index++;
      if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, value: work() };
      return slots[i].value;
    },
    useEffect(work, deps) {
      const i = index++;
      if (changed(slots[i], deps)) {
        slots[i] = deps;
        effects.push(() => { cleanups[i]?.(); cleanups[i] = work(); });
      }
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports);
  return {
    render(props) {
      index = 0;
      const tree = module.exports.default(props);
      effects.splice(0).forEach((run) => run());
      return tree;
    },
    close() {
      cleanups.forEach((cleanup) => cleanup?.());
      delete globalThis.__emailHooks; delete globalThis.__emailApi;
    },
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const text = (tree) => Array.isArray(tree) ? tree.map(text).join('')
  : tree && typeof tree === 'object' ? text(tree.props?.children) : String(tree ?? '');
const find = (tree, id) => nodes(tree).find((n) => n.props?.['data-testid'] === id);
const button = (tree, label) => nodes(tree).find((n) => n.type === 'button' && text(n) === label);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const row = { id: 'e7e80000-0000-4000-8000-000000000001', version: 1, channel: 'email', source: 'system',
  protected: true, eventKey: 'password_recovery', name: 'Forgot password', description: 'Recovery',
  content: { subject: 'Reset password', html: '<p>{{reset_url}} {{expiry_minutes}}</p>', text: '{{reset_url}} {{expiry_minutes}}' } };
const invitation = { ...row, id: 'e7e80000-0000-4000-8000-000000000002', name: 'Invite staff member',
  eventKey: 'account_invitation', content: { subject: 'Join {{company_name}}',
    html: '<p>{{portal_name}} {{login_id}} {{reset_url}} {{expiry_minutes}}</p>',
    text: '{{portal_name}} {{login_id}} {{reset_url}} {{expiry_minutes}}' } };
const mrInvitation = { ...invitation, id: 'e7e80000-0000-4000-8000-000000000003',
  name: 'Invite MR', eventKey: 'mr_invitation' };
const events = [
  { key: 'password_recovery', label: 'Password recovery', required: true, variables: EMAIL_VARIABLES },
  { key: 'account_invitation', label: 'Staff invitation', required: true, variables: INVITATION_VARIABLES },
  { key: 'mr_invitation', label: 'MR invitation', required: true, variables: INVITATION_VARIABLES },
];
const snapshot = { record: { templates: [row, invitation, mrInvitation], events } };
const predecessor = () => emailSnapshot({ items: [], events: events.slice(0, 1) });
const unavailable = () => { throw new Error('Email template API is unavailable; your draft is kept.'); };

test('library retains the last valid snapshot and the same editor identity after list/detail failure', async (t) => {
  let offline = false;
  const api = {
    loadEmailTemplates: async () => offline ? unavailable() : snapshot,
    getEmailTemplate: async () => offline ? unavailable() : row,
  };
  const component = await fixture('EmailTemplateLibrary', api);
  t.after(() => component.close());
  const dirty = [], props = { guard: () => true, onDirtyChange: (v) => dirty.push(v), onBusyChange() {} };
  component.render(props); await tick();
  let tree = component.render(props);
  await find(tree, `button-edit-template-${row.id}`).props.onClick();
  tree = component.render(props);
  const editor = nodes(tree).find((n) => n.type?.name === 'MessageTemplateEditor');
  assert.equal(editor.props.draft, row);
  const count = dirty.length;
  offline = true;
  await button(tree, 'Load latest').props.onClick();
  tree = component.render(props);
  assert.ok(find(tree, `card-template-${row.id}`), 'previous valid snapshot remains');
  let retained = nodes(tree).find((n) => n.type?.name === 'MessageTemplateEditor');
  assert.equal(retained.key, editor.key);
  assert.equal(retained.props.draft, row);
  await find(tree, `button-preview-template-${row.id}`).props.onClick();
  tree = component.render(props);
  retained = nodes(tree).find((n) => n.type?.name === 'MessageTemplateEditor');
  assert.equal(retained.key, editor.key, 'failed detail never replaces editor');
  assert.equal(dirty.length, count, 'failed read does not clear dirty state');
  assert.match(text(tree), /open draft or preview is unchanged/);
});

test('failed save and failed/different explicit reconciliation retain typed draft without replay', async (t) => {
  let saves = 0, reads = 0, readFails = true;
  const component = await fixture('MessageTemplateEditor', {
    async saveEmailTemplate() { saves++; const e = new Error('Uncertain save'); e.ambiguous = true; throw e; },
    async loadEmailTemplates() { reads++; if (readFails) return unavailable(); return snapshot; },
  });
  t.after(() => component.close());
  let saved = 0;
  const props = { draft: row, events, onSaved() { saved++; }, onDirtyChange() {}, onBusyChange() {} };
  let tree = component.render(props);
  find(tree, 'input-template-subject').props.onChange({ target: { value: 'My unsaved subject' } });
  tree = component.render(props);
  nodes(tree).find((n) => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await tick();
  tree = component.render(props);
  assert.equal(saves, 1);
  assert.equal(find(tree, 'input-template-subject').props.value, 'My unsaved subject');
  assert.equal(find(tree, 'button-template-save').props.disabled, true);
  await button(tree, 'Load latest to reconcile (keep draft)').props.onClick();
  tree = component.render(props);
  assert.equal(find(tree, 'input-template-subject').props.value, 'My unsaved subject');
  assert.equal(find(tree, 'button-template-save').props.disabled, true);
  readFails = false;
  await button(tree, 'Load latest to reconcile (keep draft)').props.onClick();
  tree = component.render(props);
  assert.equal(find(tree, 'input-template-subject').props.value, 'My unsaved subject');
  assert.equal(reads, 2);
  assert.equal(saves, 1, 'reconciliation never replays a mutation');
  assert.equal(saved, 0, 'different content is not claimed saved');
});

test('predecessor list retains both cards and the mounted editor identity', async (t) => {
  let stale = false;
  const component = await fixture('EmailTemplateLibrary', {
    loadEmailTemplates: async () => stale ? predecessor() : snapshot,
    getEmailTemplate: async () => invitation,
  });
  t.after(() => component.close());
  const dirty = [], props = { guard: () => true, onDirtyChange: (v) => dirty.push(v), onBusyChange() {} };
  component.render(props); await tick();
  let tree = component.render(props);
  await find(tree, `button-preview-template-${invitation.id}`).props.onClick();
  tree = component.render(props);
  assert.equal(nodes(tree).find((n) => n.type?.name === 'MessageTemplatePreview').props.eventKey, 'account_invitation');
  await find(tree, 'button-drawer-edit-template').props.onClick();
  tree = component.render(props);
  const editor = nodes(tree).find((n) => n.type?.name === 'MessageTemplateEditor');
  const count = dirty.length;
  stale = true;
  await button(tree, 'Load latest').props.onClick();
  tree = component.render(props);
  for (const item of [row, invitation]) assert.ok(find(tree, `card-template-${item.id}`));
  const retained = nodes(tree).find((n) => n.type?.name === 'MessageTemplateEditor');
  assert.equal(retained.key, editor.key);
  assert.equal(retained.props.draft, invitation);
  assert.equal(dirty.length, count);
  assert.match(text(tree), /invalid response.*draft is kept/);
});

test('predecessor save/reconciliation preserve typed fields and block automatic replay', async (t) => {
  let saves = 0, saved = 0;
  const component = await fixture('MessageTemplateEditor', {
    async saveEmailTemplate() { saves++; return predecessor(); },
    async loadEmailTemplates() { return predecessor(); },
  });
  t.after(() => component.close());
  const props = { draft: invitation, events, onSaved() { saved++; }, onDirtyChange() {}, onBusyChange() {} };
  let tree = component.render(props);
  find(tree, 'input-template-subject').props.onChange({ target: { value: 'Keep this invitation draft' } });
  tree = component.render(props);
  assert.equal(nodes(tree).find((n) => n.type?.name === 'MessageTemplatePreview').props.eventKey, 'account_invitation');
  nodes(tree).find((n) => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await tick();
  tree = component.render(props);
  await button(tree, 'Load latest to reconcile (keep draft)').props.onClick();
  tree = component.render(props);
  assert.equal(find(tree, 'input-template-subject').props.value, 'Keep this invitation draft');
  assert.equal(find(tree, 'button-template-save').props.disabled, true);
  assert.equal(saves, 1);
  assert.equal(saved, 0);
  assert.match(text(tree), /invalid response.*draft is kept/);
});

test('all three event previews expose only their variables and keep the iframe inert', async (t) => {
  const component = await fixture('MessageTemplatePreview', {});
  t.after(() => component.close());
  for (const item of [row, invitation, mrInvitation]) {
    const props = { channel: 'email', content: item.content, eventKey: item.eventKey };
    let tree = component.render(props);
    find(tree, 'mtp-mode-sample').props.onClick();
    tree = component.render(props);
    const expected = emailApi.isInvitationEvent(item.eventKey) ? INVITATION_VARIABLES : EMAIL_VARIABLES;
    for (const variable of INVITATION_VARIABLES) {
      assert.equal(!!find(tree, `mtp-sample-${variable}`), expected.includes(variable));
    }
    assert.doesNotMatch(text(tree), /Unavailable for email delivery|Unknown tokens/);
    const frame = find(tree, 'mtp-frame');
    assert.equal(frame.props.sandbox, '');
    assert.match(frame.props.srcDoc, /default-src 'none'/);
    assert.doesNotMatch(frame.props.srcDoc, /<a\s|<script\b|<form\b|src=["']https?:/);
    assert.doesNotMatch(frame.props.srcDoc, /\{\{(?:portal_name|login_id)\}\}/);
  }
});
