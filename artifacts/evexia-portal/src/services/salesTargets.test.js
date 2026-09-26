import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SALES_TARGET_KEY, TARGET_COLUMNS, createSalesTarget, updateSalesTarget, loadSalesTargets,
  validateSalesTarget, reviewSalesTargetCSV, importSalesTargets, exportSalesTargetCSV,
  salesTargetCSVTemplate, sumSalesTargets,
} from './salesTargets.js';
import { MR_STORAGE_KEY, loadMRs } from './mrs.js';
import { loadZones } from './zones.js';

const storage = () => {
  const data = new Map();
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, value),
  };
};
const values = (mrId, startYear = 2025, extra = {}) => ({
  mrId, startYear, endYear: startYear + 1, q1: 100.25, q2: 200, q3: 300, q4: 400, ...extra,
});
let mrs;
let zones;
test.beforeEach(() => {
  globalThis.window = { localStorage: storage() };
  zones = loadZones();
  mrs = loadMRs();
  window.localStorage.setItem(SALES_TARGET_KEY, '[]');
});

test('validates MR, consecutive years, rupee precision, safe annual sum and duplicate MR/year', () => {
  const mrId = mrs[0].id;
  const initial = validateSalesTarget(values(mrId), [], mrs);
  assert.deepEqual(initial.errors, {});
  assert.deepEqual(initial.fields, { mrId, startYear: 2025, endYear: 2026, q1: 100.25, q2: 200, q3: 300, q4: 400 });
  assert.match(validateSalesTarget(values(mrId, 2025, { q1: -1 }), [], mrs).errors.q1, /nonnegative/);
  assert.match(validateSalesTarget(values(mrId, 2025, { q1: 1.234 }), [], mrs).errors.q1, /two decimal/);
  assert.match(validateSalesTarget(values(mrId, 2025, { endYear: 2027 }), [], mrs).errors.endYear, /consecutive/);
  assert.match(validateSalesTarget(values('missing-mr'), [], mrs).errors.mrId, /saved MR/);
  assert.match(validateSalesTarget(values(mrId, 2025, {
    q1: 30_000_000_000_000, q2: 30_000_000_000_000, q3: 30_000_000_000_000, q4: 30_000_000_000_000,
  }), [], mrs).errors.form, /too large/);
  const first = { ...values(mrId), id: 'saved' };
  assert.deepEqual(validateSalesTarget(values(mrId, 2026), [first], mrs).errors, {});
  assert.match(validateSalesTarget(values(mrId, 2025), [first], mrs).errors.startYear, /target for 2025/);
  assert.deepEqual(validateSalesTarget(values(mrId), [first], mrs, 'saved').errors, {});
});

test('creates and updates with audit preservation and rejects stale snapshots', () => {
  const initial = loadSalesTargets();
  const first = createSalesTarget(initial, mrs, zones, values(mrs[0].id));
  assert.equal(first.length, 1);
  assert.equal(first[0].createdBy, 'Admin User');
  assert.equal(first[0].updatedAt, first[0].createdAt);
  assert.throws(() => createSalesTarget(first, mrs, zones, values(mrs[0].id)), /target for 2025/);
  assert.throws(() => createSalesTarget(first, mrs, zones, values('deleted-mr', 2027)), /saved MR/);
  const changed = updateSalesTarget(first, mrs, zones, first[0].id, values(mrs[0].id, 2026));
  assert.equal(changed[0].createdAt, first[0].createdAt);
  assert.equal(changed[0].createdBy, first[0].createdBy);
  assert.ok(Date.parse(changed[0].updatedAt) > Date.parse(first[0].updatedAt));
  // A draft opened before another tab's edit cannot be committed after a refresh
  // simply because the caller now holds the refreshed collection.
  assert.throws(() => updateSalesTarget(changed, mrs, zones, changed[0].id,
    values(mrs[0].id, 2027), first[0]), /changed since editing began/);
  assert.deepEqual(loadSalesTargets(), changed);
  assert.throws(() => updateSalesTarget(first, mrs, zones, 'missing', values(mrs[0].id)), /no longer available/);
  window.localStorage.setItem(SALES_TARGET_KEY, JSON.stringify(changed));
  assert.throws(() => updateSalesTarget(first, mrs, zones, first[0].id, values(mrs[0].id, 2027)), /changed in another tab/);
  window.localStorage.setItem(SALES_TARGET_KEY, JSON.stringify(first));
  window.localStorage.setItem('evexia.admin.zones.v1', '[]');
  assert.throws(() => updateSalesTarget(first, mrs, zones, first[0].id, values(mrs[0].id, 2027)), /Zones changed in another tab/);
});

test('preserves orphaned MR records on read, but does not allow new targets for missing MRs', () => {
  const orphan = {
    ...values('deleted-mr'), id: 'orphan', createdBy: 'Admin User',
    createdAt: '2025-01-01T00:00:00.000Z', updatedBy: 'Admin User', updatedAt: '2025-01-01T00:00:00.000Z',
  };
  window.localStorage.setItem(SALES_TARGET_KEY, JSON.stringify([orphan]));
  assert.deepEqual(loadSalesTargets(), [orphan]);
  assert.throws(() => createSalesTarget([orphan], mrs, zones, values('deleted-mr', 2027)), /saved MR/);
  assert.match(exportSalesTargetCSV([orphan], mrs), /Missing MR: deleted-mr/);
});

test('seeds targets only when absent and uses only sample MRs with valid zones', () => {
  window.localStorage = storage();
  zones = loadZones();
  mrs = loadMRs();
  const initial = loadSalesTargets();
  assert.ok(initial.length >= 3);
  assert.ok(initial.every((record) => mrs.some((mr) => mr.id === record.mrId && zones.some((zone) => zone.id === mr.zoneId))));
  const raw = window.localStorage.getItem(SALES_TARGET_KEY);
  assert.deepEqual(loadSalesTargets(), initial);
  assert.equal(window.localStorage.getItem(SALES_TARGET_KEY), raw);

  window.localStorage.setItem(SALES_TARGET_KEY, '[]');
  assert.deepEqual(loadSalesTargets(), []);
  window.localStorage.setItem(SALES_TARGET_KEY, '[{"id":"broken"}]');
  assert.throws(() => loadSalesTargets(), /invalid/);
  assert.equal(window.localStorage.getItem(SALES_TARGET_KEY), '[{"id":"broken"}]');
});

test('CSV template/export are safe and round-trip, including formula-like employee codes', () => {
  const formulaMR = { ...mrs[0], employeeCode: '=SUM(1,2)' };
  const record = {
    ...values(formulaMR.id), id: 'target-1', createdBy: 'Admin User',
    createdAt: '2025-01-01T00:00:00.000Z', updatedBy: 'Admin User', updatedAt: '2025-01-01T00:00:00.000Z',
  };
  assert.equal(TARGET_COLUMNS.length, 7);
  assert.match(salesTargetCSVTemplate(), /Employee Code.*Start Year.*End Year.*Q1.*Q2.*Q3.*Q4/);
  const csv = exportSalesTargetCSV([record], [formulaMR]);
  assert.match(csv, /'=SUM\(1,2\)/);
  const reviewed = reviewSalesTargetCSV(csv, [], [formulaMR]);
  assert.deepEqual(reviewed[0].errors, []);
  assert.equal(reviewed[0].fields.mrId, formulaMR.id);
  assert.equal(reviewed[0].fields.q1, record.q1);
  assert.equal(sumSalesTargets([record]), 1000.25);
});

test('CSV review detects malformed data, duplicate targets, missing and ambiguous codes', () => {
  const header = 'Employee Code,Start Year,End Year,Q1,Q2,Q3,Q4\n';
  assert.throws(() => reviewSalesTargetCSV('Employee Code,Q1\nA,1\n', [], mrs), /headers/);
  assert.throws(() => reviewSalesTargetCSV(header + '"unfinished', [], mrs), /Malformed/);
  const code = mrs[0].employeeCode;
  const text = header +
    `${code},2025,2026,1,2,3,4\n` +
    `${code},2025,2026,1,2,3,4\n` +
    `NOT-A-CODE,2028,2029,1,2,3,4\n` +
    `${code},2030,2031,-1,2,3,4\n` +
    `${code},2032,2033,1,2\n`;
  const entries = reviewSalesTargetCSV(text, [], mrs);
  assert.deepEqual(entries[0].errors, []);
  assert.match(entries[1].errors.join(' '), /target for 2025/);
  assert.match(entries[2].errors.join(' '), /must match a saved MR/);
  assert.match(entries[3].errors.join(' '), /nonnegative/);
  assert.match(entries[4].errors.join(' '), /Expected 7 columns/);
  const ambiguous = reviewSalesTargetCSV(header + `${code},2034,2035,1,2,3,4\n`, [], [mrs[0], { ...mrs[0], id: 'another' }]);
  assert.match(ambiguous[0].errors.join(' '), /ambiguous/);
});

test('imports the complete revalidated batch once and rejects stale snapshots or invalid entries', () => {
  const records = loadSalesTargets();
  const zonesSnapshot = loadZones();
  const mrSnapshot = loadMRs();
  const expected = { records, mrs: mrSnapshot, zones: zonesSnapshot };
  const header = 'Employee Code,Start Year,End Year,Q1,Q2,Q3,Q4\n';
  const code1 = mrSnapshot[0].employeeCode;
  const code2 = mrSnapshot[1].employeeCode;
  const entries = reviewSalesTargetCSV(
    `${header}${code1},2025,2026,1,2,3,4\n${code2},2025,2026,5,6,7,8\n`, records, mrSnapshot,
  );
  const saved = importSalesTargets(entries, expected);
  assert.equal(saved.length, 2);
  assert.ok(saved.every((record) => record.createdBy === 'Admin User' && record.createdAt === record.updatedAt));
  assert.equal(window.localStorage.getItem(SALES_TARGET_KEY), JSON.stringify(saved));
  assert.throws(() => importSalesTargets(entries, expected), /changed since review/);

  window.localStorage.setItem(SALES_TARGET_KEY, '[]');
  const duplicate = reviewSalesTargetCSV(`${header}${code1},2025,2026,1,2,3,4\n`, [], mrSnapshot);
  duplicate[0].values.startYear = '2025';
  duplicate[0].values.endYear = '2026';
  const duplicateSecond = { ...duplicate[0], values: { ...duplicate[0].values } };
  assert.throws(() => importSalesTargets([duplicate[0], duplicateSecond], { ...expected, records: [] }), /target for 2025/);
  assert.deepEqual(loadSalesTargets(), []);

  const valid = reviewSalesTargetCSV(`${header}${code1},2028,2029,1,2,3,4\n`, [], mrSnapshot);
  window.localStorage.setItem(MR_STORAGE_KEY, '[]');
  assert.throws(() => importSalesTargets(valid, { ...expected, records: [], mrs: mrSnapshot }), /changed since review/);
  assert.deepEqual(loadSalesTargets(), []);
});

test('storage errors are explicit and failed writes do not alter saved records', () => {
  window.localStorage = { getItem() { throw new Error('blocked'); } };
  assert.throws(() => loadSalesTargets(), /unavailable/);
  window.localStorage = storage();
  zones = loadZones();
  mrs = loadMRs();
  window.localStorage = {
    getItem: (key) => key === SALES_TARGET_KEY ? '[]' : null,
    setItem() { throw new Error('quota'); },
  };
  assert.throws(() => createSalesTarget([], mrs, zones, values(mrs[0].id)), /could not be saved/);
});