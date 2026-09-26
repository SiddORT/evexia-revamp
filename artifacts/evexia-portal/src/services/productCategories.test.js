import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORY_STORAGE_KEY, createCategory, updateCategory, setCategoryStatus, loadCategories,
  exportCategoryCSV, reviewCategoryCSV, importCategories,
} from './productCategories.js';

function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, value),
  };
}
const category = (name, unitPrice = '12.50') => ({ name, description: '', unitPrice, status: 'active' });
test.beforeEach(() => {
  globalThis.window = { localStorage: storage() };
  window.localStorage.setItem(CATEGORY_STORAGE_KEY, '[]');
});

test('first load saves distinct valid samples once and refresh keeps the same records', () => {
  window.localStorage = storage();
  const samples = loadCategories();
  assert.ok(samples.length >= 3);
  assert.equal(new Set(samples.map(({ id }) => id)).size, samples.length);
  assert.ok(samples.every(({ name, description, unitPrice, createdAt, createdBy, updatedAt, updatedBy }) =>
    name.startsWith('Sample ') && description && unitPrice >= 0 &&
    !Number.isNaN(Date.parse(createdAt)) && createdAt === updatedAt && createdBy && updatedBy));
  assert.deepEqual(new Set(samples.map(({ status }) => status)), new Set(['active', 'inactive']));
  const saved = window.localStorage.getItem(CATEGORY_STORAGE_KEY);
  assert.deepEqual(JSON.parse(saved), samples);
  assert.deepEqual(loadCategories(), samples);
  assert.equal(window.localStorage.getItem(CATEGORY_STORAGE_KEY), saved);
});

test('saved nonempty and intentionally empty collections do not receive samples', () => {
  const existing = createCategory([], category('Real category'));
  assert.deepEqual(loadCategories(), existing);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(CATEGORY_STORAGE_KEY)), existing);
  window.localStorage.setItem(CATEGORY_STORAGE_KEY, '[]');
  assert.deepEqual(loadCategories(), []);
  assert.equal(window.localStorage.getItem(CATEGORY_STORAGE_KEY), '[]');
});

test('samples can be edited, filtered by status, exported and imported alongside new records', () => {
  window.localStorage = storage();
  const samples = loadCategories();
  const inactive = samples.filter(({ status }) => status === 'inactive');
  assert.ok(inactive.length > 0);
  const csv = exportCategoryCSV(inactive);
  const exported = reviewCategoryCSV(csv, []);
  assert.deepEqual(exported.map(({ fields }) => fields.name), inactive.map(({ name }) => name));
  const edited = updateCategory(samples, samples[0].id, { ...category(samples[0].name, '99'), description: 'Edited example' });
  assert.equal(edited[0].createdAt, samples[0].createdAt);
  assert.equal(edited[0].unitPrice, 99);
  const toggled = setCategoryStatus(edited, samples[0].id, 'inactive');
  assert.equal(toggled[0].status, 'inactive');
  const entries = reviewCategoryCSV('Product Category Name,Description,Unit Price,Status\nAdded example,Imported,12,active\n', toggled);
  assert.deepEqual(entries[0].errors, []);
  const imported = importCategories(entries, toggled);
  assert.equal(imported.length, samples.length + 1);
  assert.deepEqual(loadCategories(), imported);
  assert.equal(imported.at(-1).name, 'Added example');
  const duplicate = reviewCategoryCSV(csv, imported);
  assert.match(duplicate[0].errors.join(' '), /already exists/);
});

test('seeding does not overwrite a collection saved between reads', () => {
  let reads = 0;
  const replacement = storage();
  replacement.setItem(CATEGORY_STORAGE_KEY, '[]');
  window.localStorage = {
    getItem(key) { return ++reads === 1 ? null : replacement.getItem(key); },
    setItem() { assert.fail('Must not overwrite the other tab'); },
  };
  assert.deepEqual(loadCategories(), []);
});

test('failed first-time sample writes and unavailable storage surface errors', () => {
  window.localStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.throws(() => loadCategories(), /Sample product categories could not be saved/);
  window.localStorage = { getItem() { throw new Error('blocked'); } };
  assert.throws(() => loadCategories(), /unavailable/);
});

test('create, edit and status changes preserve created audit while updating the record', () => {
  const created = createCategory([], category('  Reagents  '));
  assert.equal(loadCategories()[0].name, 'Reagents');
  assert.equal(created[0].createdBy, 'Admin User');
  assert.throws(() => createCategory(created, category('reagents')), /already exists/);
  assert.throws(() => createCategory(created, category('Other', '-1')), /non-negative/);
  assert.throws(() => createCategory(created, category('Other', 'abc')), /non-negative/);
  const edited = updateCategory(created, created[0].id, { ...category('Reagents', '0'), description: 'Updated' });
  assert.equal(edited[0].createdAt, created[0].createdAt);
  assert.equal(edited[0].createdBy, created[0].createdBy);
  assert.notEqual(edited[0].updatedAt, created[0].updatedAt);
  assert.equal(edited[0].unitPrice, 0);
  const inactive = setCategoryStatus(edited, created[0].id, 'inactive');
  assert.equal(inactive[0].status, 'inactive');
  assert.equal(inactive[0].updatedBy, 'Admin User');
  assert.notEqual(inactive[0].updatedAt, edited[0].updatedAt);
});

test('CSV round trip is formula-safe, even for multiline quoted cells', () => {
  const records = createCategory([], { ...category('=SUM(1,2)'), description: '@cmd\n\"quote\"' });
  const csv = exportCategoryCSV(records);
  assert.match(csv, /"'=SUM\(1,2\)"/);
  assert.match(csv, /"'@cmd/);
  const rows = reviewCategoryCSV(csv, []);
  assert.deepEqual(rows[0].errors, []);
  assert.equal(rows[0].fields.name, '=SUM(1,2)');
  assert.equal(rows[0].fields.description, '@cmd\n"quote"');
  window.localStorage = storage();
  window.localStorage.setItem(CATEGORY_STORAGE_KEY, '[]');
  const added = importCategories(rows, []);
  assert.equal(added[0].name, '=SUM(1,2)');
  assert.equal(added[0].createdBy, 'Admin User');
});

test('invalid batches and stale reviews never partially import', () => {
  const header = 'Product Category Name,Description,Unit Price,Status\n';
  const snapshot = [];
  const duplicate = reviewCategoryCSV(header + 'A,,1,active\n a ,,2,inactive\n', snapshot);
  assert.equal(duplicate[1].errors.length, 1);
  assert.throws(() => importCategories(duplicate, snapshot), /errors/);
  assert.equal(loadCategories().length, 0);
  const malformed = reviewCategoryCSV(header + 'A,,1,active\nB,broken,2\n', snapshot);
  assert.equal(malformed[1].errors.length, 1);
  assert.throws(() => importCategories(malformed, snapshot), /errors/);
  assert.throws(() => reviewCategoryCSV(header + '"unclosed', snapshot), /Malformed/);
  const valid = reviewCategoryCSV(header + 'A,,1,active\nB,,2,inactive\n', snapshot);
  createCategory([], category('Someone else'));
  assert.throws(() => importCategories(valid, snapshot), /changed since review/);
  assert.equal(loadCategories().length, 1);
});

test('valid batch commits together with audit details; a failed storage write commits none', () => {
  const csv = 'Product Category Name,Description,Unit Price,Status\nA,,0.001,active\nB,"With, comma",1e-7,inactive\n';
  const entries = reviewCategoryCSV(csv, []);
  assert.ok(entries.every((entry) => entry.errors.length === 0));
  const saved = importCategories(entries, []);
  assert.equal(saved.length, 2);
  assert.equal(saved[1].unitPrice, 1e-7);
  assert.equal(saved[0].createdAt, saved[1].createdAt);
  assert.equal(saved[0].updatedBy, 'Admin User');
  assert.deepEqual(reviewCategoryCSV(exportCategoryCSV(saved), []).map((entry) => entry.errors), [[], []]);
  window.localStorage = { getItem: () => '[]', setItem: () => { throw new Error('quota'); } };
  assert.throws(() => importCategories(entries, []), /could not be saved/);
});

test('corrupt, legacy and unavailable storage block writes rather than resetting records', () => {
  window.localStorage.setItem(CATEGORY_STORAGE_KEY, '[{"name":"old"}]');
  assert.throws(() => loadCategories(), /invalid/);
  assert.throws(() => createCategory([], category('new')), /invalid/);
  assert.equal(window.localStorage.getItem(CATEGORY_STORAGE_KEY), '[{"name":"old"}]');
  window.localStorage = { getItem() { throw new Error('blocked'); } };
  assert.throws(() => loadCategories(), /unavailable/);
  assert.throws(() => createCategory([], category('new')), /unavailable/);
});

test('stale edits and status changes cannot overwrite a newer snapshot', () => {
  const first = createCategory([], category('A'));
  createCategory(first, category('B'));
  assert.throws(() => updateCategory(first, first[0].id, category('C')), /changed in another tab/);
  assert.throws(() => setCategoryStatus(first, first[0].id, 'inactive'), /changed in another tab/);
  assert.equal(loadCategories().length, 2);
});