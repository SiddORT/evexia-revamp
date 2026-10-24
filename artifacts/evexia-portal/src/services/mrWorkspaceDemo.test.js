import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addDoctor, calculateOrderTotal, createWorkspace, DEMO_DATE, doctorErrors, money, orderBalance, orderPaymentStatus, parseMoney, PRODUCTS, recordPayment, saveOrder, summarize } from './mrWorkspaceDemo.js';

const doctor = { name: 'Dr. Fiction Test', qualification: 'MD', registration: 'DEMO-NEW', clinic: 'Example Clinic', phoneCountry: 'IN', phone: '0000000000', email: 'test@example.test', address: 'Fictional street' };
const orderInput = { doctorId: 'demo-doctor-a', items: [{ productId: 'demo-kit', quantity: 3 }, { productId: 'demo-lupin', quantity: 2 }] };
const payment = { doctorId: 'demo-doctor-c', orderId: 'demo-order-c', kind: 'partial', amount: '100.25', date: DEMO_DATE, method: 'Cash' };
test('exact decimal boundary rejects malformed, signed, scientific and excess precision', () => {
  for (const bad of ['', '1.001', '-1', '+1', ' 1', '1 ', '1e2', '.5', '01.00', '1,000', 'NaN', 'Infinity', 1, null, '1000000000']) assert.throws(() => parseMoney(bad));
  assert.equal(parseMoney('0'), 0);
  assert.equal(parseMoney('0.01'), 1);
  assert.equal(parseMoney('123.4'), 12340);
  assert.equal(parseMoney('999999999.99'), 99999999999);
  assert.match(money(10025), /100\.25/);
  assert.throws(() => money(1.01));
});
test('seed order totals equal product-line sums, with useful nonduplicated baseline', () => {
  const s = createWorkspace('owner-a');
  for (const o of s.orders) assert.equal(o.total, calculateOrderTotal(o.items));
  assert.equal(summarize(s).achieved, 5650200);
  assert.equal(summarize(s).collections, 1150000);
  assert.equal(summarize(s).outstanding, 4650200);
  assert.equal(summarize(s).advances, 150000);
  assert.equal(summarize(s, 'Q1').achieved, 2000000);
  assert.equal(summarize(s, 'Q2').achieved, 3150000);
  assert.equal(summarize(s, 'Q3').achieved, 500200);
  assert.equal(summarize(s, 'Q4').achieved, 0);
});
test('onboarding validates required fields, fixed ownership, duplicate registration and safe allowlist', () => {
  assert.equal(Object.keys(doctorErrors({})).length, 6);
  assert.ok(doctorErrors({ ...doctor, email: 'bad' }).email);
  assert.ok(doctorErrors({ ...doctor, phone: 'bad' }).phone);
  const initial = createWorkspace('owner-a');
  const s = addDoctor(initial, { ...doctor, owner: 'attacker', patientName: 'excluded' });
  assert.equal(initial.doctors.length, 3);
  assert.equal(s.doctors.at(-1).owner, 'owner-a');
  assert.equal(s.doctors.at(-1).patientName, undefined);
  assert.deepEqual(s.achievements, ['onboarding']);
  assert.throws(() => addDoctor(s, doctor), /already exists/);
  const next = addDoctor(s, { ...doctor, registration: 'DEMO-SECOND' });
  assert.deepEqual(next.achievements, ['onboarding']);
});
test('new doctors immediately support own-doctor order choices and advances', () => {
  let s = addDoctor(createWorkspace('owner-a'), doctor);
  const id = s.doctors.at(-1).id;
  s = saveOrder(s, { ...orderInput, doctorId: id }, true);
  s = recordPayment(s, { ...payment, doctorId: id, orderId: null, kind: 'advance' });
  assert.equal(s.orders.at(-1).doctorId, id);
  assert.equal(s.payments.at(-1).doctorId, id);
  assert.equal(s.payments.at(-1).orderId, null);
});
test('draft edits and placement count sales exactly once; payments never count', () => {
  const initial = createWorkspace('owner-a');
  let s = saveOrder(initial, orderInput);
  const id = s.orders.at(-1).id;
  assert.equal(summarize(s).achieved, summarize(initial).achieved);
  assert.deepEqual(s.achievements, []);
  s = saveOrder(s, { ...orderInput, items: [{ productId: 'demo-kit', quantity: 4 }] }, false, id);
  s = saveOrder(s, s.orders.at(-1), true, id);
  assert.equal(summarize(s, 'Q3').achieved, 1000400);
  assert.equal(s.orders.filter((o) => o.id === id).length, 1);
  assert.deepEqual(s.achievements, ['first-order']);
  assert.throws(() => saveOrder(s, orderInput, true, id), /Only an existing/);
  const p = recordPayment(s, payment);
  assert.equal(summarize(p).achieved, summarize(s).achieved);
  const cancelled = { ...s, orders: s.orders.map((o) => o.id === id ? { ...o, status: 'cancelled' } : o) };
  assert.equal(summarize(cancelled).achieved, summarize(initial).achieved);
});
test('order input rejects foreign doctors, invalid products, duplicates and nonwhole quantities', () => {
  const s = createWorkspace('owner-a');
  assert.throws(() => saveOrder(s, { ...orderInput, doctorId: 'foreign' }));
  assert.throws(() => saveOrder({ ...s, doctors: s.doctors.map((d) => ({ ...d, owner: 'other' })) }, orderInput));
  for (const quantity of [0, -1, 0.1, 10000, '1.0', '1e2', '+1', '01', '1.5', '']) {
    assert.throws(() => saveOrder(s, { ...orderInput, items: [{ productId: PRODUCTS[0].id, quantity }] }));
  }
  assert.throws(() => saveOrder(s, { ...orderInput, items: [] }));
  assert.throws(() => saveOrder(s, { ...orderInput, items: [{ productId: 'unknown', quantity: 1 }] }));
  assert.throws(() => saveOrder(s, { ...orderInput, items: [orderInput.items[0], orderInput.items[0]] }));
});
test('advance, partial and full ledger preserves exact balances and labels', () => {
  let s = createWorkspace('owner-a');
  const order = s.orders.find((o) => o.id === payment.orderId);
  assert.equal(orderPaymentStatus(s, order), 'Unpaid');
  const baseline = summarize(s);
  s = recordPayment(s, { ...payment, kind: 'advance', amount: '50.01', orderId: order.id });
  assert.equal(s.payments.at(-1).orderId, null);
  assert.equal(orderBalance(s, order), order.total);
  assert.equal(summarize(s).outstanding, baseline.outstanding);
  s = recordPayment(s, payment);
  assert.equal(orderBalance(s, order), order.total - 10025);
  assert.equal(orderPaymentStatus(s, order), 'Partial');
  const balance = orderBalance(s, order);
  s = recordPayment(s, { ...payment, kind: 'full', amount: (balance / 100).toFixed(2) });
  assert.equal(orderBalance(s, order), 0);
  assert.equal(orderPaymentStatus(s, order), 'Paid');
  assert.equal(summarize(s).collections, baseline.collections + 5001 + order.total);
  assert.equal(summarize(s).outstanding, baseline.outstanding - order.total);
  assert.throws(() => recordPayment(s, payment), /remaining payable/);
});
test('payments reject zero, overbalance, malformed, draft, mismatched and invalid calendar values', () => {
  const s = createWorkspace('owner-a');
  for (const amount of ['0', '-1', '1.001', '5002', '5002.01']) assert.throws(() => recordPayment(s, { ...payment, amount }));
  assert.throws(() => recordPayment(s, { ...payment, kind: 'full', amount: '1.00' }));
  assert.throws(() => recordPayment(s, { ...payment, orderId: 'demo-order-d', doctorId: 'demo-doctor-a' }));
  assert.throws(() => recordPayment(s, { ...payment, doctorId: 'demo-doctor-a' }));
  for (const date of ['2026-02-30', '2026-10-17', '2026-10-15', '', 'bad']) assert.throws(() => recordPayment(s, { ...payment, date }));
  assert.throws(() => recordPayment(s, { ...payment, method: 'Card number' }));
  assert.throws(() => recordPayment(s, { ...payment, kind: 'unknown' }));
});
test('milestones are stable at thresholds and overachievement caps only fill', () => {
  const s = createWorkspace('owner-a');
  for (const [percentage, next] of [[0, 25], [25, 50], [50, 75], [75, 100], [100, null], [125, null]]) {
    const nextState = { ...s, orders: [{ ...s.orders[0], total: 12000000 * percentage / 100 }] };
    const stats = summarize(nextState);
    assert.equal(stats.percentage, percentage);
    assert.equal(stats.nextMilestone, next);
    assert.equal(stats.fill, Math.min(100, percentage));
    assert.equal(stats.milestones.filter((m) => m.reached).length, Math.min(4, Math.floor(percentage / 25)));
    assert.equal(stats.remaining, Math.max(0, 12000000 - stats.achieved));
  }
  const outside = { ...s, orders: [{ ...s.orders[0], date: '2027-04-01' }] };
  assert.equal(summarize(outside).achieved, 0);
  assert.throws(() => summarize(s, 'unknown'));
});
test('new workspace resets mutations and owners independently; schema has no patient contract or persistence', () => {
  const a = addDoctor(createWorkspace('owner-a'), doctor);
  const reset = createWorkspace('owner-a');
  const other = createWorkspace('owner-b');
  assert.equal(reset.doctors.length, 3);
  assert.equal(other.doctors.length, 3);
  assert.equal(a.doctors.length, 4);
  assert.equal(other.doctors[0].owner, 'owner-b');
  assert.deepEqual(reset.achievements, []);
  assert.deepEqual(reset, createWorkspace('owner-a'));
  const serial = JSON.stringify(reset);
  assert.doesNotMatch(serial, /patient|clinical|DOB|caseId|caseCode/i);
  const code = readFileSync(new URL('./mrWorkspaceDemo.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /\bfetch\s*\(|localStorage|sessionStorage|indexedDB|serverPatients|kitsOrdersDemo/);
  for (const event of a.activity) assert.match(event.href, /^\/mr\/(?:doctors|orders|payments)(?:\/|$)/);
});
