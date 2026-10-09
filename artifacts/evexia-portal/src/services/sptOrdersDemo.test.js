import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoStore, DOCTORS, MRS, parseAmount, totalMinor, money } from './sptOrdersDemo.js';

const complete = (store) => ({
  doctorId: DOCTORS[0].id, mrId: MRS[0].id,
  patients: store.getSnapshot().patients.slice(0, 2).map((p, i) => ({ ...p, amount: i ? '0.20' : '0.10' })),
  remarks: 'Fictional review',
});
test('decimal parsing and totals remain exact, including beyond Number precision', () => {
  assert.equal(totalMinor([{ amount: '0.10' }, { amount: '0.20' }]), 30n);
  assert.equal(money(30n), '₹0.30');
  assert.equal(parseAmount('9007199254740993.12'), 900719925474099312n);
  assert.equal(money(900719925474099312n), '₹9,00,71,99,25,47,40,993.12');
  assert.equal(parseAmount('0'), 0n);
  for (const invalid of ['', ' ', '-1', '1.234', '1e2', 'NaN', 'Infinity', '1,000', '.2', '1.', 'abc', ' 1', '1 ', 2, '1'.repeat(41)]) assert.equal(parseAmount(invalid), null);
  assert.equal(totalMinor([{ amount: '' }, { amount: '-2' }, { amount: '1.20' }]), 120n);
});
test('registration rejects invalid fields, generates distinct IDs and keeps directory isolated', () => {
  const store = createDemoStore();
  assert.deepEqual(Object.keys(store.registerPatient({ name: '', gender: '', age: '-1' }).errors), ['name', 'gender', 'age']);
  for (const age of ['1.2', '121', 'NaN', 'Infinity']) assert.ok(store.registerPatient({ name: 'Demo', gender: 'Other', age }).errors.age);
  const a = store.registerPatient({ name: '  New Demo  ', gender: 'Other', age: '0' }).patient;
  const b = store.registerPatient({ name: 'New Demo', gender: 'Female', age: '120' }).patient;
  assert.equal(a.name, 'New Demo');
  assert.notEqual(a.id, b.id);
  assert.equal(store.getSnapshot().patients.length, 6);
  assert.equal(createDemoStore().getSnapshot().patients.length, 4);
});
test('drafts preserve incomplete and malformed entries, update in place and finalize with validation', () => {
  const store = createDemoStore();
  const values = { doctorId: '', mrId: '', patients: [], remarks: 'Unfinished' };
  const blank = store.saveOrder(values, 'Draft').order;
  assert.equal(blank.status, 'Draft');
  assert.equal(blank.remarks, values.remarks);
  const incomplete = { ...complete(store), mrId: '', patients: [{ ...store.getSnapshot().patients[0], amount: '-bad' }] };
  const draft = store.saveOrder(incomplete, 'Draft', blank.id).order;
  assert.equal(draft.number, blank.number);
  assert.equal(draft.patients[0].amount, '-bad');
  assert.ok(store.saveOrder(incomplete, 'Saved', draft.id).errors.mrId);
  assert.ok(store.saveOrder(incomplete, 'Saved', draft.id).errors[`amount-${draft.patients[0].id}`]);
  const result = store.saveOrder(complete(store), 'Saved', draft.id);
  assert.deepEqual(result.errors, {});
  assert.equal(result.order.remarks, 'Fictional review');
  assert.equal(result.order.patients[0].name, store.getSnapshot().patients[0].name);
  assert.equal(totalMinor(result.order.patients), 30n);
  assert.ok(store.getSnapshot().notice.includes('No real order was submitted'));
  assert.ok(store.saveOrder(complete(store), 'Draft', result.order.id).errors.form);
});
test('finalization rejects duplicates, missing references, empty rows, unknown patients and invalid amounts', () => {
  const store = createDemoStore();
  assert.ok(store.saveOrder({ ...complete(store), patients: [] }, 'Saved').errors.patients);
  assert.ok(store.saveOrder({ ...complete(store), doctorId: 'real-doctor' }, 'Saved').errors.doctorId);
  const p = complete(store).patients[0];
  assert.ok(store.saveOrder({ ...complete(store), patients: [p, p] }, 'Saved').errors.patients);
  assert.ok(store.saveOrder({ ...complete(store), patients: [{ ...p, id: 'real-patient' }] }, 'Saved').errors.patients);
  for (const amount of ['', '-1', 'bad', 'Infinity', '0.001']) {
    assert.ok(store.saveOrder({ ...complete(store), patients: [{ ...p, amount }] }, 'Saved').errors[`amount-${p.id}`]);
  }
});
test('snapshots are immutable and subscribed changes stop after unsubscribe; a new loaded session resets', () => {
  const store = createDemoStore();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  const original = store.getSnapshot();
  assert.equal(original, store.getSnapshot());
  assert.throws(() => { original.orders[0].patients[0].amount = '77'; });
  store.saveOrder(complete(store), 'Draft');
  assert.notEqual(original, store.getSnapshot());
  assert.equal(notifications, 1);
  unsubscribe();
  store.setNotice('');
  assert.equal(notifications, 1);
  assert.equal(createDemoStore().getSnapshot().orders.length, 2);
});
