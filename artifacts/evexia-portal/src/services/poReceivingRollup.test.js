import test from 'node:test';
import assert from 'node:assert/strict';
import { rollupPOReceiving, createPRState } from './poReceivingRollup.js';

const po = { id: 'p', status: 'open', lines: [{ id: 'a', productId: 'x', productName: 'X', quantity: 10 }, { id: 'b', productId: 'x', productName: 'X', quantity: 0.3 }] };
const rc = (id, status, lines) => ({ id, poId: 'p', status, lines });
const l = (lineId, r, a) => ({ lineId, receivedQty: r, acceptedQty: a, rejectedQty: r - a });

test('rolls up active receipts per source line, rejected stays outstanding', () => {
  const r = rollupPOReceiving(po, [rc('1', 'active', [l('a', 10, 5)]), rc('2', 'deleted', [l('a', 5, 5)]), rc('3', 'active', [l('b', 0.1, 0.1), l('a', 0.1, 0.1)])]);
  assert.equal(r.lines[0].received, 10.1); assert.equal(r.lines[0].accepted, 5.1);
  assert.equal(r.lines[0].rejected, 5); assert.equal(r.lines[0].remaining, 4.9);
  assert.equal(r.lines[1].remaining, 0.2);
});
test('duplicate products stay distinct and no receipts leaves full remaining', () => {
  const r = rollupPOReceiving(po, []);
  assert.equal(r.lines.length, 2); assert.deepEqual(r.lines.map((x) => x.remaining), [10, 0.3]); assert.equal(r.totals, undefined);
});
test('create state', () => {
  assert.equal(createPRState(po, rollupPOReceiving(po, [])).enabled, true);
  const full = rollupPOReceiving(po, [rc('1', 'active', [l('a', 10, 10), l('b', 0.3, 0.3)])]);
  assert.equal(createPRState(po, full).enabled, false);
  assert.equal(createPRState({ ...po, status: 'deleted' }, rollupPOReceiving(po, [])).enabled, false);
});
test('invalid quantities throw', () => {
  assert.throws(() => rollupPOReceiving(po, [rc('1', 'active', [{ lineId: 'a', receivedQty: 'x', acceptedQty: 1, rejectedQty: 0 }])]), /Invalid quantity/);
  assert.throws(() => rollupPOReceiving({ ...po, lines: [{ id: 'a', quantity: '' }] }, []), /Invalid quantity/);
});
