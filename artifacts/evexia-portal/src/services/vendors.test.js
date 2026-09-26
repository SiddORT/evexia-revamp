import test from 'node:test';
import assert from 'node:assert/strict';
import { VENDOR_KEY, createVendor, exportVendorCSV, importVendors, loadVendors, reviewVendorCSV, updateVendor, validateVendor, vendorCSVTemplate } from './vendors.js';

function storage() {
  const map = new Map();
  return { getItem: (key) => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
}
const vendor = (name = 'Test Vendor', gstNo = '27DDDDD3333D1Z8') => ({
  vendorName: name, gstNo, registeredAddress: 'Block A, Main Road\nSecond floor',
  contactPersonName: 'Jane Test', emailId: 'jane@example.test', phoneNo: '+919876543210',
});
test.beforeEach(() => { globalThis.window = { localStorage: storage() }; });

test('first visit seeds labeled samples only when key is absent; reload and intentional empty collection persist', () => {
  const first = loadVendors();
  assert.equal(first.length, 3);
  assert.ok(first.every((item) => item.vendorName.startsWith('Sample ') && item.id.startsWith('sample-vendor-')));
  assert.deepEqual(loadVendors(), first);
  window.localStorage.setItem(VENDOR_KEY, '[]');
  assert.deepEqual(loadVendors(), []);
  const created = createVendor([], vendor());
  assert.deepEqual(loadVendors(), created);
});

test('creation and edit preserve creation audit and advance update timestamp', () => {
  window.localStorage.setItem(VENDOR_KEY, '[]');
  const first = createVendor([], vendor());
  assert.equal(first[0].createdBy, 'Admin User');
  assert.equal(first[0].updatedBy, 'Admin User');
  const edited = updateVendor(first, first[0].id, { ...vendor(), contactPersonName: 'Changed Name' });
  assert.equal(edited[0].createdAt, first[0].createdAt);
  assert.equal(edited[0].createdBy, first[0].createdBy);
  assert.ok(Date.parse(edited[0].updatedAt) > Date.parse(first[0].updatedAt));
  assert.equal(loadVendors()[0].contactPersonName, 'Changed Name');
});

test('required, GST, email, phone and duplicate identities are validated', () => {
  const base = vendor();
  for (const [field, value] of [['vendorName', ''], ['gstNo', 'ABC'], ['registeredAddress', ' '], ['contactPersonName', ''], ['emailId', 'invalid'], ['phoneNo', '123']]) {
    assert.ok(validateVendor({ ...base, [field]: value }).errors[field], field);
  }
  window.localStorage.setItem(VENDOR_KEY, '[]');
  const first = createVendor([], base);
  assert.ok(validateVendor(vendor('test vendor', '29EEEEE4444E1Z9'), first).errors.vendorName);
  assert.ok(validateVendor(vendor('Another Vendor', base.gstNo), first).errors.gstNo);
  assert.throws(() => createVendor(first, vendor('test vendor', '29EEEEE4444E1Z9')), /already exists/);
});

test('CSV template and export round trip multiline quotes and formula-like values', () => {
  window.localStorage.setItem(VENDOR_KEY, '[]');
  const fields = { ...vendor(), vendorName: '=Test," Vendor', registeredAddress: '@cell\n"Quoted", road' };
  const first = createVendor([], fields);
  assert.match(vendorCSVTemplate(), /Vendor Name/);
  const csv = exportVendorCSV(first);
  assert.match(csv, /"'=Test/);
  assert.match(csv, /"'@cell/);
  const entries = reviewVendorCSV(csv, []);
  assert.deepEqual(entries[0].errors, []);
  assert.equal(entries[0].fields.vendorName, fields.vendorName);
  assert.equal(entries[0].fields.registeredAddress, fields.registeredAddress);
  window.localStorage.setItem(VENDOR_KEY, '[]');
  const imported = importVendors(entries, []);
  assert.equal(imported[0].vendorName, fields.vendorName);
  assert.equal(imported[0].createdBy, 'Admin User');
});

test('review rejects bad headers, malformed rows, invalid values and duplicate identities without partial writes', () => {
  const header = vendorCSVTemplate();
  assert.throws(() => reviewVendorCSV('Wrong,Header\nA,B', []), /headers/);
  const csv = header + [
    'Valid,27DDDDD3333D1Z8,Address,Jane,jane@example.test,9876543210',
    'valid,29EEEEE4444E1Z9,Address,John,john@example.test,9876543211',
    'Other,27DDDDD3333D1Z8,Address,John,invalid,123',
    'Too,Few',
  ].join('\n');
  window.localStorage.setItem(VENDOR_KEY, '[]');
  const entries = reviewVendorCSV(csv, []);
  assert.equal(entries[0].errors.length, 0);
  assert.ok(entries[1].errors.some((error) => error.includes('Vendor Name')));
  assert.ok(entries[2].errors.length >= 3);
  assert.ok(entries[3].errors.length);
  assert.throws(() => importVendors(entries, []), /row errors/);
  assert.deepEqual(loadVendors(), []);
  assert.throws(() => reviewVendorCSV(header + '"unclosed', []), /Malformed CSV/);
});

test('corrupt and unavailable storage and stale tabs block destructive writes', () => {
  window.localStorage.setItem(VENDOR_KEY, '{broken');
  assert.throws(() => loadVendors(), /invalid/);
  assert.throws(() => createVendor([], vendor()), /invalid/);
  assert.equal(window.localStorage.getItem(VENDOR_KEY), '{broken');
  window.localStorage.setItem(VENDOR_KEY, '[]');
  const first = createVendor([], vendor());
  createVendor(first, vendor('Second', '29EEEEE4444E1Z9'));
  assert.throws(() => updateVendor(first, first[0].id, vendor('Changed')), /changed in another tab/);
  assert.throws(() => importVendors(reviewVendorCSV(exportVendorCSV([{
    ...vendor('Third', '07FFFFF5555F1ZA'), id: 'csv', createdBy: 'Admin User', updatedBy: 'Admin User',
    createdAt: first[0].createdAt, updatedAt: first[0].updatedAt,
  }]), first), first), /changed in another tab/);
  window.localStorage = { getItem() { throw Error('blocked'); } };
  assert.throws(() => loadVendors(), /unavailable/);
  assert.throws(() => updateVendor(first, first[0].id, vendor()), /unavailable/);
});

test('failed writes leave saved vendors unchanged and malformed saved audit cannot be replaced', () => {
  const base = storage();
  base.setItem(VENDOR_KEY, '[]');
  window.localStorage = {
    getItem: base.getItem,
    setItem() { throw Error('quota exceeded'); },
  };
  assert.throws(() => createVendor([], vendor()), /could not be saved/);
  assert.equal(base.getItem(VENDOR_KEY), '[]');
  window.localStorage = base;
  const created = createVendor([], vendor());
  base.setItem(VENDOR_KEY, JSON.stringify([{ ...created[0], createdAt: 'not a date' }]));
  assert.throws(() => loadVendors(), /invalid/);
  assert.throws(() => updateVendor(created, created[0].id, vendor()), /invalid/);
  assert.equal(JSON.parse(base.getItem(VENDOR_KEY))[0].createdAt, 'not a date');
});