import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COURIER_PARTNER_STORAGE_KEY, createCourierPartner, deleteCourierPartner,
  exportCourierPartnerCSV, loadCourierPartners, setCourierPartnerStatus, updateCourierPartner,
} from './courierPartners.js';
import { EXCEL_TEMPLATES, reviewExcel, sampleExcel } from './mockExcelImport.js';

function storage() {
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  return values;
}

test('courier partners persist independently, preserving an intentionally empty collection', () => {
  const values = storage();
  assert.deepEqual(loadCourierPartners(), []);
  const first = createCourierPartner([], { name: '  Express  ', status: 'inactive' });
  assert.equal(first[0].name, 'Express');
  assert.equal(first[0].status, 'inactive');
  assert.equal(first[0].createdBy, 'Admin User');
  assert.equal(first[0].createdAt, first[0].updatedAt);
  assert.deepEqual(loadCourierPartners(), first);
  const updated = updateCourierPartner(first, first[0].id, { name: 'Express Prime', status: 'active' });
  assert.equal(updated[0].createdAt, first[0].createdAt);
  assert.equal(updated[0].createdBy, first[0].createdBy);
  assert.ok(updated[0].updatedAt > first[0].updatedAt);
  assert.equal(updated[0].status, 'active');
  const inactive = setCourierPartnerStatus(updated, first[0].id, 'inactive');
  assert.equal(inactive[0].updatedBy, 'Admin User');
  assert.ok(inactive[0].updatedAt > updated[0].updatedAt);
  assert.equal(inactive[0].status, 'inactive');
  assert.deepEqual(deleteCourierPartner(inactive, first[0].id), []);
  assert.equal(values.get(COURIER_PARTNER_STORAGE_KEY), '[]');
  assert.deepEqual(loadCourierPartners(), []);
  assert.equal(values.has('evexia.admin.zones.v1'), false);
});

test('blank and case/space duplicate names are rejected for add and edit', () => {
  storage();
  const records = createCourierPartner([], { name: 'City Courier' });
  const two = createCourierPartner(records, { name: 'Express' });
  assert.throws(() => createCourierPartner(two, { name: ' \t ' }), /name is required/);
  assert.throws(() => createCourierPartner(two, { name: '  CITY COURIER  ' }), /already exists/);
  assert.throws(() => createCourierPartner(two, { name: ' city   courier ' }), /already exists/);
  assert.throws(() => updateCourierPartner(two, two[0].id, { name: ' city courier ' }), /already exists/);
  assert.throws(() => setCourierPartnerStatus(two, two[0].id, 'unknown'), /valid courier partner status/);
  assert.equal(updateCourierPartner(two, records[0].id, { name: ' CITY COURIER ', status: 'active' })[1].name, 'CITY COURIER');
});

test('stale, corrupt and unavailable storage cannot overwrite records', () => {
  const values = storage();
  const original = createCourierPartner([], { name: 'First' });
  createCourierPartner(original, { name: 'Second' });
  const current = values.get(COURIER_PARTNER_STORAGE_KEY);
  assert.throws(() => deleteCourierPartner(original, original[0].id), /another tab/);
  assert.equal(values.get(COURIER_PARTNER_STORAGE_KEY), current);
  for (const invalid of ['{', '{}', '[null]', '[{"name":"partial"}]']) {
    values.set(COURIER_PARTNER_STORAGE_KEY, invalid);
    assert.throws(loadCourierPartners, /invalid/);
    assert.throws(() => createCourierPartner(original, { name: 'Third' }), /invalid/);
    assert.equal(values.get(COURIER_PARTNER_STORAGE_KEY), invalid);
  }
  globalThis.window.localStorage.getItem = () => { throw new Error('blocked'); };
  assert.throws(loadCourierPartners, /unavailable/);
  globalThis.window.localStorage.getItem = (key) => values.get(key) ?? null;
  values.set(COURIER_PARTNER_STORAGE_KEY, current);
  globalThis.window.localStorage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => deleteCourierPartner(loadCourierPartners(), original[0].id), /could not be saved/);
  assert.equal(values.get(COURIER_PARTNER_STORAGE_KEY), current);
});

test('CSV quotes cells, prevents spreadsheet formulas and exports the supplied filtered rows', () => {
  const rows = [{
    name: ' \t=HYPERLINK("bad","x"),\nnext', status: 'active', createdBy: '+formula',
    createdAt: '2026-01-01', updatedBy: '@formula', updatedAt: '2026-01-02',
  }];
  const csv = exportCourierPartnerCSV(rows);
  assert.ok(csv.startsWith('\uFEFF"Courier Partner Name","Status"'));
  assert.match(csv, /"' \t=HYPERLINK\(""bad"",""x""\),\nnext"/);
  assert.match(csv, /"'\+formula"/);
  assert.match(csv, /"'@formula"/);
  assert.equal(csv.split('\r\n').length, 3);
});

test('courier workbook sample and review are specific and do not save records', async () => {
  const values = storage();
  const existing = createCourierPartner([], { name: 'Already Saved' });
  const before = values.get(COURIER_PARTNER_STORAGE_KEY);
  assert.deepEqual(EXCEL_TEMPLATES['courier-partner'].columns, ['Courier Partner Name', 'Status']);
  const workbook = new Uint8Array(await sampleExcel('courier-partner').arrayBuffer());
  assert.equal(String.fromCharCode(...workbook.slice(0, 4)), 'PK\u0003\u0004');
  const report = reviewExcel('courier-partner', [
    { line: 1, cells: ['Courier Partner Name', 'Status'] },
    { line: 2, cells: [' New Partner ', 'active'] },
    { line: 3, cells: [' already saved ', 'inactive'] },
    { line: 4, cells: ['new partner', 'unknown'] },
    { line: 5, cells: ['', 'active'] },
  ]);
  assert.deepEqual(report[0].errors, []);
  assert.match(report[1].errors.join(' '), /already exists/);
  assert.match(report[2].errors.join(' '), /already exists/);
  assert.match(report[2].errors.join(' '), /Status must be/);
  assert.match(report[3].errors.join(' '), /required/);
  assert.equal(values.get(COURIER_PARTNER_STORAGE_KEY), before);
  assert.deepEqual(loadCourierPartners(), existing);
});