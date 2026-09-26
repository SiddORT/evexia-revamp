import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_LOCATION_KEY, createStorageLocation, updateStorageLocation, setStorageLocationStatus,
  loadStorageLocations, exportStorageLocationCSV, storageLocationCSVTemplate,
  reviewStorageLocationCSV, importStorageLocations,
} from './storageLocations.js';

function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, value),
  };
}
const location = (name, address = '14 Main St', status = 'active') => ({ name, address, status });
test.beforeEach(() => {
  globalThis.window = { localStorage: storage() };
  window.localStorage.setItem(STORAGE_LOCATION_KEY, '[]');
});

test('initializes labeled samples once with varied addresses and statuses', () => {
  window.localStorage = storage();
  const first = loadStorageLocations();
  assert.ok(first.length >= 3);
  assert.ok(first.every((item) => item.name.startsWith('Sample ') && item.address && item.createdBy && item.createdAt === item.updatedAt));
  assert.equal(new Set(first.map((item) => item.address)).size, first.length);
  assert.deepEqual(new Set(first.map((item) => item.status)), new Set(['active', 'inactive']));
  const saved = window.localStorage.getItem(STORAGE_LOCATION_KEY);
  assert.deepEqual(loadStorageLocations(), first);
  assert.equal(window.localStorage.getItem(STORAGE_LOCATION_KEY), saved);
});

test('preserves intentionally empty and pre-existing collections including a concurrent initialization', () => {
  assert.deepEqual(loadStorageLocations(), []);
  const existing = createStorageLocation([], location('Real Depot'));
  assert.deepEqual(loadStorageLocations(), existing);
  const replacement = storage();
  replacement.setItem(STORAGE_LOCATION_KEY, '[]');
  let reads = 0;
  window.localStorage = {
    getItem(key) { return ++reads === 1 ? null : replacement.getItem(key); },
    setItem() { assert.fail('Must not overwrite an existing collection'); },
  };
  assert.deepEqual(loadStorageLocations(), []);
});

test('create, edit, and status changes retain creation audit and advance update audit', () => {
  const created = createStorageLocation([], location('  Central Store  '));
  assert.equal(created[0].name, 'Central Store');
  assert.equal(created[0].createdBy, 'Admin User');
  assert.throws(() => createStorageLocation(created, location(' central store ')), /already exists/);
  assert.throws(() => createStorageLocation(created, location('Other', ' ')), /Address is required/);
  assert.throws(() => createStorageLocation(created, location(' ', 'Somewhere')), /Storage Location is required/);
  assert.throws(() => createStorageLocation(created, location('Other', 'Somewhere', 'unknown')), /status/);
  const edited = updateStorageLocation(created, created[0].id, location('Central Store', 'Another address'));
  assert.equal(edited[0].createdAt, created[0].createdAt);
  assert.equal(edited[0].createdBy, created[0].createdBy);
  assert.ok(Date.parse(edited[0].updatedAt) > Date.parse(created[0].updatedAt));
  const toggled = setStorageLocationStatus(edited, created[0].id, 'inactive');
  assert.equal(toggled[0].status, 'inactive');
  assert.ok(Date.parse(toggled[0].updatedAt) > Date.parse(edited[0].updatedAt));
  assert.equal(toggled[0].updatedBy, 'Admin User');
});

test('CSV template, multiline round trip and spreadsheet formula escaping', () => {
  assert.match(storageLocationCSVTemplate(), /Storage Location,Address,Status|Storage Location","Address","Status/);
  const existing = createStorageLocation([], location('=SUM(1,2)', '@cmd\n"quoted", address'));
  const csv = exportStorageLocationCSV(existing);
  assert.match(csv, /"'=SUM\(1,2\)"/);
  assert.match(csv, /"'@cmd/);
  const entries = reviewStorageLocationCSV(csv, []);
  assert.deepEqual(entries[0].errors, []);
  assert.equal(entries[0].fields.name, '=SUM(1,2)');
  assert.equal(entries[0].fields.address, '@cmd\n"quoted", address');
  window.localStorage = storage();
  window.localStorage.setItem(STORAGE_LOCATION_KEY, '[]');
  const imported = importStorageLocations(entries, []);
  assert.equal(imported[0].name, '=SUM(1,2)');
  assert.equal(imported[0].createdBy, 'Admin User');
  assert.equal(imported[0].updatedAt, imported[0].createdAt);
});

test('rejects malformed rows, invalid statuses, duplicate names, and unsupported headers as an atomic batch', () => {
  const header = 'Storage Location,Address,Status\n';
  const bad = reviewStorageLocationCSV(header + 'A,Main,active\n a ,Annex,inactive\nB,,unknown\nC,Only two\n', []);
  assert.equal(bad[1].errors.length, 1);
  assert.equal(bad[2].errors.length, 2);
  assert.equal(bad[3].errors.length, 1);
  assert.throws(() => importStorageLocations(bad, []), /errors/);
  assert.deepEqual(loadStorageLocations(), []);
  assert.throws(() => reviewStorageLocationCSV('Storage Location,Address,Status,Created By\nA,B,active,X\n', []), /headers/);
  assert.throws(() => reviewStorageLocationCSV(header + '"unclosed', []), /Malformed/);
  assert.match(reviewStorageLocationCSV(header + 'A,Main,active\n', createStorageLocation([], location(' a ')))[0].errors.join(' '), /already exists/);
});

test('import uses one guarded write, rejects changed snapshots, and does not overwrite corrupt storage', () => {
  const entries = reviewStorageLocationCSV('Storage Location,Address,Status\nA,Main,active\nB,Annex,inactive\n', []);
  const saved = importStorageLocations(entries, []);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].createdAt, saved[1].createdAt);
  assert.equal(window.localStorage.getItem(STORAGE_LOCATION_KEY), JSON.stringify(saved));
  assert.throws(() => importStorageLocations(entries, []), /changed since review/);
  assert.throws(() => updateStorageLocation([], saved[0].id, location('C')), /no longer available/);
  assert.throws(() => setStorageLocationStatus(saved, saved[0].id, 'active'), /different valid status/);
  window.localStorage.setItem(STORAGE_LOCATION_KEY, '[{"name":"old"}]');
  assert.throws(() => loadStorageLocations(), /invalid/);
  assert.throws(() => createStorageLocation([], location('C')), /invalid/);
  assert.equal(window.localStorage.getItem(STORAGE_LOCATION_KEY), '[{"name":"old"}]');
});

test('unavailable storage and failed writes surface errors, and stale edits do not overwrite', () => {
  window.localStorage = { getItem() { throw new Error('blocked'); } };
  assert.throws(() => loadStorageLocations(), /unavailable/);
  window.localStorage = { getItem: () => null, setItem() { throw new Error('quota'); } };
  assert.throws(() => loadStorageLocations(), /Sample storage locations could not be saved/);
  window.localStorage = { getItem: () => '[]', setItem() { throw new Error('quota'); } };
  assert.throws(() => importStorageLocations(reviewStorageLocationCSV('Storage Location,Address,Status\nA,B,active\n', []), []), /could not be saved/);
  window.localStorage = storage();
  window.localStorage.setItem(STORAGE_LOCATION_KEY, '[]');
  const first = createStorageLocation([], location('First'));
  createStorageLocation(first, location('Second'));
  assert.throws(() => updateStorageLocation(first, first[0].id, location('Third')), /changed in another tab/);
  assert.throws(() => setStorageLocationStatus(first, first[0].id, 'inactive'), /changed in another tab/);
  assert.equal(loadStorageLocations().length, 2);
});