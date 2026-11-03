import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveConfiguration } from './reserveDilution.js';
const lot = { available: '100.000', concentration: '5', unit: 'ml' };
test('exact unitless and explicit percent examples for every approved factor', () => {
  for (const [factor, concentration] of [[2, '2.5'], [5, '1'], [10, '0.5']]) {
    for (const suffix of ['', '%']) {
      const result = reserveConfiguration({ ...lot, concentration: '5' + suffix }, { quantity: '100', dilute: true, factor });
      assert.deepEqual(result, { errors: {}, output: { quantity: String(100 * factor), concentration: concentration + suffix } });
    }
  }
});
test('descriptive No transfers stay readable and unchanged', () => {
  const result = reserveConfiguration({ ...lot, concentration: 'Legacy concentrate', unit: 'legacy units' }, { quantity: '10', dilute: false });
  assert.deepEqual(result, { errors: {}, output: { quantity: '10', concentration: 'Legacy concentrate' } });
});
test('unsupported, excessive and inexact configurations cannot apply', () => {
  for (const concentration of ['Legacy', '0', '101%', '0.000001', '5.0000001', '1000']) {
    assert.ok(reserveConfiguration({ ...lot, concentration }, { quantity: '10', dilute: true, factor: 10 }).errors.dilute);
  }
  assert.ok(reserveConfiguration(lot, { quantity: '10', dilute: null }).errors.dilute);
  assert.ok(reserveConfiguration(lot, { quantity: '101', dilute: false }).errors.quantity);
  assert.ok(reserveConfiguration(lot, { quantity: '1.0001', dilute: false }).errors.quantity);
  assert.ok(reserveConfiguration({ ...lot, available: '1000000' }, { quantity: '100001', dilute: true, factor: 10 }).errors.quantity);
  assert.ok(reserveConfiguration(lot, { quantity: '10', dilute: true, factor: 3 }).errors.dilute);
});
