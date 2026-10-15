import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOCTORS, MRS, STATUSES, createDemoStore, filterOrders, money, ordersCsv, parsePatientCount, parsePrice, totalMinor, validateAttachments, validateOrder } from './lupinOrdersDemo.js';
const file = { name: 'demo.pdf', type: 'application/pdf', size: 2048 };
const valid = () => ({ doctorId: DOCTORS[0].id, mrId: MRS[0].id, patientCount: '3', price: '0.10', remarks: 'Preserve this note', attachments: [{ ...file }] });
test('positive safe whole counts reject malformed, blank and unsafe values', () => {
  for (const v of ['', '0', '-1', '1.5', '1e2', 'NaN', 'Infinity', ' 1 ', '9007199254740992', null]) assert.equal(parsePatientCount(v), null, String(v));
  assert.equal(parsePatientCount('9007199254740991'), 9007199254740991n);
});
test('positive prices parse decimal lexemes without rounding or floating point', () => {
  for (const v of ['', '0', '0.00', '-1', '1.001', '1e2', 'NaN', 'Infinity', '.1', '1.', ' 1 ', null]) assert.equal(parsePrice(v), null, String(v));
  assert.equal(parsePrice('0001.01'), 101n);
  assert.equal(totalMinor('3', '0.10'), 30n);
  assert.equal(totalMinor('9007199254740991', '0.01'), 9007199254740991n);
  assert.equal(totalMinor('', '1000'), 0n);
  assert.equal(totalMinor('3', 'invalid'), 0n);
  assert.equal(money(totalMinor('3', '1250.50')), '₹3,751.50');
});
test('required validation and file format, size and quantity boundaries', () => {
  assert.deepEqual(validateOrder(valid()), {});
  assert.equal(Object.keys(validateOrder({ attachments: [] })).length, 5);
  assert.equal(validateAttachments(Array(10).fill(file)), '');
  assert.match(validateAttachments(Array(11).fill(file)), /ten/);
  assert.match(validateAttachments([file], Array(10).fill(file)), /ten/);
  for (const patch of [{ size: 0 }, { size: 10485761 }, { size: Infinity }, { type: 'image/png' }, { name: 'test.exe' }]) assert.ok(validateAttachments([{ ...file, ...patch }]));
  assert.equal(validateAttachments([{ ...file, size: 10485760 }]), '');
  for (const [name, type] of [['a.jpg', 'image/jpeg'], ['A.JPEG', 'image/jpeg'], ['a.png', 'image/png'], ['a.webp', 'image/webp']]) assert.equal(validateAttachments([{ ...file, name, type }]), '');
});
test('save is isolated, immutable, metadata-only, validated, and new stores reset', () => {
  const store = createDemoStore({ empty: true });
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  assert.ok(store.saveOrder({ ...valid(), price: '0.001' }).errors.price);
  assert.equal(store.getSnapshot().orders.length, 0);
  const values = valid();
  values.attachments[0].contents = 'must not persist';
  values.paymentStatus = 'Paid';
  const { order } = store.saveOrder(values);
  values.attachments[0].name = 'changed.pdf';
  assert.equal(order.status, 'Confirmed');
  assert.equal(order.paymentStatus, 'Unpaid');
  assert.equal(order.attachments[0].name, 'demo.pdf');
  assert.deepEqual(Object.keys(order.attachments[0]), ['name', 'size', 'type']);
  assert.ok(Object.isFrozen(order.attachments[0]));
  assert.equal(notifications, 1);
  unsubscribe();
  store.setNotice('');
  assert.equal(notifications, 1);
  assert.equal(createDemoStore({ empty: true }).getSnapshot().orders.length, 0);
});
test('filters combine search, date, doctor, and OR status choices', () => {
  const orders = createDemoStore().getSnapshot().orders;
  assert.equal(orders.length, 6);
  assert.deepEqual(new Set(orders.map((o) => o.status)), new Set(STATUSES));
  assert.equal(filterOrders(orders, { statuses: ['Confirmed', 'Approved'] }).length, 2);
  const o = orders[0];
  assert.deepEqual(filterOrders(orders, { search: o.number.toLowerCase(), date: o.date, doctorId: o.doctorId, statuses: [o.status] }), [o]);
  assert.equal(filterOrders(orders, { search: 'missing' }).length, 0);
  assert.equal(filterOrders(orders).length, 6);
});
test('CSV exports only explicit visible data with quotes and formula protection', () => {
  const o = createDemoStore().getSnapshot().orders[0];
  const csv = ordersCsv([{ ...o, doctorName: '=SUM(1,2)', mrName: ' \t+cmd,"quoted"\nline', hidden: 'SECRET', remarks: 'PRIVATE', attachments: [{ name: 'PRIVATEFILE' }] }]);
  assert.match(csv, /"'=SUM\(1,2\)"/);
  assert.match(csv, /"' \t\+cmd,""quoted""\nline"/);
  for (const secret of ['SECRET', 'PRIVATE', 'PRIVATEFILE', o.id, o.doctorId, o.mrId]) assert.ok(!csv.includes(secret));
  assert.equal(ordersCsv([]).split('\r\n').length, 2);
});
