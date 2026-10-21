import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIAL_COUNTRIES, normalizePhone, internationalPhone } from './phoneCountries.js';

const backendPath = fileURLToPath(new URL('../../../api-server/backend', import.meta.url));

function backendPythonEnvironment(environment = process.env) {
  // CI exposes locked packages through PYTHONPATH, not global site-packages.
  // Do not append a separator for absent/empty values: it adds a cwd entry.
  return {
    ...environment,
    PYTHONPATH: [backendPath, environment.PYTHONPATH].filter(Boolean).join(delimiter),
  };
}

test('complete maintained JavaScript/Python region and calling-code parity', () => {
  const actual = JSON.parse(execFileSync('python3', ['-c',
    'import json; from app.schemas.phone import DIAL; print(json.dumps(DIAL))'],
  { env: backendPythonEnvironment() }).toString());
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

test('backend Python environment preserves dependency paths without adding cwd entries', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'phone-python-path-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packagePaths = [join(root, 'locked packages'), join(root, 'additional packages')];
  for (const [index, path] of packagePaths.entries()) {
    mkdirSync(path);
    writeFileSync(join(path, `phone_path_probe_${index}.py`), `VALUE = ${index}\n`);
  }

  for (const [name, inherited] of [
    ['inherited package locations', packagePaths.join(delimiter)],
    ['missing PYTHONPATH', undefined],
    ['empty PYTHONPATH', ''],
  ]) {
    await t.test(name, () => {
      const environment = { ...process.env, PHONE_PATH_SENTINEL: 'preserved' };
      delete environment.PYTHONPATH;
      if (inherited !== undefined) environment.PYTHONPATH = inherited;
      const childEnvironment = backendPythonEnvironment(environment);
      const expected = [backendPath, ...(inherited ? packagePaths : [])];
      assert.deepEqual(childEnvironment.PYTHONPATH.split(delimiter), expected);
      assert.equal(environment.PYTHONPATH, inherited, 'must not mutate the parent environment');

      // -S removes global packages and Replit startup hooks; -P removes Python's
      // implicit cwd entry so an empty PYTHONPATH component cannot go unnoticed.
      const actual = JSON.parse(execFileSync('python3', ['-S', '-P', '-c', `
import json, os, sys
import app.schemas
${inherited ? 'import phone_path_probe_0, phone_path_probe_1\nassert (phone_path_probe_0.VALUE, phone_path_probe_1.VALUE) == (0, 1)' : ''}
assert sys.flags.no_site
assert os.environ["PHONE_PATH_SENTINEL"] == "preserved"
print(json.dumps({"schema": app.schemas.__file__, "paths": sys.path}))
`], { env: childEnvironment, cwd: root }).toString());
      assert.equal(actual.schema, join(backendPath, 'app', 'schemas', '__init__.py'));
      assert.deepEqual(actual.paths.slice(0, expected.length), expected);
      assert.ok(!actual.paths.includes('') && !actual.paths.includes(root));
    });
  }

  await t.test('missing dependencies still fail closed', () => {
    const child = spawnSync('python3', ['-S', '-P', '-c', 'from app.schemas.phone import DIAL'], {
      env: backendPythonEnvironment({ ...process.env, PYTHONPATH: '' }),
      cwd: root,
      encoding: 'utf8',
    });
    assert.ifError(child.error);
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /ModuleNotFoundError: No module named 'phonenumbers'/);
  });
});
