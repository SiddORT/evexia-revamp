import assert from 'node:assert/strict';
import { test } from 'node:test';

test('order retry metadata is owner-scoped, coordinated and fails closed', async () => {
  globalThis.BroadcastChannel = undefined;
  const storage = new Map();
  let unavailable = false;
  let tail = Promise.resolve();
  const lockNames = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request(name, work) {
      lockNames.push(name);
      const next = tail.then(work);
      tail = next.catch(() => {});
      return next;
    },
  } } });
  globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    localStorage: {
      getItem(key) { if (unavailable) throw new Error('blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (unavailable) throw new Error('blocked'); storage.set(key, value); },
      removeItem(key) { if (unavailable) throw new Error('blocked'); storage.delete(key); },
    },
  };
  globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
  let identity = 'synthetic-owner-a';
  const user = () => ({ id: identity, identity_kind: 'super_admin', system_role: 'super_admin', permissions: ['admin.access'], email: 'synthetic@example.test' });
  globalThis.fetch = async (url) => new Response(JSON.stringify(
    url.endsWith('/me') ? user() : url.endsWith('/logout') ? {} : { access_token: 'synthetic-token', expires_in: 900, user: user() },
  ), { status: 200 });
  const auth = await import('../src/auth/adminSession.js');
  const service = await import('../src/services/serverPurchaseOrders.js');
  await auth.loginAdmin('synthetic', 'synthetic', false);
  const id = '11111111-1111-4111-8111-111111111111';
  const attempt = { operation: 'delete', key: '22222222-2222-4222-8222-222222222222', version: 4 };
  try {
    assert.equal(service.loadOrderMutation(id).status, 'none');
    assert.equal(await service.saveOrderMutation(id, attempt), true);
    assert.equal(service.loadOrderMutation(id).pending.version, 4);
    assert.equal(await service.saveOrderMutation(id, attempt), true);
    assert.equal(await service.saveOrderMutation(id, { ...attempt, version: 5 }), false);
    assert.equal(await service.clearOrderMutation(id, 'wrong-key'), false);
    assert.equal(service.loadOrderMutation(id).status, 'found');
    const locksBefore = lockNames.length;
    assert.equal(await service.clearOrderMutation(id, attempt.key), true);
    assert.equal(lockNames.length, locksBefore + 1, 'clearing must use the same lock as writes');
    assert.equal(service.loadOrderMutation(id).status, 'none');
    await service.saveOrderMutation(id, attempt);
    identity = 'synthetic-owner-b';
    await auth.loginAdmin('synthetic', 'synthetic', false);
    assert.equal(service.loadOrderMutation(id).status, 'none');
    identity = 'synthetic-owner-a';
    await auth.loginAdmin('synthetic', 'synthetic', false);
    assert.equal(service.loadOrderMutation(id).status, 'found');
    unavailable = true;
    assert.equal(service.loadOrderMutation(id).status, 'blocked');
    assert.equal(await service.saveOrderMutation(id, attempt), false);
    assert.equal(await service.clearOrderMutation(id, attempt.key), false);
    unavailable = false;
    const key = [...storage.keys()][0];
    storage.set(key, '{broken');
    assert.equal(service.loadOrderMutation(id).status, 'blocked');
    storage.set(key, JSON.stringify({ ...attempt, id, owner: identity, operation: 'edit', values: {}, order: {} }));
    assert.equal(service.loadOrderMutation(id).status, 'blocked');
    storage.clear();
    navigator.locks = undefined;
    assert.equal(await service.saveOrderMutation(id, attempt), false);
    assert.equal(await service.clearOrderMutation(id, attempt.key), false);
  } finally {
    navigator.locks = { request: (_name, work) => work() };
    await auth.logoutAdmin();
  }
});
