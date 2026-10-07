import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSnapshot, createMoveStocksStore, validateMovement } from './moveStocksDemo.js';

const draft = (overrides = {}) => ({
  sourceId: 'demo-warehouse', destinationId: 'demo-clinic', date: '2026-10-07',
  deliveredBy: ' Demo operator ', lines: [{ productId: 'demo-dust', quantity: '4' }], ...overrides,
});

test('demo stock is independent, immutable and resets with a new session store', () => {
  const a = createMoveStocksStore(), b = createMoveStocksStore();
  a.submitMovement(draft(), 'one');
  assert.equal(a.getSnapshot().balances['demo-warehouse']['demo-dust'], 44);
  assert.equal(b.getSnapshot().balances['demo-warehouse']['demo-dust'], 48);
  assert.throws(() => { a.getSnapshot().movements[0].sourceName = 'Changed'; }, TypeError);
});

test('multiple products debit and credit atomically with immutable history labels', () => {
  const store = createMoveStocksStore();
  const before = store.getSnapshot();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  const result = store.submitMovement(draft({ destinationId: 'demo-empty', lines: [
    { productId: 'demo-dust', quantity: '48' }, { productId: 'demo-mould', quantity: '3' },
  ] }), 'one');
  assert.deepEqual(result.errors, {});
  assert.equal(store.getSnapshot().balances['demo-warehouse']['demo-dust'], 0);
  assert.equal(store.getSnapshot().balances['demo-empty']['demo-dust'], 48);
  assert.equal(store.getSnapshot().balances['demo-warehouse']['demo-mould'], 12);
  assert.equal(store.getSnapshot().balances['demo-empty']['demo-mould'], 3);
  assert.equal(before.balances['demo-warehouse']['demo-dust'], 48);
  assert.equal(result.movement.sourceName, 'Demo Main Warehouse');
  assert.equal(result.movement.deliveredBy, 'Demo operator');
  assert.equal(result.movement.lines[1].unit, 'bottles');
  assert.equal(notifications, 1);
  unsubscribe();
});

test('same submission is applied once even if repeated with different inputs', () => {
  const store = createMoveStocksStore();
  const first = store.submitMovement(draft(), 'same');
  const saved = store.getSnapshot();
  assert.equal(store.submitMovement(draft({ lines: [] }), 'same').movement, first.movement);
  assert.equal(store.getSnapshot(), saved);
  assert.equal(saved.movements.length, 2);
});

test('invalid quantities never mutate balances or history', () => {
  for (const quantity of ['', ' ', '0', '-2', 'NaN', 'Infinity', Infinity, NaN, '49', '0.5', null, {}, '1e999']) {
    const store = createMoveStocksStore(), before = store.getSnapshot();
    const result = store.submitMovement(draft({ lines: [{ productId: 'demo-dust', quantity }] }), 'one');
    assert.ok(result.errors['quantity.demo-dust'], String(quantity));
    assert.equal(store.getSnapshot(), before);
  }
});

test('missing and identical locations, no selections and invalid metadata are rejected', () => {
  const snapshot = createDemoSnapshot();
  for (const [overrides, field] of [
    [{ sourceId: '' }, 'sourceId'], [{ destinationId: '' }, 'destinationId'],
    [{ destinationId: 'demo-warehouse' }, 'destinationId'], [{ lines: [] }, 'lines'],
    [{ date: '' }, 'date'], [{ date: '2026-02-30' }, 'date'],
    [{ deliveredBy: ' ' }, 'deliveredBy'], [{ deliveredBy: 'x'.repeat(81) }, 'deliveredBy'],
    [{ sourceId: 'demo-empty' }, 'quantity.demo-dust'],
  ]) assert.ok(validateMovement(snapshot, draft(overrides)).errors[field], field);
});

test('duplicate and unknown product lines are rejected atomically, latest stock is validated', () => {
  const store = createMoveStocksStore(), before = store.getSnapshot();
  for (const lines of [
    [{ productId: 'unknown', quantity: '1' }],
    [{ productId: 'demo-dust', quantity: '1' }, { productId: 'demo-dust', quantity: '1' }],
  ]) {
    assert.ok(Object.keys(store.submitMovement(draft({ lines }), 'invalid').errors).length);
    assert.equal(store.getSnapshot(), before);
  }
  store.submitMovement(draft({ lines: [{ productId: 'demo-dust', quantity: 47 }] }), 'first');
  assert.ok(store.submitMovement(draft(), 'second').errors['quantity.demo-dust']);
  assert.equal(store.getSnapshot().movements.length, 2);
});
