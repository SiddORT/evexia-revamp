import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DIAL_COUNTRIES, normalizePhone, internationalPhone } from './phoneCountries.js';

test('complete maintained JavaScript/Python region and calling-code parity', () => {
  const actual = JSON.parse(execFileSync('python3', ['-c',
    'import json; from app.schemas.phone import DIAL; print(json.dumps(DIAL))'],
  { env: { ...process.env, PYTHONPATH: 'artifacts/api-server/backend' } }).toString());
  assert.deepEqual(Object.fromEntries(DIAL_COUNTRIES.map(({ value, code }) => [value, code])), actual);
  assert.ok(DIAL_COUNTRIES.length > 240);
  assert.equal(new Set(DIAL_COUNTRIES.map(({ value }) => value)).size, DIAL_COUNTRIES.length);
  for (const row of DIAL_COUNTRIES) assert.ok(row.label.includes(row.name) && row.label.includes(row.code));
});

test('international national storage, shared-code identities and legacy policies agree', () => {
  const cases = [
    ['DE', '+49 30 123456', '30123456'], ['FR', '+33 1 23 45 67 89', '123456789'],
    ['CA', '+1 416 555 0123', '4165550123'], ['IT', '+39 02 12345678', '0212345678'],
    ['SG', '81234567', '81234567'], ['GG', '+44 1481 256789', '1481256789'],
  ];
  for (const master of ['doctor', 'patient', 'mr', 'staff', 'vendor']) {
    for (const [region, raw, expected] of cases) assert.equal(normalizePhone(raw, region, master), expected);
    assert.equal(normalizePhone('123', 'FR', master), null);
    assert.equal(normalizePhone('123', 'ZZ', master), null);
  }
  assert.equal(normalizePhone('4165550123', 'US', 'mr'), null);
  for (const master of ['doctor', 'patient', 'mr']) assert.equal(normalizePhone('1234567890', 'IN', master), '1234567890');
  for (const master of ['staff', 'vendor']) assert.equal(normalizePhone('1234567890', 'IN', master), null);
  assert.equal(internationalPhone({ dialCountry: 'FR', phone: '123456789' }), '+33123456789');
  assert.equal(internationalPhone({ dialCountry: 'FR', phone: '' }), '');
});

test('every maintained region has a usable example matching server validation', () => {
  const examples = JSON.parse(execFileSync('python3', ['-c',
    'import json,phonenumbers as p; print(json.dumps([[r,p.national_significant_number(n)] for r in sorted(p.SUPPORTED_REGIONS) if (n:=(p.example_number_for_type(r,p.PhoneNumberType.MOBILE) or p.example_number(r))) and p.is_valid_number_for_region(n,r)]))']).toString());
  assert.equal(examples.length, DIAL_COUNTRIES.length);
  for (const [region, phone] of examples) {
    for (const master of ['doctor', 'patient', 'mr', 'staff', 'vendor']) {
      assert.equal(normalizePhone(phone, region, master), phone, `${master} ${region}`);
    }
  }
  assert.equal(normalizePhone('+1 2025550123', 'CA', 'mr'), null);
});
