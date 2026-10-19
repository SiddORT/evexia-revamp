// Deterministic component-hook tests, not a DOM/browser or live API test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
            : 'export const EMAIL_VARIABLES=[]; export const {loadEmailTemplates,getEmailTemplate,saveEmailTemplate,deleteEmailTemplate}=globalThis.__emailApi;',
        }));
      },
    }],
  });
  const slots = [], effects = [], cleanups = [];
  let index = 0;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  globalThis.__emailApi = api;
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
const snapshot = { record: { templates: [row], events: [] } };
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
  const props = { draft: row, events: [], onSaved() { saved++; }, onDirtyChange() {}, onBusyChange() {} };
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
