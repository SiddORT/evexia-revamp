import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateServerDesignation, DESIGNATION_COLUMNS } from './serverDesignationValidation.js';

test('live fields normalize retained metadata without transmitting legacy values', () => {
  const result = validateServerDesignation({ name: ' Example ', shortName: ' EX ', status: 'active', level: '1', basicDa: '0.10' });
  assert.deepEqual(result, { fields: { name: 'Example', shortName: 'EX', status: 'active' }, errors: {} });
  assert.deepEqual(DESIGNATION_COLUMNS.map(([key]) => key), ['name', 'shortName', 'status']);
});
test('required fields, lengths and status remain validated', () => {
  for (const [key, value] of [['name', ''], ['name', 'x'.repeat(201)], ['shortName', ''], ['shortName', 'x'.repeat(51)], ['status', 'bad']]) {
    assert.ok(validateServerDesignation({ name: 'Example', shortName: 'EX', status: 'active', [key]: value }).errors[key]);
  }
});
