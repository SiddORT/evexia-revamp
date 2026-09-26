import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDoctors, DOCTOR_STORAGE_KEY } from './doctors.js';
import {
  OPENING_BALANCE_KEY, loadOpeningBalances, loadOpeningBalanceSnapshots, validateOpeningBalance,
  createOpeningBalance, updateOpeningBalance, setOpeningBalanceStatus,
  openingBalanceCSVTemplate, exportOpeningBalanceCSV, reviewOpeningBalanceCSV, importOpeningBalances,
} from './openingBalances.js';

function storage() {
  const items = new Map();
  return { getItem: (key) => items.has(key) ? items.get(key) : null,
    setItem: (key, value) => items.set(key, value), removeItem: (key) => items.delete(key) };
}
const values = (doctorId, amount = '0', overrides = {}) => ({
  startYear: '2025', endYear: '2026', doctorId, amount, status: 'active', ...overrides,
});
test.beforeEach(() => { globalThis.window = { localStorage: storage() }; });

test('first visit seeds only recognizable sample doctors with positive, negative and zero examples', () => {
  const { records, doctors } = loadOpeningBalanceSnapshots();
  assert.equal(records.length, 3);
  assert.deepEqual(records.map((record) => record.amount), [1250.5, -480.25, 0]);
  assert.ok(records.every((record) => record.id.startsWith('sample-opening-balance-') &&
    doctors.some((doctor) => doctor.id === record.doctorId && doctor.name.startsWith('Sample Dr.'))));
  assert.deepEqual(loadOpeningBalances(), records);
  window.localStorage.setItem(OPENING_BALANCE_KEY, '[]');
  assert.deepEqual(loadOpeningBalanceSnapshots().records, []);
  window.localStorage.removeItem(OPENING_BALANCE_KEY);
  window.localStorage.setItem(DOCTOR_STORAGE_KEY, '[]');
  assert.deepEqual(loadOpeningBalanceSnapshots().records, []);
  assert.equal(window.localStorage.getItem(OPENING_BALANCE_KEY), '[]');
});

test('validates linked years, unique doctor/year, signed amounts and explicit status', () => {
  const doctors = loadDoctors();
  const doctorId = doctors[0].id;
  window.localStorage.setItem(OPENING_BALANCE_KEY, '[]');
  const first = createOpeningBalance([], doctors, values(doctorId, '-18.25'));
  assert.equal(first[0].amount, -18.25);
  assert.ok(validateOpeningBalance(values(doctorId), first, doctors).errors.doctorId);
  assert.deepEqual(validateOpeningBalance(values(doctorId, '0'), [], doctors).errors, {});
  for (const invalid of ['', 'Infinity', 'NaN', '1.234', '1e5', '9007199254740993', '--4']) {
    assert.ok(validateOpeningBalance(values(doctorId, invalid), [], doctors).errors.amount, invalid);
  }
  assert.ok(validateOpeningBalance(values(doctorId, '0', { endYear: '2027' }), [], doctors).errors.endYear);
  assert.ok(validateOpeningBalance(values(doctorId, '0', { doctorId: 'missing' }), [], doctors).errors.doctorId);
  assert.ok(validateOpeningBalance(values(doctorId, '0', { status: 'other' }), [], doctors).errors.status);
  assert.ok(validateOpeningBalance({ ...values(doctorId), createdBy: 'spoof' }, [], doctors).errors.form);
});

test('edit and status changes keep creation audit but advance update audit', () => {
  const doctors = loadDoctors();
  window.localStorage.setItem(OPENING_BALANCE_KEY, '[]');
  const created = createOpeningBalance([], doctors, values(doctors[0].id));
  const edited = updateOpeningBalance(created, doctors, created[0].id, values(doctors[0].id, '21.5'));
  const toggled = setOpeningBalanceStatus(edited, doctors, edited[0].id, 'inactive');
  assert.equal(toggled[0].createdAt, created[0].createdAt);
  assert.equal(toggled[0].createdBy, created[0].createdBy);
  assert.ok(Date.parse(edited[0].updatedAt) > Date.parse(created[0].updatedAt));
  assert.ok(Date.parse(toggled[0].updatedAt) > Date.parse(edited[0].updatedAt));
  assert.equal(loadOpeningBalances()[0].status, 'inactive');
  assert.throws(() => setOpeningBalanceStatus(toggled, doctors, toggled[0].id, 'inactive'), /different/);
});

test('CSV export is safe and round trips by registration number, not display name', () => {
  const doctors = loadDoctors();
  window.localStorage.setItem(OPENING_BALANCE_KEY, '[]');
  const saved = createOpeningBalance([], doctors, values(doctors[0].id, '-25.50'));
  const csv = exportOpeningBalanceCSV(saved, doctors);
  assert.match(openingBalanceCSVTemplate(), /Doctor Registration Number/);
  assert.match(csv, /"'-25.5"/);
  assert.doesNotMatch(csv, /createdBy|createdAt|doctorId|Sample Dr/);
  const entries = reviewOpeningBalanceCSV(csv, [], doctors);
  assert.deepEqual(entries[0].errors, []);
  assert.equal(entries[0].fields.doctorId, doctors[0].id);
  assert.equal(entries[0].fields.amount, -25.5);
  window.localStorage.setItem(OPENING_BALANCE_KEY, '[]');
  const imported = importOpeningBalances(entries, [], doctors);
  assert.equal(imported[0].amount, saved[0].amount);
  assert.notEqual(imported[0].id, saved[0].id);
});

test('CSV review rejects invalid rows, duplicates and missing or ambiguous doctors atomically', () => {
  const doctors = loadDoctors();
  window.localStorage.setItem(OPENING_BALANCE_KEY, '[]');
  const row = (registration, amount, end = 2026, status = 'active') => `2025,${end},${registration},${amount},${status}\n`;
  const csv = openingBalanceCSVTemplate() + row(doctors[0].registrationNumber, '12') +
    row(doctors[0].registrationNumber, '15') + row('MISSING', '1.234', 2028, 'bad') + 'too,few\n';
  const entries = reviewOpeningBalanceCSV(csv, [], doctors);
  assert.deepEqual(entries[0].errors, []);
  assert.match(entries[1].errors.join(' '), /already exist/);
  assert.ok(entries[2].errors.length >= 4);
  assert.match(entries[3].errors.join(' '), /Expected/);
  assert.throws(() => importOpeningBalances(entries, [], doctors), /Resolve every/);
  assert.deepEqual(loadOpeningBalances(), []);
  assert.match(reviewOpeningBalanceCSV(openingBalanceCSVTemplate() + row(doctors[0].registrationNumber, 1),
    [], [...doctors, { ...doctors[0], id: 'another' }])[0].errors.join(' '), /ambiguous/);
  assert.throws(() => reviewOpeningBalanceCSV('Bad,Header\nA,B', [], doctors), /headers/);
  assert.throws(() => reviewOpeningBalanceCSV(openingBalanceCSVTemplate() + '"unclosed', [], doctors), /Malformed/);
  assert.throws(() => importOpeningBalances([entries[0], entries[0]], [], doctors), /Duplicate/);
});

test('corrupt storage, stale balances and changed doctor snapshots block all writes', () => {
  const doctors = loadDoctors();
  window.localStorage.setItem(OPENING_BALANCE_KEY, '[]');
  const initial = createOpeningBalance([], doctors, values(doctors[0].id));
  assert.throws(() => createOpeningBalance([], doctors, values(doctors[1].id)), /changed in another tab/);
  const entries = reviewOpeningBalanceCSV(openingBalanceCSVTemplate() +
    `2026,2027,${doctors[1].registrationNumber},0,active\n`, initial, doctors);
  const modified = doctors.map((doctor, index) => index === 1 ? { ...doctor, name: 'Changed Doctor' } : doctor);
  window.localStorage.setItem(DOCTOR_STORAGE_KEY, JSON.stringify(modified));
  assert.throws(() => updateOpeningBalance(initial, doctors, initial[0].id, values(doctors[0].id, '1')), /Doctor Master changed/);
  assert.throws(() => setOpeningBalanceStatus(initial, doctors, initial[0].id, 'inactive'), /Doctor Master changed/);
  assert.throws(() => importOpeningBalances(entries, initial, doctors), /changed since review/);
  assert.equal(loadOpeningBalances()[0].amount, 0);
  window.localStorage.setItem(OPENING_BALANCE_KEY, 'broken');
  assert.throws(() => loadOpeningBalances(), /unreadable/);
  assert.throws(() => createOpeningBalance([], modified, values(doctors[0].id)), /unreadable/);
  assert.equal(window.localStorage.getItem(OPENING_BALANCE_KEY), 'broken');
  window.localStorage = { getItem() { throw new Error('blocked'); } };
  assert.throws(() => loadOpeningBalanceSnapshots(), /unavailable/);
});

test('missing doctor reference stays missing, never reassigns to another doctor', () => {
  const doctors = loadDoctors();
  window.localStorage.setItem(OPENING_BALANCE_KEY, '[]');
  const saved = createOpeningBalance([], doctors, values(doctors[0].id));
  window.localStorage.setItem(DOCTOR_STORAGE_KEY, JSON.stringify(doctors.slice(1)));
  const reloaded = loadOpeningBalanceSnapshots();
  assert.equal(reloaded.records[0].doctorId, doctors[0].id);
  assert.equal(reloaded.doctors.find((doctor) => doctor.id === saved[0].doctorId), undefined);
  assert.throws(() => updateOpeningBalance(reloaded.records, reloaded.doctors, saved[0].id, values(doctors[0].id)), /saved doctor/);
});