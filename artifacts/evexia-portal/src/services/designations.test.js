import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESIGNATION_KEY, createDesignation, updateDesignation, setDesignationStatus, loadDesignations,
  validateDesignation, exportDesignationCSV, designationCSVTemplate, reviewDesignationCSV, importDesignations,
} from './designations.js';

function storage() {
  const values = new Map();
  return { getItem: (key) => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, value) };
}
const designation = (name = 'Manager', overrides = {}) => ({
  name, shortName: 'MGR', level: 2, status: 'active', basicDa: 30, hra: 15,
  medicalAllowance: 5, travellingAllowance: 3, specialAllowance: 2, professionalTax: 200, ...overrides,
});
test.beforeEach(() => {
  globalThis.window = { localStorage: storage() };
  window.localStorage.setItem(DESIGNATION_KEY, '[]');
});

test('initializes only missing collections without replacing an intentionally empty or concurrently initialized one', () => {
  assert.deepEqual(loadDesignations(), []);
  window.localStorage = storage();
  assert.deepEqual(loadDesignations(), []);
  assert.equal(window.localStorage.getItem(DESIGNATION_KEY), '[]');
  window.localStorage = {
    getItem: (() => { let calls = 0; return () => ++calls === 1 ? null : '[]'; })(),
    setItem() { assert.fail('Must not replace concurrently initialized data'); },
  };
  assert.deepEqual(loadDesignations(), []);
});
test('validates required fields, unique names, whole-number levels, and nonnegative numeric amounts', () => {
  const saved = createDesignation([], designation());
  assert.equal(validateDesignation(designation('  manager '), saved).errors.name, 'Designation Name already exists.');
  assert.match(validateDesignation(designation(' ')).errors.name, /required/);
  assert.match(validateDesignation(designation('New', { shortName: '' })).errors.shortName, /required/);
  assert.match(validateDesignation(designation('New', { level: '1.5' })).errors.level, /whole number/);
  assert.match(validateDesignation(designation('New', { status: '' })).errors.status, /status/);
  assert.match(validateDesignation(designation('New', { hra: '-1', professionalTax: 'NaN' })).errors.hra, /non-negative/);
  assert.match(validateDesignation(designation('New', { professionalTax: 'NaN' })).errors.professionalTax, /non-negative/);
  assert.equal(validateDesignation(designation('New', { hra: '' })).fields.hra, 0);
  assert.match(validateDesignation({ ...designation('New'), createdAt: 'spoofed' }).errors.form, /unsupported/);
  assert.equal(loadDesignations().length, 1);
});
test('create, edit and status preserve creation audit while updating modification audit', () => {
  const initial = createDesignation([], designation());
  assert.equal(initial[0].createdBy, 'Admin User');
  assert.equal(initial[0].name, 'Manager');
  const edited = updateDesignation(initial, initial[0].id, designation('Director', { level: 1, hra: 20 }));
  assert.equal(edited[0].createdAt, initial[0].createdAt);
  assert.equal(edited[0].createdBy, initial[0].createdBy);
  assert.equal(edited[0].hra, 20);
  assert.ok(Date.parse(edited[0].updatedAt) > Date.parse(initial[0].updatedAt));
  const toggled = setDesignationStatus(edited, initial[0].id, 'inactive');
  assert.equal(toggled[0].createdAt, initial[0].createdAt);
  assert.ok(Date.parse(toggled[0].updatedAt) > Date.parse(edited[0].updatedAt));
  assert.equal(loadDesignations()[0].status, 'inactive');
  assert.throws(() => setDesignationStatus(toggled, initial[0].id, 'inactive'), /different valid status/);
});
test('CSV template and round trip include business fields but no IDs or audit fields', () => {
  const initial = createDesignation([], designation('=Executive,\n"Lead"', { shortName: '@CEO' }));
  const csv = exportDesignationCSV(initial);
  assert.match(designationCSVTemplate(), /Basic \+ DA/);
  assert.doesNotMatch(csv, /createdBy|createdAt|updatedBy|updatedAt/);
  assert.match(csv, /"'=Executive/);
  assert.match(csv, /"'@CEO"/);
  const entries = reviewDesignationCSV(csv, []);
  assert.deepEqual(entries[0].errors, []);
  assert.equal(entries[0].fields.name, '=Executive,\n"Lead"');
  assert.equal(entries[0].fields.hra, 15);
  window.localStorage.setItem(DESIGNATION_KEY, '[]');
  const imported = importDesignations(entries, []);
  assert.equal(imported[0].name, initial[0].name);
  assert.equal(imported[0].createdAt, imported[0].updatedAt);
});
test('CSV review reports row-level errors and duplicate names; invalid batches are atomic', () => {
  const header = designationCSVTemplate();
  const row = (name, short, level, status, amounts = '0,0,0,0,0,0') => `${name},${short},${level},${status},${amounts}\n`;
  const entries = reviewDesignationCSV(header + row('Field Rep', 'FR', 2, 'active') +
    row(' field rep ', 'FR2', 3, 'inactive') + row('Other', '', 'x', 'wrong', '-1,0,0,0,0,bad') + 'Too,Few\n', []);
  assert.match(entries[1].errors.join(' '), /already exists/);
  assert.ok(entries[2].errors.length >= 4);
  assert.match(entries[3].errors.join(' '), /Expected 10 columns/);
  assert.throws(() => importDesignations(entries, []), /errors/);
  assert.deepEqual(loadDesignations(), []);
  assert.throws(() => reviewDesignationCSV('Designation Name,Created By\nA,B\n', []), /headers/);
  assert.throws(() => reviewDesignationCSV(header + '"unclosed', []), /Malformed/);
  assert.match(reviewDesignationCSV(header + row('Manager', 'M', 1, 'active'), createDesignation([], designation()))[0].errors.join(' '), /already exists/);
});
test('import rechecks forged entries, duplicates and snapshot before one guarded write', () => {
  const row = 'First,F,1,active,0,0,0,0,0,0\n';
  const entries = reviewDesignationCSV(designationCSVTemplate() + row + 'Second,S,2,inactive,0,0,0,0,0,0\n', []);
  assert.throws(() => importDesignations([...entries, { ...entries[0] }], []), /Duplicate designation/);
  assert.deepEqual(loadDesignations(), []);
  const saved = importDesignations(entries, []);
  assert.equal(saved.length, 2);
  assert.equal(window.localStorage.getItem(DESIGNATION_KEY), JSON.stringify(saved));
  assert.throws(() => importDesignations(entries, []), /changed since review/);
  assert.throws(() => updateDesignation([], saved[0].id, designation()), /no longer available/);
});
test('corrupt or unavailable storage and failed writes are visible; stale edits never overwrite', () => {
  window.localStorage.setItem(DESIGNATION_KEY, '[{"name":"old"}]');
  assert.throws(() => loadDesignations(), /invalid/);
  assert.throws(() => createDesignation([], designation()), /invalid/);
  assert.equal(window.localStorage.getItem(DESIGNATION_KEY), '[{"name":"old"}]');
  window.localStorage = { getItem() { throw new Error('blocked'); } };
  assert.throws(() => loadDesignations(), /unavailable/);
  window.localStorage = { getItem: () => '[]', setItem() { throw new Error('quota'); } };
  assert.throws(() => createDesignation([], designation()), /could not be saved/);
  window.localStorage = storage();
  window.localStorage.setItem(DESIGNATION_KEY, '[]');
  const first = createDesignation([], designation());
  createDesignation(first, designation('Second'));
  assert.throws(() => updateDesignation(first, first[0].id, designation('Third')), /changed in another tab/);
  assert.throws(() => setDesignationStatus(first, first[0].id, 'inactive'), /changed in another tab/);
  assert.equal(loadDesignations().length, 2);
});