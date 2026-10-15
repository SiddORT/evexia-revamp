import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankOrder, createDemoStore, DOCTORS, MRS, KIT_PRODUCTS, STATUSES, validateOrder, shippingRecipient, filterOrders, exportCsv, validateAttachments } from './kitsOrdersDemo.js';

const valid = () => ({ ...blankOrder(), doctorId: DOCTORS[0].id, lancets: '10' });
test('configuration options are exact and blank rows do not create items', () => {
  assert.deepEqual(KIT_PRODUCTS, ['200', '250', '100', '85', '70', '58', 'Customized']);
  assert.equal(validateOrder({ ...blankOrder(), doctorId: DOCTORS[0].id }).products, 'Include at least one kit or consumable.');
  assert.deepEqual(validateOrder(valid()), {});
  for (const value of ['-1', '0', '1.5', 'abc', 'Infinity']) assert.ok(validateOrder({ ...valid(), lancets: value }).lancets);
});
test('kit requires configuration, positive volume and whole quantity; custom is explicit', () => {
  const v = valid(); v.lancets = ''; v.kit = { product: 'Customized', custom: '', volume: '-1', quantity: '1.5' };
  assert.deepEqual(Object.keys(validateOrder(v)).sort(), ['kit-custom', 'kit-quantity', 'kit-volume']);
  v.kit = { product: 'Customized', custom: '150', volume: '0.5', quantity: '2' };
  assert.deepEqual(validateOrder(v), {});
  for (const product of ['150', '']) assert.ok(validateOrder({ ...v, kit: { ...v.kit, product } })['kit-product']);
  for (const volume of ['0', '-1', 'Infinity', 'NaN']) assert.ok(validateOrder({ ...v, kit: { ...v.kit, volume } })['kit-volume']);
});
test('doctor billing is always required; MR is conditional and shipping never falls back', () => {
  const v = valid();
  assert.deepEqual(validateOrder(v), {});
  assert.ok(validateOrder({ ...v, orderFor: 'mr' }).mrId);
  assert.ok(validateOrder({ ...v, orderFor: 'mr', mrId: MRS[0].id, doctorId: '' }).doctorId);
  assert.equal(shippingRecipient({ ...v, shipping: 'mr' }), null);
  assert.equal(shippingRecipient({ ...v, doctorId: '' }), null);
  assert.equal(shippingRecipient({ ...v, shipping: 'unknown' }), null);
  assert.equal(shippingRecipient({ ...v, shipping: 'mr', mrId: MRS[1].id }).name, MRS[1].name);
  assert.ok(validateOrder({ ...v, shipping: 'mr' }).mrId);
});
test('Other requires explicit recipient and address; optional lines stay optional', () => {
  const v = { ...valid(), shipping: 'other' };
  const errors = validateOrder(v);
  for (const key of ['name', 'phone', 'line1', 'country', 'state', 'city', 'pincode']) assert.ok(errors[`other-${key}`]);
  v.other = { name: 'Fictional Recipient', phone: '+91 0000000999', address: { line1: 'Demo street', country: 'India', state: 'Demo', city: 'Sample', pincode: '000000' } };
  assert.deepEqual(validateOrder(v), {});
});
test('attachments enforce count/type/extension/size and remain metadata only', () => {
  const file = { name: 'example.pdf', type: 'application/pdf', size: 1024 };
  assert.equal(validateAttachments([file]), '');
  assert.ok(validateAttachments(Array(11).fill(file)));
  assert.ok(validateAttachments([file], Array(10).fill(file)));
  for (const f of [{ ...file, size: 0 }, { ...file, size: 10485761 }, { ...file, type: 'text/plain' }, { ...file, name: 'bad.exe' }]) assert.ok(validateAttachments([f]));
  const store = createDemoStore({ empty: true });
  const v = { ...valid(), attachments: [{ ...file, bytes: 'MUST NOT RETAIN' }] };
  const { order } = store.saveOrder(v);
  assert.deepEqual(order.attachments, [file]);
  assert.ok(Object.isFrozen(order.attachments[0]));
});
test('session saves notify, snapshot identities independently and reset in fresh stores', () => {
  const store = createDemoStore({ empty: true }); let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  const v = { ...valid(), shipping: 'mr', mrId: MRS[1].id };
  const { order, errors } = store.saveOrder(v);
  assert.deepEqual(errors, {}); assert.equal(order.status, 'Confirmed'); assert.equal(order.paymentStatus, 'Mock unpaid');
  assert.equal(order.billing.name, DOCTORS[0].name); assert.equal(order.recipient.name, MRS[1].name);
  v.lancets = '999';
  assert.equal(order.lancets, '10'); assert.equal(calls, 1);
  assert.match(store.getSnapshot().notice, /No real order/);
  unsubscribe(); store.setNotice(''); assert.equal(calls, 1);
  assert.equal(createDemoStore({ empty: true }).getSnapshot().orders.length, 0);
  assert.ok(store.saveOrder(blankOrder()).errors.products);
  assert.equal(store.getSnapshot().orders.length, 1);
});
test('seeded statuses, combined filtering and privacy-limited safe CSV', () => {
  const rows = createDemoStore().getSnapshot().orders;
  assert.deepEqual(new Set(rows.map((o) => o.status)), new Set(STATUSES));
  assert.equal(filterOrders(rows, { statuses: ['Confirmed', 'Shipped'] }).length, 2);
  assert.equal(filterOrders(rows, { search: 'Mira', doctorId: DOCTORS[0].id }).length, 2);
  assert.equal(filterOrders(rows, { from: '2026-10-10', to: '2026-10-10', paymentStatus: 'Mock unpaid' }).length, 1);
  assert.equal(filterOrders(rows, { from: '2026-10-11' }).length, 0);
  const csv = exportCsv([{ ...rows[0], number: '=FORMULA,"quoted"\nline' }]);
  assert.match(csv, /"'=FORMULA,""quoted""\nline"/);
  for (const secret of [rows[0].id, rows[0].doctorId, rows[0].billing.address.line1, rows[0].billing.phone, 'attachments']) assert.ok(!csv.includes(secret));
  assert.equal(exportCsv(filterOrders(rows, { statuses: ['Confirmed'] })).split('\r\n').length, 2);
});
