import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLERGENS, DOSES, STATUSES, createDemoStore, filterOrders, groupingError, money, newGroup, nextDose, parseAmount, shippingRecipient, totalMinor, validateAttachments, validateOrder } from './immunotherapyDemo.js';

test('seed is isolated, immutable, sufficiently paged, with exactly the requested statuses', () => {
  const a = createDemoStore(), b = createDemoStore();
  assert.equal(a.getSnapshot().orders.length, 18);
  assert.deepEqual(new Set(a.getSnapshot().orders.map((o) => o.status)), new Set(STATUSES));
  assert.deepEqual(STATUSES, ['Confirmed', 'In process', 'Shipped', 'Delivered', 'Rejected', 'Returned']);
  assert.throws(() => { a.getSnapshot().orders[0].groups[0].mrp = '0'; });
  a.setNotice('changed');
  assert.equal(b.getSnapshot().notice, '');
  assert.equal(createDemoStore({ empty: true }).getSnapshot().orders.length, 0);
});
test('next dosage uses only explicit administration evidence; missing, unknown and B8 wait', () => {
  DOSES.slice(0, -1).forEach((lastGiven, i) => assert.equal(nextDose({ lastGiven }).dosage, DOSES[i + 1]));
  for (const lastGiven of [null, undefined, 'unknown', 'B8']) assert.equal(nextDose({ lastGiven, status: 'Delivered', dosage: 'B4' }).dosage, '');
  assert.match(nextDose({ lastGiven: 'B8' }).explanation, /no automatic next/i);
});
test('MRPs reject malformed, excess precision and nonfinite values; totals are exact INR', () => {
  for (const value of ['', '-1', '+1', '1.234', '1e3', 'Infinity', 'NaN', '.50', '2.', ' 1', 1, null]) assert.equal(parseAmount(value), null);
  assert.equal(totalMinor([{ mrp: '0.10' }, { mrp: '0.20' }]), 30n);
  assert.equal(money(30n), '₹0.30');
  assert.equal(parseAmount('123456789012345678901234567890.99'), 12345678901234567890123456789099n);
});
test('No Mix and duplicate bottles are blocked; mixable standalone and grouped products work', () => {
  const item = (allergenId) => ({ allergenId, result: '2' });
  assert.equal(groupingError([item(ALLERGENS[0].id), item(ALLERGENS[1].id)]), '');
  assert.equal(groupingError([item(ALLERGENS[3].id)]), '');
  assert.match(groupingError([item(ALLERGENS[3].id), item(ALLERGENS[0].id)]), /alone/);
  assert.match(groupingError([item(ALLERGENS[0].id), item(ALLERGENS[0].id)]), /Duplicate/);
  assert.notEqual(newGroup().id, newGroup().id);
});
test('save/update retain dosage, bottle IDs, attachment metadata and exact total', () => {
  const store = createDemoStore(), snap = store.getSnapshot();
  const originalDosage = snap.orders[0].dosage;
  const values = structuredClone(snap.orders[0]);
  values.dosage = 'B7'; values.attachments = [{ name: 'sample.pdf', size: 22, type: 'application/pdf' }];
  const result = store.saveOrder(values, values.id);
  assert.deepEqual(result.errors, {});
  assert.equal(result.order.dosage, 'B7');
  assert.deepEqual(result.order.groups, values.groups);
  assert.deepEqual(result.order.attachments, values.attachments);
  assert.equal(totalMinor(result.order.groups), 200050n);
  assert.equal(snap.orders[0].dosage, originalDosage);
  const added = store.saveOrder(values);
  assert.equal(added.order.number, 'DEMO-IT-0019');
  assert.equal(store.getSnapshot().orders.length, 19);
  assert.match(store.getSnapshot().notice, /No real order/);
  assert.ok(store.saveOrder(values, 'unavailable').errors.form);
  assert.equal(createDemoStore().getSnapshot().orders.length, 18);
});
test('registration creates only session demo patient with unknown history and a manual address', () => {
  const store = createDemoStore(), original = store.getSnapshot();
  assert.ok(Object.keys(store.registerPatient({}).errors).length);
  const values = { ...structuredClone(original.patients[0]), name: 'New Fiction', age: '34' };
  const { patient, errors } = store.registerPatient(values);
  assert.deepEqual(errors, {});
  assert.equal(patient.id, 'IT-PT-13');
  assert.equal(patient.lastGiven, null);
  assert.equal(nextDose(patient).dosage, '');
  assert.equal(store.getSnapshot().patients.length, 13);
  assert.equal(original.patients.length, 12);
  assert.ok(store.registerPatient({ ...values, address: { ...values.address, city: '' } }).errors['address-city']);
});
test('shipping derives recipient from current patient or doctor, not a stale address snapshot', () => {
  const snap = createDemoStore().getSnapshot(), o = snap.orders[0];
  const first = shippingRecipient({ ...o, shipping: 'patient', patientId: snap.patients[0].id }, snap.patients);
  const second = shippingRecipient({ ...o, shipping: 'patient', patientId: snap.patients[1].id }, snap.patients);
  assert.notEqual(first.address.line1, second.address.line1);
  assert.equal(shippingRecipient({ ...o, shipping: 'bogus' }, snap.patients), null);
});
test('composite search and date/status filtering operate over the complete collection', () => {
  const { orders, patients } = createDemoStore().getSnapshot();
  for (const search of ['DEMO-IT-0001', 'Asha Example', '0000000001', 'Dr. Mira Example', 'Dev Example']) assert.ok(filterOrders(orders, patients, { search }).length);
  assert.equal(filterOrders(orders, patients, { search: 'DEMO-IT-0001' }).length, 1);
  const rows = filterOrders(orders, patients, { search: 'Fiction', status: 'In process', from: '2026-10-04', to: '2026-10-10' });
  assert.ok(rows.length);
  rows.forEach((o) => assert.equal(o.status, 'In process'));
  assert.equal(filterOrders(orders, patients, { search: 'no matches' }).length, 0);
});
test('supported local attachment limits and whole-order field errors', () => {
  const pdf = { name: 'test.pdf', size: 50, type: 'application/pdf' };
  assert.equal(validateAttachments([pdf]), '');
  assert.match(validateAttachments(Array(11).fill(pdf)), /ten/);
  assert.match(validateAttachments([pdf], Array(10).fill(pdf)), /ten/);
  for (const file of [{ ...pdf, size: 0 }, { ...pdf, size: Infinity }, { ...pdf, size: 10485761 }, { ...pdf, name: 'test.exe' }, { ...pdf, type: 'image/svg+xml' }]) assert.ok(validateAttachments([file]));
  const snap = createDemoStore().getSnapshot(), values = structuredClone(snap.orders[0]);
  assert.deepEqual(validateOrder(values, snap.patients), {});
  values.histamine = '-1'; values.saline = 'NaN'; values.groups[0].mrp = '1.234'; values.groups[0].items[0].result = '';
  const errors = validateOrder(values, snap.patients);
  assert.ok(errors.histamine && errors.saline && errors[`mrp-${values.groups[0].id}`] && errors[`result-${values.groups[0].id}-${values.groups[0].items[0].allergenId}`]);
});
