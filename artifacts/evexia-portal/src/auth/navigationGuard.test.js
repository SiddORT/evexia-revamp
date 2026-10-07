import test from 'node:test';
import assert from 'node:assert/strict';
import { setNavigationGuard, interceptNavigation, installHistoryGuard } from './navigationGuard.js';

function fixture() {
  const callbacks = [];
  const history = [];
  const browser = {
    location: { pathname: '/admin/roles-permissions', search: '?page=2', hash: '' },
    history: { pushState: (_state, _title, href) => history.push(href) },
    addEventListener: (_type, fn) => callbacks.push(fn),
    removeEventListener: (_type, fn) => callbacks.splice(callbacks.indexOf(fn), 1),
  };
  const release = installHistoryGuard(browser);
  return { browser, history, callbacks, release };
}

test('an early history listener blocks router delivery, restores the editor and prompts with the intended destination', () => {
  const f = fixture();
  let request, routerCalls = 0;
  const clear = setNavigationGuard((r) => { request = r; return true; }, f.browser);
  f.browser.addEventListener('popstate', () => routerCalls++);
  f.browser.location = { pathname: '/admin/login', search: '', hash: '' };
  const event = { stopped: false, stopImmediatePropagation() { this.stopped = true; } };
  for (const fn of [...f.callbacks]) { fn(event); if (event.stopped) break; }
  assert.equal(routerCalls, 0);
  assert.deepEqual(request, { kind: 'raw', href: '/admin/login' });
  assert.deepEqual(f.history, ['/admin/roles-permissions?page=2']);
  clear(); f.release();
});

test('cleared editors do not block history or profile requests, and older cleanup cannot remove a new editor', () => {
  const f = fixture();
  const old = setNavigationGuard(() => true, f.browser);
  const current = setNavigationGuard(() => true, f.browser);
  old();
  assert.equal(interceptNavigation({ kind: 'run' }), true);
  current();
  assert.equal(interceptNavigation({ kind: 'href', href: '/admin/settings' }), false);
  let stopped = false;
  f.callbacks[0]({ stopImmediatePropagation() { stopped = true; } });
  assert.equal(stopped, false);
  assert.equal(f.history.length, 0);
  f.release();
});
