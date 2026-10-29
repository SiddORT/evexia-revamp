import assert from 'node:assert/strict';
import { test } from 'node:test';

const user = { id: 'synthetic-admin', email: 'synthetic@example.test',
  system_role: 'super_admin', identity_kind: 'super_admin', permissions: ['admin.access'] };
const id = '11111111-1111-4111-8111-111111111111';
const key = '22222222-2222-4222-8222-222222222222';
const payload = { access_token: 'synthetic-token', expires_in: 900, user };
const reply = (body) => new Response(JSON.stringify(body), { status: 200 });
let index = 0;

async function setup(handler) {
  globalThis.BroadcastChannel = undefined;
  let lock = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: (_name, work) => {
      const next = lock.then(work);
      lock = next.catch(() => {});
      return next;
    },
  } } });
  globalThis.fetch = async (url, options) => url.includes('/admin/shipments/')
    ? handler(url, options) : reply(url.endsWith('/me') ? user : payload);
  const api = await import(`./adminSession.js?shipment-fix=${index++}`);
  await api.loginAdmin(user.email, 'synthetic-password', false);
  return api;
}

const body = { idempotency_key: key, expected_version: 4,
  tracking_id: 'tracking-123', expected_delivery_date: '2026-10-31', actual_delivery_date: null };
function result(type, action) {
  return { id, key: `${type}:${id}`, type, number: 'synthetic-order', version: 5,
    status: action === 'return' ? 'Returned' : 'Shipped', trackingId: body.tracking_id,
    expectedDeliveryDate: body.expected_delivery_date, actualDeliveryDate: null };
}

test('shipment-specific replies confirm all four types and all three operations without purchase-order lines', async (t) => {
  let calls = 0;
  const api = await setup(async (url, options) => {
    calls++;
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    const [, type, , action] = new URL(url, 'https://example.test').pathname.match(/shipments\/([^/]+)\/([^/]+)\/([^/]+)$/);
    const saved = result(type, action);
    if (action === 'delivery') saved.actualDeliveryDate = '2026-10-29';
    return reply(saved);
  });
  t.after(() => api.logoutAdmin());
  for (const type of ['Kit', 'IT', 'Lupin', 'SPT']) {
    for (const action of ['ship', 'delivery', 'return']) {
      const values = action === 'delivery' ? { ...body, actual_delivery_date: '2026-10-29' } : body;
      const saved = await api.purchaseOrderRequest(`/${type}/${id}/${action}`, { body: values }, 'shipments');
      assert.equal(saved.type, type);
      assert.equal(saved.version, 5);
      assert.equal(saved.lines, undefined);
    }
  }
  assert.equal(calls, 12);
});

test('wrong target, stale version, wrong status and mismatched dispatch details stay uncertain without replay', async (t) => {
  let response = result('IT', 'ship'), calls = 0;
  const api = await setup(async () => { calls++; return reply(response); });
  t.after(() => api.logoutAdmin());
  const corruptions = [
    { id: key }, { type: 'Kit' }, { key: `Kit:${id}` }, { version: 4 },
    { version: '5' }, { status: 'In process' }, { trackingId: 'different' },
    { expectedDeliveryDate: '2026-11-01' }, { actualDeliveryDate: '2026-10-29' },
  ];
  for (const patch of corruptions) {
    response = { ...result('IT', 'ship'), ...patch };
    await assert.rejects(api.purchaseOrderRequest(`/IT/${id}/ship`, { body }, 'shipments'),
      (error) => error.ambiguous === true);
  }
  assert.equal(calls, corruptions.length);
  response = result('IT', 'ship');
  assert.equal((await api.purchaseOrderRequest(`/IT/${id}/ship`, { body }, 'shipments')).status, 'Shipped');
  assert.equal(calls, corruptions.length + 1);
});
