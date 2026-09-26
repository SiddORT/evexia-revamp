import test from 'node:test';
import assert from 'node:assert/strict';
import { CSV_COLUMNS, exportMRCSV } from './mrs.js';
import { reviewImport } from './masterImport.js';

const zone = { id: 'zone-1', name: 'Central Zone', status: 'active' };
const snapshots = { zones: [zone], mrs: [], doctors: [] };
const record = {
  employeeCode: 'MR-001', name: 'Test MR', phone: '9876543210', userId: 'test.mr',
  email: 'test@example.com', contactRequirement: 'required', hq: 'Central',
  zoneId: zone.id, dateOfJoining: '2024-01-15', designation: 'Representative',
  reportingManagerId: '', paymentLimit: 0, doctorDaysLimit: 0, status: 'active',
  addressLine1: '1 Main Road', addressLine2: '', landmark: 'Market',
  pincode: '110001', city: 'Delhi', state: 'Delhi', country: 'India',
};

test('MR CSVs exported before contact rules still import as required contacts', () => {
  const oldColumns = CSV_COLUMNS.filter(([key]) => key !== 'contactRequirement');
  const oldCSV = [
    oldColumns.map(([, label]) => `"${label}"`).join(','),
    oldColumns.map(([key]) => `"${key === 'zoneName' ? zone.name : key === 'managerName' ? '' : record[key] ?? ''}"`).join(','),
  ].join('\r\n');
  const [entry] = reviewImport('mr', oldCSV, snapshots);
  assert.deepEqual(entry.errors, []);
  assert.equal(entry.fields.contactRequirement, 'required');
  assert.equal(entry.fields.name, record.name);
});

test('current MR exports still import and unsupported header changes fail', () => {
  const csv = exportMRCSV([record], [zone], [record]);
  const [entry] = reviewImport('mr', csv, snapshots);
  assert.deepEqual(entry.errors, []);
  assert.equal(entry.fields.contactRequirement, 'required');
  assert.throws(() => reviewImport('mr', csv.replace('Contact Requirement', 'Password'), snapshots), /CSV headers must match/);
});