import test from 'node:test';
import assert from 'node:assert/strict';
import { setNavigationGuard, interceptNavigation, installHistoryGuard } from './navigationGuard.js';

function fixture() {
  const callbacks = [];
  const history = [];
  const traversals = [];
  const browser = {
    location: { pathname: '/admin/roles-permissions', search: '?page=2', hash: '' },
    history: {
      state: null,
      pushState(state, _title, href) { this.state = state; history.push(href); },
      replaceState(state) { this.state = state; },
      go(delta) { traversals.push(delta); },
    },
    addEventListener: (_type, fn) => callbacks.push(fn),
    removeEventListener: (_type, fn) => callbacks.splice(callbacks.indexOf(fn), 1),
  };
  const release = installHistoryGuard(browser);
  return { browser, history, callbacks, traversals, release };
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

test('tagged back navigation restores before continuing without adding a history entry', () => {
  const f = fixture();
  f.browser.history.pushState({}, '', '/admin/roles-permissions?page=3');
  f.browser.location.search = '?page=3';
  let request, requests = 0, routerCalls = 0;
  const clear = setNavigationGuard((r) => { request = r; requests++; return true; }, f.browser);
  f.browser.addEventListener('popstate', () => routerCalls++);
  const pop = (position, page) => {
    f.browser.history.state = { __evexiaNavigationPosition: position };
    f.browser.location.search = `?page=${page}`;
    const event = { stopped: false, stopImmediatePropagation() { this.stopped = true; } };
    for (const fn of [...f.callbacks]) { fn(event); if (event.stopped) break; }
    return event.stopped;
  };
  try {
    assert.equal(pop(0, 2), true);
    assert.equal(request.kind, 'run');
    assert.deepEqual(f.traversals, [1]);
    request.run(); // Confirmation can precede the asynchronous restoring event.
    assert.deepEqual(f.traversals, [1]);
    assert.equal(pop(1, 3), true);
    assert.deepEqual(f.traversals, [1, -1]);
    assert.equal(pop(0, 2), false);
    assert.equal(routerCalls, 1);
    assert.equal(requests, 1);
    assert.deepEqual(f.history, ['/admin/roles-permissions?page=3']);
  } finally {
    clear(); f.release();
  }
});
