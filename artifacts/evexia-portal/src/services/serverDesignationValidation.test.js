import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateServerDesignation } from './serverDesignationValidation.js';

test('decimal form values remain exact strings and blank defaults to zero', () => {
  const result = validateServerDesignation({ name: ' Example ', shortName: ' EX ', level: '1', status: 'active', basicDa: '0.10', hra: '999999999.99' });
  assert.deepEqual(result.errors, {});
  assert.equal(result.fields.basicDa, '0.10');
  assert.equal(result.fields.hra, '999999999.99');
  assert.equal(result.fields.professionalTax, '0');
  assert.equal(result.fields.level, 1);
});
test('forms reject excess precision, nonfinite/negative amounts and out-of-range levels', () => {
  for (const value of ['NaN', '-1', 'Infinity', '0.001', '1000000000']) {
    assert.ok(validateServerDesignation({ name: 'Example', shortName: 'EX', level: '1', status: 'active', basicDa: value }).errors.basicDa);
  }
  for (const level of ['0', '1.1', '2147483648']) {
    assert.ok(validateServerDesignation({ name: 'Example', shortName: 'EX', level, status: 'active' }).errors.level);
  }
});
