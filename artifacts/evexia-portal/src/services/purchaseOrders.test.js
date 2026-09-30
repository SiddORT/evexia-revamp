import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLERGEN_KEY } from './allergens.js';
import { VENDOR_KEY } from './vendors.js';
import { STORAGE_LOCATION_KEY } from './storageLocations.js';
import {
  PO_KEY, calculateLine, totals, money, loadPOSnapshot, loadPOs, validatePO,
  createPO, updatePO, deletePO, filterPOs, poEventActor, seedSamplePOs,
} from './purchaseOrders.js';

function storage() {
  const map = new Map();
  return { getItem: (key) => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
}
test.beforeEach(() => {
  globalThis.window = { localStorage: storage() };
  window.localStorage.setItem(PO_KEY, JSON.stringify({ version: 1, revision: 0, orders: [], events: [] }));
});
const draft = (refs, changes = {}) => ({
  poDate: '2026-09-30', expectedDate: '2026-10-01', vendorId: refs.vendors[0].id,
  locationId: refs.locations[0].id,
  lines: [{ productId: refs.products[0].id, quantity: '1', unitPrice: '100.01', gst: '12' }],
  ...changes,
});
test('seeds sample orders, changes and analytics events only when PO storage is absent', () => {
  window.localStorage.removeItem(PO_KEY);
  const snapshot = loadPOSnapshot();
  assert.equal(snapshot.record.orders.length, 5);
  assert.equal(snapshot.record.orders.filter((order) => order.status === 'open').length, 4);
  assert.deepEqual(snapshot.record.events.map((event) => event.action),
    ['created', 'created', 'created', 'created', 'created', 'updated', 'deleted']);
  assert.ok(snapshot.record.events.every((event) => poEventActor(event) === 'Sample Admin (demo data)'));
  assert.ok(snapshot.record.orders.some((order) => order.lines.length === 2));
  assert.deepEqual(loadPOs(), snapshot.record);
  const totalsByVendor = new Map();
  snapshot.record.orders.filter((order) => order.status === 'open').forEach((order) =>
    totalsByVendor.set(order.vendorId, (totalsByVendor.get(order.vendorId) || 0) + order.total));
  assert.equal(totalsByVendor.size, 2);
  assert.ok([...totalsByVendor.values()].every((value) => value > 0));
  const created = createPO(snapshot, snapshot.refs, draft(snapshot.refs));
  assert.equal(created.orders.length, 6);
  assert.equal(created.events.length, 8);
});
test('preserves an existing empty PO record instead of repopulating samples', () => {
  const snapshot = loadPOSnapshot();
  assert.deepEqual(snapshot.record, { version: 1, revision: 0, orders: [], events: [] });
  const seeded = seedSamplePOs(snapshot);
  assert.equal(seeded.orders.length, 5);
  assert.deepEqual(loadPOs(), seeded);
  assert.throws(() => seedSamplePOs(snapshot), /another tab/);
  assert.throws(() => seedSamplePOs({ ...snapshot, record: seeded }), /empty purchase order list/);
});
test('calculates at line paise precision then adds rounded line totals', () => {
  assert.deepEqual(calculateLine({ quantity: '0.333', unitPrice: '1.01', gst: '12.5' }),
    { subtotal: 34, gstAmount: 4, total: 38 });
  assert.deepEqual(totals([
    { quantity: 1, unitPrice: 0.05, gst: 5 },
    { quantity: 1, unitPrice: 0.05, gst: 5 },
  ]), { subtotal: 10, gstAmount: 0, total: 10 });
  assert.match(money(123456), /1,234\.56/);
  assert.equal(calculateLine({ quantity: '1', unitPrice: '1.001', gst: '12' }), null);
  assert.equal(calculateLine({ quantity: '1000000', unitPrice: '10000000', gst: '100' }), null);
});
test('validates dates, selected masters, line inputs and shape without silently coercing', () => {
  const { refs } = loadPOSnapshot();
  const good = draft(refs);
  assert.deepEqual(validatePO(good, refs).errors, {});
  const bad = draft(refs, { poDate: '2026-02-30', expectedDate: 'not-a-date', vendorId: 'unknown',
    locationId: refs.locations.find((l) => l.status === 'inactive').id,
    lines: [{ productId: refs.products.find((p) => p.status === 'inactive').id, quantity: 0,
      unitPrice: -1, gst: 101 }] });
  const errors = validatePO(bad, refs).errors;
  for (const key of ['poDate', 'expectedDate', 'vendorId', 'locationId', 'lines.0.productId',
    'lines.0.quantity', 'lines.0.unitPrice', 'lines.0.gst']) assert.ok(errors[key], key);
  assert.ok(validatePO(draft(refs, { lines: [] }), refs).errors.lines);
  assert.ok(validatePO(draft(refs, { expectedDate: '2026-09-29' }), refs).errors.expectedDate);
  assert.ok(validatePO({ ...good, actor: 'fake' }, refs).errors.form);
});
test('persists creation, change summaries and soft deletion atomically across reloads', () => {
  const snapshot = loadPOSnapshot();
  const created = createPO(snapshot, snapshot.refs, draft(snapshot.refs));
  const first = created.orders[0];
  assert.equal(first.number.startsWith('PO-20260930-'), true);
  assert.equal(first.total, 11201);
  assert.deepEqual(created.events.map((e) => e.action), ['created']);
  const edited = updatePO({ ...snapshot, record: created }, snapshot.refs, first.id,
    draft(snapshot.refs, { expectedDate: '2026-10-04', lines: [{ ...draft(snapshot.refs).lines[0], quantity: '2' }] }));
  assert.match(edited.events[1].summary, /expected delivery.*items or pricing changed/);
  assert.equal(edited.orders[0].number, first.number);
  const deleted = deletePO({ record: edited }, first.id);
  assert.equal(deleted.orders[0].status, 'deleted');
  assert.deepEqual(loadPOs(), deleted);
  assert.deepEqual(deleted.events.map((e) => e.action), ['created', 'updated', 'deleted']);
  assert.deepEqual(deleted.events.map((e) => e.actor), Array(3).fill('Demo Admin (local, not signed in)'));
  assert.ok(deleted.events[0].at < deleted.events[1].at && deleted.events[1].at < deleted.events[2].at);
  assert.throws(() => updatePO({ record: deleted }, snapshot.refs, first.id, draft(snapshot.refs)), /deleted/);
  assert.throws(() => deletePO({ record: deleted }, first.id), /deleted/);
  assert.deepEqual(loadPOs(), deleted);
});
test('keeps existing events without actor attribution and does not invent a real actor', () => {
  const snapshot = loadPOSnapshot();
  const created = createPO(snapshot, snapshot.refs, draft(snapshot.refs));
  const old = { ...created, events: created.events.map(({ actor, ...event }) => event) };
  window.localStorage.setItem(PO_KEY, JSON.stringify(old));
  assert.equal(poEventActor(loadPOs().events[0]), 'Not recorded (earlier activity)');
  const edited = updatePO({ ...snapshot, record: old }, snapshot.refs, old.orders[0].id,
    draft(snapshot.refs, { expectedDate: '2026-10-03' }));
  assert.equal(poEventActor(edited.events[0]), 'Not recorded (earlier activity)');
  assert.equal(poEventActor(edited.events[1]), 'Demo Admin (local, not signed in)');
  window.localStorage.setItem(PO_KEY, JSON.stringify({ ...edited,
    events: edited.events.map((event, index) => index === 1 ? { ...event, actor: '' } : event) }));
  assert.throws(() => loadPOs(), /unreadable/);
});
test('saved names and figures remain historical when masters change; new inactive references are blocked', () => {
  const snapshot = loadPOSnapshot();
  const created = createPO(snapshot, snapshot.refs, draft(snapshot.refs));
  const old = created.orders[0];
  for (const [key, id, field] of [[VENDOR_KEY, old.vendorId, 'vendorName'],
    [STORAGE_LOCATION_KEY, old.locationId, 'name'], [ALLERGEN_KEY, old.lines[0].productId, 'name']]) {
    const list = JSON.parse(window.localStorage.getItem(key));
    window.localStorage.setItem(key, JSON.stringify(list.map((item) => item.id === id ?
      { ...item, [field]: `Renamed ${item[field]}`, ...(key !== VENDOR_KEY ? { status: 'inactive' } : {}) } : item)));
  }
  assert.deepEqual(loadPOs().orders[0], old);
  const changedRefs = loadPOSnapshot().refs;
  assert.deepEqual(validatePO(draft(changedRefs), changedRefs, old).errors, {});
  assert.ok(validatePO(draft(changedRefs), changedRefs).errors.locationId);
  assert.ok(validatePO(draft(changedRefs), changedRefs).errors['lines.0.productId']);
  assert.throws(() => updatePO({ record: created }, snapshot.refs, old.id,
    draft(snapshot.refs, { expectedDate: '2026-10-05' })), /masters changed/);
  const updated = updatePO({ record: created }, changedRefs, old.id,
    draft(changedRefs, { expectedDate: '2026-10-05' }));
  assert.equal(updated.orders[0].vendorName, old.vendorName);
  assert.equal(updated.orders[0].locationName, old.locationName);
  assert.equal(updated.orders[0].lines[0].productName, old.lines[0].productName);
});
test('stale and unreadable storage prevent mutations and never overwrite broken data', () => {
  const snapshot = loadPOSnapshot();
  const created = createPO(snapshot, snapshot.refs, draft(snapshot.refs));
  assert.throws(() => createPO(snapshot, snapshot.refs, draft(snapshot.refs)), /another tab/);
  window.localStorage.setItem(PO_KEY, '{oops');
  assert.throws(() => loadPOs(), /unreadable/);
  assert.throws(() => deletePO({ record: created }, created.orders[0].id), /unreadable/);
  assert.equal(window.localStorage.getItem(PO_KEY), '{oops');
  window.localStorage = { getItem() { throw Error('denied'); } };
  assert.throws(() => loadPOs(), /unavailable/);
});
test('inclusive date, vendor, product, state and deterministic sorting support pagination', () => {
  let snapshot = loadPOSnapshot();
  const { refs } = snapshot;
  for (let i = 1; i <= 12; i++) {
    const record = createPO(snapshot, refs, draft(refs, {
      poDate: `2026-09-${String(i).padStart(2, '0')}`, expectedDate: '2026-10-01',
      vendorId: refs.vendors[i % 2].id, lines: [{ ...draft(refs).lines[0], productId: refs.products[i % 2].id }],
    }));
    snapshot = { ...snapshot, record };
  }
  assert.equal(filterPOs(snapshot.record.orders).length, 12);
  assert.equal(filterPOs(snapshot.record.orders)[0].poDate, '2026-09-12');
  const filtered = filterPOs(snapshot.record.orders, { from: '2026-09-03', to: '2026-09-09',
    vendorId: refs.vendors[1].id, productId: refs.products[1].id });
  assert.deepEqual(filtered.map((o) => o.poDate), ['2026-09-09', '2026-09-07', '2026-09-05', '2026-09-03']);
  assert.equal(filterPOs(snapshot.record.orders, { from: '2026-09-05', to: '2026-09-05' }).length, 1);
  assert.deepEqual(filterPOs(snapshot.record.orders, { sort: 'oldest' }).slice(5, 10).map((o) => o.poDate),
    ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']);
  const deleted = deletePO(snapshot, snapshot.record.orders[0].id);
  assert.equal(filterPOs(deleted.orders).length, 11);
  assert.equal(filterPOs(deleted.orders, { status: 'deleted' }).length, 1);
});