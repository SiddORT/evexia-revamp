import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLERGEN_KEY, allergenCSVTemplate, createAllergen, exportAllergenCSV, importAllergens, loadAllergenReferences, loadAllergens, reviewAllergenCSV, setAllergenStatus, updateAllergen } from './allergens.js';
import { CATEGORY_STORAGE_KEY, loadCategories, setCategoryStatus } from './productCategories.js';
import { STORAGE_LOCATION_KEY, loadStorageLocations, setStorageLocationStatus } from './storageLocations.js';

function storage() {
  const map = new Map();
  return { getItem: (key) => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
}
const fields = (refs, name = 'New product') => ({
  name, categoryId: refs.categories[0].id, storageLocationId: refs.locations[0].id,
  sellingPrice: '', gst: '12', concentration: '5 mg/mL', thresholdLimit: '', hsnCode: '', status: 'active', allergens: false,
});
test.beforeEach(() => { globalThis.window = { localStorage: storage() }; });

test('first load seeds labeled samples using active references once; empty and existing records remain untouched', () => {
  const refs = loadAllergenReferences();
  const initial = loadAllergens(refs);
  assert.ok(initial.length >= 3);
  assert.ok(initial.every((item) => item.name.startsWith('Sample ') && refs.categories.some((c) => c.id === item.categoryId && c.status === 'active') && refs.locations.some((l) => l.id === item.storageLocationId && l.status === 'active')));
  assert.deepEqual(new Set(initial.map((item) => item.status)), new Set(['active', 'inactive']));
  assert.deepEqual(loadAllergens(), initial);
  window.localStorage.setItem(ALLERGEN_KEY, '[]');
  assert.deepEqual(loadAllergens(), []);
  const created = createAllergen([], refs, fields(refs));
  assert.deepEqual(loadAllergens(), created);
});

test('missing, empty, corrupt or unavailable references cannot create samples or silently reset saved records', () => {
  window.localStorage.setItem(CATEGORY_STORAGE_KEY, '[]');
  assert.throws(() => loadAllergens(), /Add an active Product Category/);
  assert.equal(window.localStorage.getItem(ALLERGEN_KEY), null);
  window.localStorage.setItem(CATEGORY_STORAGE_KEY, '{bad');
  assert.throws(() => loadAllergens(), /invalid/);
  assert.equal(window.localStorage.getItem(ALLERGEN_KEY), null);
  window.localStorage = { getItem() { throw Error('blocked'); } };
  assert.throws(() => loadAllergens(), /unavailable/);
});

test('corrupt allergen storage blocks writes and stale snapshots cannot overwrite changes', () => {
  const refs = loadAllergenReferences();
  window.localStorage.setItem(ALLERGEN_KEY, '{bad');
  assert.throws(() => loadAllergens(), /invalid/);
  assert.throws(() => createAllergen([], refs, fields(refs)), /invalid/);
  assert.equal(window.localStorage.getItem(ALLERGEN_KEY), '{bad');
  window.localStorage.setItem(ALLERGEN_KEY, '[]');
  const first = createAllergen([], refs, fields(refs));
  createAllergen(first, refs, fields(refs, 'Second'));
  assert.throws(() => updateAllergen(first, refs, first[0].id, fields(refs, 'Edited')), /changed in another tab/);
  assert.throws(() => setAllergenStatus(first, refs, first[0].id, 'inactive'), /changed in another tab/);
});

test('create/edit/status preserve created audit and reject duplicates, missing refs and invalid numbers', () => {
  const refs = loadAllergenReferences();
  window.localStorage.setItem(ALLERGEN_KEY, '[]');
  assert.throws(() => createAllergen([], refs, { ...fields(refs), name: ' ' }), /required/);
  assert.throws(() => createAllergen([], refs, { ...fields(refs), gst: '' }), /GST/);
  assert.throws(() => createAllergen([], refs, { ...fields(refs), sellingPrice: '-1' }), /Selling Price/);
  assert.throws(() => createAllergen([], refs, { ...fields(refs), thresholdLimit: 'no' }), /Threshold limit/);
  assert.throws(() => createAllergen([], refs, { ...fields(refs), categoryId: 'removed' }), /category/);
  assert.throws(() => createAllergen([], refs, { ...fields(refs), storageLocationId: 'removed' }), /storage location/);
  const created = createAllergen([], refs, fields(refs, '  Product A  '));
  assert.equal(created[0].name, 'Product A');
  assert.throws(() => createAllergen(created, refs, fields(refs, 'product a')), /already exists/);
  const edited = updateAllergen(created, refs, created[0].id, { ...fields(refs, 'Product A'), sellingPrice: 0, thresholdLimit: '0.01' });
  assert.equal(edited[0].createdAt, created[0].createdAt);
  assert.notEqual(edited[0].updatedAt, created[0].updatedAt);
  const toggled = setAllergenStatus(edited, refs, edited[0].id, 'inactive');
  assert.equal(toggled[0].status, 'inactive');
  assert.equal(toggled[0].createdBy, created[0].createdBy);
  assert.notEqual(toggled[0].updatedAt, edited[0].updatedAt);
});

test('inactive and removed saved assignments are visible and retained only if unchanged; stale refs reject writes', () => {
  const refs = loadAllergenReferences();
  window.localStorage.setItem(ALLERGEN_KEY, '[]');
  const created = createAllergen([], refs, fields(refs));
  const inactive = setCategoryStatus(refs.categories, refs.categories[0].id, 'inactive');
  const currentRefs = { categories: inactive, locations: refs.locations };
  assert.throws(() => updateAllergen(created, refs, created[0].id, fields(refs)), /changed in another tab/);
  assert.throws(() => createAllergen(created, currentRefs, fields(currentRefs, 'Another')), /active category/);
  const changed = updateAllergen(created, currentRefs, created[0].id, { ...fields(refs), name: 'Renamed' });
  const removedRefs = { ...currentRefs, categories: inactive.filter((item) => item.id !== created[0].categoryId) };
  window.localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(removedRefs.categories));
  const retained = updateAllergen(changed, removedRefs, created[0].id, { ...fields(refs), name: 'Still assigned' });
  assert.equal(retained[0].categoryId, created[0].categoryId);
  assert.throws(() => updateAllergen(retained, removedRefs, created[0].id, { ...fields(refs), categoryId: 'missing' }), /active category/);
});

test('CSV template, formula escaping, round trip and atomic import against unchanged references', () => {
  const refs = loadAllergenReferences();
  window.localStorage.setItem(ALLERGEN_KEY, '[]');
  const existing = createAllergen([], refs, { ...fields(refs, '=SUM(1,2)'), hsnCode: '@code' });
  const csv = exportAllergenCSV(existing, refs);
  assert.match(csv, /"'=SUM\(1,2\)"/);
  assert.match(csv, /"'@code"/);
  const review = reviewAllergenCSV(csv, [], refs);
  assert.deepEqual(review[0].errors, []);
  assert.equal(review[0].fields.name, '=SUM(1,2)');
  assert.equal(review[0].fields.hsnCode, '@code');
  assert.match(allergenCSVTemplate(), /Product Name/);
  assert.match(reviewAllergenCSV(csv, existing, refs)[0].errors.join(' '), /already exists/);
  const rows = reviewAllergenCSV(csv.replace("'=SUM(1,2)", 'Fresh product'), [], refs);
  window.localStorage.setItem(ALLERGEN_KEY, '[]');
  assert.equal(importAllergens(rows, [], refs).length, 1);
  assert.throws(() => importAllergens(rows, [], refs), /changed in another tab/);
});

test('CSV rejects malformed rows, duplicate names, inactive or ambiguous references and changed reference snapshots', () => {
  const refs = loadAllergenReferences();
  window.localStorage.setItem(ALLERGEN_KEY, '[]');
  const header = allergenCSVTemplate();
  const row = `A,${refs.categories[0].name},2,12,${refs.locations[0].name},1 mg,0,3822,active,Allergens\n`;
  const duplicate = reviewAllergenCSV(header + row + row, [], refs);
  assert.ok(duplicate[1].errors.some((item) => /already exists/.test(item)));
  assert.throws(() => importAllergens(duplicate, [], refs), /errors/);
  assert.deepEqual(loadAllergens(), []);
  const invalid = reviewAllergenCSV(header + row.replace(',2,12,', ',-2,no,'), [], refs);
  assert.ok(invalid[0].errors.length);
  assert.throws(() => reviewAllergenCSV(header + '"unclosed', [], refs), /Malformed/);
  const valid = reviewAllergenCSV(header + row, [], refs);
  const changed = setStorageLocationStatus(refs.locations, refs.locations[0].id, 'inactive');
  assert.throws(() => importAllergens(valid, [], refs), /changed in another tab/);
  assert.ok(reviewAllergenCSV(header + row, [], { ...refs, locations: changed })[0].errors.length);
  assert.deepEqual(loadAllergens(), []);
});

test('seeding race and failed browser write never overwrite another collection', () => {
  loadCategories(); loadStorageLocations();
  let reads = 0;
  const data = window.localStorage;
  window.localStorage = {
    getItem(key) { if (key === ALLERGEN_KEY && ++reads === 1) return null; return key === ALLERGEN_KEY ? '[]' : data.getItem(key); },
    setItem() { assert.fail('must not overwrite'); },
  };
  assert.deepEqual(loadAllergens(), []);
  window.localStorage = { getItem: (key) => key === ALLERGEN_KEY ? null : data.getItem(key), setItem() { throw Error('quota'); } };
  assert.throws(() => loadAllergens(), /could not be saved/);
});