import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReserveShortcut } from './reserveShortcut.js';

const id = '00000000-0000-4000-8000-000000000001';
const balance = { locationId: 'source', locationName: 'Current source', quantity: '100.000' };
const record = { id, reserveOnly: true, locationId: 'original', locationBalances: [balance] };
const dependencies = (overrides = {}) => ({
  getReserve: async () => record,
  getLocations: async () => ({ items: [{ id: 'source' }], filtered: 1 }),
  pending: () => null, isCurrent: () => true, ...overrides,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('exact current source, not original location; multiple sources remain explicit options', async () => {
  const result = await resolveReserveShortcut([id], dependencies());
  assert.deepEqual(result, { reserveId: id, options: [{ value: 'source', label: 'Current source', quantity: '100.000' }] });
  const split = await resolveReserveShortcut([id], dependencies({
    getReserve: async () => ({ ...record, locationBalances: [balance, { ...balance, locationId: 'second', quantity: '5.000' }] }),
    getLocations: async () => ({ items: [{ id: 'source' }, { id: 'second' }], filtered: 2 }),
  }));
  assert.equal(split.options.length, 2);
  assert.equal('source' in split, false);
});
test('pending recovery blocks reads and is never changed', async () => {
  const pending = Object.freeze({ key: 'synthetic-pending' });
  await assert.rejects(resolveReserveShortcut([id], dependencies({
    pending: () => pending, getReserve: () => assert.fail('Must not fetch a replacement reserve'),
  })), /previous movement needs recovery/);
  assert.equal(pending.key, 'synthetic-pending');
  await assert.rejects(resolveReserveShortcut([id], dependencies({ pending: () => { throw new Error('Retry storage unavailable'); } })), /Retry storage unavailable/);
});
test('delayed detail and location responses cannot apply after navigation cancellation', async () => {
  for (const stage of ['detail', 'locations']) {
    const held = deferred();
    let current = true;
    const result = resolveReserveShortcut([id], dependencies({
      isCurrent: () => current,
      ...(stage === 'detail' ? { getReserve: () => held.promise } : { getLocations: () => held.promise }),
    }));
    await Promise.resolve();
    current = false;
    held.resolve(stage === 'detail' ? record : { items: [{ id: 'source' }], filtered: 1 });
    assert.equal(await result, null);
  }
});
test('pending recovery appearing during either delayed response blocks preselection', async () => {
  for (const stage of ['detail', 'locations']) {
    const held = deferred();
    let pending = null;
    const result = resolveReserveShortcut([id], dependencies({
      pending: () => pending,
      ...(stage === 'detail' ? { getReserve: () => held.promise } : { getLocations: () => held.promise }),
    }));
    await Promise.resolve();
    pending = { key: 'synthetic-arriving-pending' };
    held.resolve(stage === 'detail' ? record : { items: [{ id: 'source' }], filtered: 1 });
    await assert.rejects(result, /previous movement needs recovery/);
    assert.equal(pending.key, 'synthetic-arriving-pending');
  }
});
test('invalid, missing, mismatched, depleted and inaccessible reserves never choose another batch', async () => {
  for (const values of [[], ['bad'], [id, id]]) await assert.rejects(resolveReserveShortcut(values, dependencies()), /Invalid reserve/);
  await assert.rejects(resolveReserveShortcut([id], dependencies({ getReserve: async () => { throw new Error('Missing reserve'); } })), /Missing reserve/);
  for (const changed of [{ ...record, id: 'another-batch' }, { ...record, reserveOnly: false }])
    await assert.rejects(resolveReserveShortcut([id], dependencies({ getReserve: async () => changed })), /could not be verified/);
  for (const changed of [{ ...record, locationBalances: [] }, { ...record, locationBalances: [{ ...balance, quantity: '0.000' }] }])
    await assert.rejects(resolveReserveShortcut([id], dependencies({ getReserve: async () => changed })), /depleted/);
  await assert.rejects(resolveReserveShortcut([id], dependencies({ getLocations: async () => ({ items: [], filtered: 0 }) })), /accessible active source/);
});
