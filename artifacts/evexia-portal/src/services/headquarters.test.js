import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEADQUARTER_KEY, createHeadquarter, updateHeadquarter, setHeadquarterStatus,
  loadHeadquarters, exportHeadquarterCSV, headquarterCSVTemplate,
  reviewHeadquarterCSV, importHeadquarters,
} from './headquarters.js';

function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, value),
  };
}
const hq = (name, stateCode = 'MH', status = 'active') => ({ name, stateCode, status });
test.beforeEach(() => {
  globalThis.window = { localStorage: storage() };
  window.localStorage.setItem(HEADQUARTER_KEY, '[]');
});

test('first load initializes labeled matching-state samples exactly once', () => {
  window.localStorage = storage();
  const first = loadHeadquarters();
  assert.ok(first.length >= 3);
  assert.ok(first.every((item) => item.name.startsWith('Sample ') && item.stateCode && item.createdBy && item.createdAt === item.updatedAt));
  assert.deepEqual(new Set(first.map((item) => item.status)), new Set(['active', 'inactive']));
  assert.deepEqual(first.map((item) => item.stateCode), ['MH', 'KA', 'TS', 'DL']);
  const saved = window.localStorage.getItem(HEADQUARTER_KEY);
  assert.deepEqual(loadHeadquarters(), first);
  assert.equal(window.localStorage.getItem(HEADQUARTER_KEY), saved);
});

test('preserves empty and edited collections and concurrent first-run initialization', () => {
  assert.deepEqual(loadHeadquarters(), []);
  const existing = createHeadquarter([], hq('Actual HQ'));
  assert.deepEqual(loadHeadquarters(), existing);
  const replacement = storage();
  replacement.setItem(HEADQUARTER_KEY, '[]');
  let reads = 0;
  window.localStorage = {
    getItem(key) { return ++reads === 1 ? null : replacement.getItem(key); },
    setItem() { assert.fail('Must not overwrite an existing collection'); },
  };
  assert.deepEqual(loadHeadquarters(), []);
});

test('validation prevents duplicate names and missing fields, and edits retain creation audit', () => {
  const created = createHeadquarter([], hq('  Mumbai HQ  ', 'mh'));
  assert.equal(created[0].name, 'Mumbai HQ');
  assert.equal(created[0].stateCode, 'MH');
  assert.equal(created[0].createdBy, 'Admin User');
  assert.throws(() => createHeadquarter(created, hq(' mumbai hq ')), /already exists/);
  assert.throws(() => createHeadquarter(created, hq('Other', ' ')), /State Code is required/);
  assert.throws(() => createHeadquarter(created, hq(' ', 'MH')), /HQ Name is required/);
  assert.throws(() => createHeadquarter(created, hq('Other', 'MH', 'unknown')), /status/);
  assert.throws(() => createHeadquarter(created, { ...hq('Other'), createdBy: 'someone' }), /unsupported/);
  const edited = updateHeadquarter(created, created[0].id, hq('Mumbai HQ', 'KA'));
  assert.equal(edited[0].createdAt, created[0].createdAt);
  assert.equal(edited[0].createdBy, created[0].createdBy);
  assert.ok(Date.parse(edited[0].updatedAt) > Date.parse(created[0].updatedAt));
  const toggled = setHeadquarterStatus(edited, created[0].id, 'inactive');
  assert.equal(toggled[0].status, 'inactive');
  assert.ok(Date.parse(toggled[0].updatedAt) > Date.parse(edited[0].updatedAt));
  assert.equal(toggled[0].createdAt, created[0].createdAt);
  assert.equal(toggled[0].updatedBy, 'Admin User');
});

test('CSV template, multiline round trip and spreadsheet formula escaping', () => {
  assert.match(headquarterCSVTemplate(), /HQ Name","State Code","Status/);
  const existing = createHeadquarter([], hq('=SUM(1,2)\n"quoted"', '+KA'));
  const csv = exportHeadquarterCSV(existing);
  assert.match(csv, /"'=SUM\(1,2\)/);
  assert.match(csv, /"'\+KA"/);
  const entries = reviewHeadquarterCSV(csv, []);
  assert.deepEqual(entries[0].errors, []);
  assert.equal(entries[0].fields.name, '=SUM(1,2)\n"quoted"');
  assert.equal(entries[0].fields.stateCode, '+KA');
  window.localStorage = storage();
  window.localStorage.setItem(HEADQUARTER_KEY, '[]');
  const imported = importHeadquarters(entries, []);
  assert.equal(imported[0].name, existing[0].name);
  assert.equal(imported[0].createdBy, 'Admin User');
  assert.equal(imported[0].updatedAt, imported[0].createdAt);
});

test('review rejects invalid rows, duplicate names and extra audit columns atomically', () => {
  const header = 'HQ Name,State Code,Status\n';
  const bad = reviewHeadquarterCSV(header + 'A,MH,active\n a ,KA,inactive\nB,,unknown\nC,Only two\n', []);
  assert.equal(bad[1].errors.length, 1);
  assert.equal(bad[2].errors.length, 2);
  assert.equal(bad[3].errors.length, 1);
  assert.throws(() => importHeadquarters(bad, []), /errors/);
  assert.deepEqual(loadHeadquarters(), []);
  assert.throws(() => reviewHeadquarterCSV('HQ Name,State Code,Status,Created By\nA,MH,active,X\n', []), /headers/);
  assert.throws(() => reviewHeadquarterCSV(header + '"unclosed', []), /Malformed/);
  assert.match(reviewHeadquarterCSV(header + 'A,MH,active\n', createHeadquarter([], hq(' a ')))[0].errors.join(' '), /already exists/);
});

test('one guarded import rejects changed snapshots and corrupt data', () => {
  const entries = reviewHeadquarterCSV('HQ Name,State Code,Status\nA,MH,active\nB,KA,inactive\n', []);
  const saved = importHeadquarters(entries, []);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].createdAt, saved[1].createdAt);
  assert.equal(window.localStorage.getItem(HEADQUARTER_KEY), JSON.stringify(saved));
  assert.throws(() => importHeadquarters(entries, []), /changed since review/);
  assert.throws(() => setHeadquarterStatus(saved, saved[0].id, 'active'), /different valid status/);
  window.localStorage.setItem(HEADQUARTER_KEY, '[{"name":"old"}]');
  assert.throws(() => loadHeadquarters(), /invalid/);
  assert.throws(() => createHeadquarter([], hq('C')), /invalid/);
  assert.equal(window.localStorage.getItem(HEADQUARTER_KEY), '[{"name":"old"}]');
});

test('storage errors and stale edits surface without overwriting records', () => {
  window.localStorage = { getItem() { throw new Error('blocked'); } };
  assert.throws(() => loadHeadquarters(), /unavailable/);
  window.localStorage = { getItem: () => null, setItem() { throw new Error('quota'); } };
  assert.throws(() => loadHeadquarters(), /Sample headquarters could not be saved/);
  window.localStorage = { getItem: () => '[]', setItem() { throw new Error('quota'); } };
  assert.throws(() => importHeadquarters(reviewHeadquarterCSV('HQ Name,State Code,Status\nA,MH,active\n', []), []), /could not be saved/);
  window.localStorage = storage();
  window.localStorage.setItem(HEADQUARTER_KEY, '[]');
  const first = createHeadquarter([], hq('First'));
  createHeadquarter(first, hq('Second'));
  assert.throws(() => updateHeadquarter(first, first[0].id, hq('Third')), /changed in another tab/);
  assert.throws(() => setHeadquarterStatus(first, first[0].id, 'inactive'), /changed in another tab/);
  assert.equal(loadHeadquarters().length, 2);
});