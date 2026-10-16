import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import * as demo from './doctorStore.js';
import { readFileSync, readdirSync } from 'node:fs';

afterEach(() => demo.resetDemo());
const snapshot = demo.getSnapshot;
const newPatient = () => demo.addPatient({ name: 'Sample River', age: 31, email: 'river@example.invalid', notes: 'Initial fictional visit only.' });
const newOrder = (patch = {}) => demo.addOrder({ patientId: 'patient-1', items: [{ productId: 'sample-diary', quantity: 3 }], status: 'Placed', requestId: 'order-submit', ...patch });
const pay = (orderId, amount, requestId = 'pay-submit') => demo.addPayment({ orderId, amount, requestId, date: demo.today() });

test('seed relationships, immutable snapshots and derived dashboard agree', () => {
  const s = snapshot();
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.orders[0].items[0]));
  for (const row of [...s.tests, ...s.doses, ...s.orders]) assert.ok(s.patients.some((p) => p.id === row.patientId));
  for (const row of s.payments) assert.ok(s.orders.some((o) => o.id === row.orderId));
  assert.ok(s.patients.every((p) => p.doctorId === demo.doctor.id));
  assert.equal(demo.dashboard(s).outstandingMinor, 75050);
  assert.equal(demo.dashboard(s).patientCount, 3);
  assert.equal(demo.dashboard(s).activeOrders.length, 1);
  assert.equal(demo.dashboard(s).overdueDoses.length, 1);
  assert.equal(demo.dashboard(s).upcomingDoses.length, 2);
  assert.throws(() => { s.patients[0].name = 'overwrite'; }, TypeError);
});

test('patient add fixes ownership, validates fictional identity and seeds no treatment', () => {
  const p = newPatient();
  assert.equal(p.doctorId, demo.doctor.id);
  assert.equal(demo.dashboard().patientCount, 4);
  assert.equal(demo.patientHistory(p.id).length, 1);
  for (const kind of ['tests', 'doses', 'orders']) assert.equal(snapshot()[kind].filter((row) => row.patientId === p.id).length, 0);
  assert.throws(() => demo.addPatient({ name: 'Sample', age: 121 }));
  assert.throws(() => demo.addPatient({ name: 'Sample', age: '3.1' }));
  assert.throws(() => demo.addPatient({ name: 'Sample', age: 20, email: 'real@company.com' }), /fictional/);
  assert.equal(demo.patientHistory('missing').length, 0);
});

test('tests link to the same patient history with explicit units and no interpretation', () => {
  const p = newPatient();
  const input = { patientId: p.id, date: demo.today(), type: 'Sample skin prick', allergen: 'Sample pollen', result: '2', unit: 'mm', positiveControl: '5', negativeControl: '0' };
  const saved = demo.addTest(input);
  assert.equal(demo.patientHistory(p.id).find((entry) => entry.id === saved.id).href, `/doctor/tests/${saved.id}`);
  const rows = demo.reportRows('tests', snapshot(), { patientId: p.id, from: demo.today(), to: demo.today() });
  assert.equal(rows.length, 1);
  assert.match(rows[0].detail, /2 mm/);
  assert.match(rows[0].detail, /no diagnostic interpretation/);
  assert.throws(() => demo.addTest({ ...input, patientId: 'missing' }));
  assert.throws(() => demo.addTest({ ...input, date: '2026-02-30' }));
  assert.throws(() => demo.addTest({ ...input, unit: '' }));
});

test('manual schedule, reminders and completion preserve original dates and publish once', () => {
  const p = newPatient();
  const d = demo.addDose({ patientId: p.id, scheduledDate: '2026-01-01', details: 'Sample vial · 0.1 mL · manually entered', reminderDate: '2025-12-31' });
  assert.equal(demo.doseStatus(d), 'Overdue');
  demo.setReminder(d.id, '2026-01-02');
  assert.equal(snapshot().doses.find((x) => x.id === d.id).scheduledDate, '2026-01-01');
  let notifications = 0;
  const unsubscribe = demo.subscribe(() => notifications++);
  const completed = demo.completeDose(d.id, demo.today());
  assert.equal(completed.scheduledDate, '2026-01-01');
  assert.equal(completed.completedDate, demo.today());
  assert.equal(demo.doseStatus(completed), 'Completed');
  assert.equal(demo.completeDose(d.id, '2026-01-03'), completed);
  assert.equal(notifications, 1);
  unsubscribe();
  assert.equal(demo.patientHistory(p.id).filter((h) => h.id.startsWith(d.id)).length, 2);
  assert.throws(() => demo.setReminder(d.id, demo.today()), /completed/);
  assert.throws(() => demo.completeDose('missing', demo.today()), /unavailable/);
});

test('money rejects nondecimal, excess precision and negative amounts before exact arithmetic', () => {
  for (const amount of ['-1', '-0', '1.001', '1e2', 'NaN', 'Infinity', '', '.5', '01.00', ' 1', '1,000', 1]) assert.throws(() => demo.parseMoney(amount));
  assert.equal(demo.parseMoney('1250.50'), 125050);
  assert.equal(demo.parseMoney('0.01'), 1);
  assert.equal(demo.parseMoney('1.1'), 110);
  assert.match(demo.money(55575), /555.75/);
  assert.throws(() => demo.money(1.1));
});

test('orders use exact catalogue minor units, whole quantities and idempotent submissions', () => {
  const order = newOrder();
  assert.equal(order.totalMinor, 55575);
  assert.equal(newOrder(), order);
  assert.equal(snapshot().orders.filter((o) => o.id === order.id).length, 1);
  assert.throws(() => newOrder({ patientId: 'patient-2' }), /different inputs/);
  for (const quantity of [0, -1, 1.5, '1e2', '01', 1000]) assert.throws(() => newOrder({ requestId: `invalid-${quantity}`, items: [{ productId: 'sample-diary', quantity }] }));
  assert.throws(() => newOrder({ requestId: 'missing-patient', patientId: 'missing' }));
  assert.throws(() => newOrder({ requestId: 'double-product', items: [{ productId: 'sample-diary', quantity: 1 }, { productId: 'sample-diary', quantity: 1 }] }));
});

test('drafts have no submitted balance, cannot be paid and place once without dosage inference', () => {
  const before = snapshot().doses;
  const draft = newOrder({ status: 'Draft' });
  assert.equal(demo.paymentStatus(draft), 'Draft');
  assert.equal(demo.orderBalance(draft), 0);
  assert.throws(() => pay(draft.id, '1.00'), /Drafts/);
  const placed = demo.placeDraft(draft.id);
  assert.equal(placed.status, 'Placed');
  assert.equal(placed.timeline.length, 2);
  assert.equal(demo.placeDraft(draft.id), placed);
  assert.equal(demo.orderBalance(placed), 55575);
  assert.equal(snapshot().doses, before);
});

test('partial and full demo payments share one ledger and leave fulfillment untouched', () => {
  const order = newOrder();
  assert.equal(demo.paymentStatus(order), 'Unpaid');
  const payment = pay(order.id, '100.10');
  assert.equal(pay(order.id, '100.10'), payment);
  assert.equal(demo.orderBalance(order), 45565);
  assert.equal(demo.paymentStatus(order), 'Partially paid');
  assert.equal(demo.dashboard().outstandingMinor, 75050 + 45565);
  for (const amount of ['455.66', '0', '-1', '1.001']) assert.throws(() => pay(order.id, amount, `invalid-${amount}`));
  pay(order.id, '455.65', 'second');
  assert.equal(demo.orderBalance(order), 0);
  assert.equal(demo.paymentStatus(order), 'Paid');
  assert.equal(snapshot().orders.find((o) => o.id === order.id).status, 'Placed');
  assert.equal(demo.dashboard().outstandingMinor, 75050);
  assert.equal(demo.reportRows('payments', snapshot(), { patientId: order.patientId }).filter((p) => p.detail.includes(order.id)).length, 2);
});

test('reports validate periods and filter patient, date and status inclusively', () => {
  const p = newPatient();
  const history = demo.reportRows('patients', snapshot(), { patientId: p.id, from: demo.today(), to: demo.today() });
  assert.equal(history.length, 1);
  assert.equal(history[0].patientId, p.id);
  assert.equal(demo.reportRows('doses', snapshot(), { status: 'Completed' }).length, 1);
  assert.equal(demo.reportRows('tests', snapshot(), { patientId: p.id }).length, 0);
  assert.throws(() => demo.reportRows('orders', snapshot(), { from: '2026-10-20', to: '2026-10-01' }), /From date/);
  assert.throws(() => demo.reportRows('unknown'));
});

test('review average follows exact selection; feedback is separate and validated', () => {
  assert.equal(demo.reviewAverage(), 14 / 3);
  assert.equal(demo.reviewAverage(demo.reviews.slice(0, 2)), 4.5);
  assert.equal(demo.reviewAverage([]), 0);
  const saved = demo.addFeedback({ category: 'Suggestion', rating: 4, message: 'A fictional portal feedback message.' });
  assert.equal(saved.rating, 4);
  assert.equal(snapshot().feedback.length, 1);
  assert.equal(demo.reviews.length, 3);
  assert.throws(() => demo.addFeedback({ category: 'Unsupported', message: 'A fictional message.' }));
  assert.throws(() => demo.addFeedback({ category: 'Issue', rating: 6, message: 'A fictional message.' }));
  assert.throws(() => demo.addFeedback({ category: 'Issue', message: 'short' }));
});

test('reset clears all session-only changes and submission references', () => {
  const p = newPatient();
  const order = newOrder();
  pay(order.id, '1.00');
  demo.resetDemo();
  assert.equal(snapshot().patients.length, 3);
  assert.equal(snapshot().patients.some((x) => x.id === p.id), false);
  assert.equal(snapshot().payments.length, 2);
  assert.equal(newOrder().totalMinor, order.totalMinor);
});

test('Doctor module has no business services, credential storage, traffic or tracking calls', () => {
  const dir = new URL('./', import.meta.url);
  const sources = readdirSync(dir).filter((name) => /\.(js|jsx)$/.test(name) && !name.includes('.test.'));
  for (const file of sources) {
    const code = readFileSync(new URL(file, dir), 'utf8');
    assert.doesNotMatch(code, /\b(?:localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|sendBeacon|recordPageVisit|recordLocalAction|loginAdmin|loginMr|logoutAdmin)\s*[.(]/, file);
    assert.doesNotMatch(code, /from ['"][^'"]*(?:services\/|adminSession|AdminLayout|activityTracker)/, file);
  }
});
