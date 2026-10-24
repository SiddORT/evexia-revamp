import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.BroadcastChannel = undefined;
const { exportStaffCSV, validateStaff, STAFF_KEY } = await import('./staff.js');
const staff = { name: 'Fictional Staff', email: 'staff@example.com', phone: '9876543210', dialCountry: 'IN',
  role: 'Staff', employeeCode: 'SYNTHETIC-001', custom_role_id: '31300000-0000-4000-8000-000000000002',
  designation_id: '31300000-0000-4000-8000-000000000001', designationName: 'Executive', status: 'active', dateOfJoining: '2025-01-01' };
const choices = [{ id: staff.designation_id, name: 'Executive', status: 'active' }];
const roles = [{ id: staff.custom_role_id, name: 'Staff', permissions: [], status: 'active' }];

test('API inputs omit immutable identity and keep phone/date/role validation', () => {
  const result = validateStaff({ ...staff, userId: 'caller-supplied' }, [], null, choices, roles);
  assert.deepEqual(result.errors, {});
  assert.ok(!Object.hasOwn(result.fields, 'userId'));
  for (const override of [{ phone: '123' }, { dialCountry: 'XX' }, { dateOfJoining: '2025-02-30' }, { custom_role_id: 'not-a-saved-role' }, { designation_id: '' }, { employeeCode: '' }]) {
    assert.ok(Object.keys(validateStaff({ ...staff, ...override }, [], null, choices, roles).errors).length);
  }
});
test('CSV is allowlisted, credential-free and formula-protected', () => {
  const csv = exportStaffCSV([{ ...staff, name: '=HYPERLINK("bad")', id: 'internal-uuid',
    userId: 'st_public', initial_password: 'never-export', password_hash: 'never-hash', createdBy: 'internal-actor' }]);
  assert.match(csv, /"'=HYPERLINK/);
  assert.ok(!/internal-|never-/.test(csv));
  assert.match(csv, /Employee Code/);
  assert.ok(!csv.includes('User ID') && !csv.includes('st_public'));
  assert.match(csv, /"Executive"/);
  assert.ok(!csv.includes(staff.designation_id));
});

test('UUID assignment validation preserves only the saved unavailable reference', () => {
  assert.deepEqual(validateStaff(staff, [{ ...staff, id: 'saved' }], 'saved', [], roles).errors, {});
  assert.ok(validateStaff(staff, [], null, [], roles).errors.designation_id);
  assert.ok(validateStaff(staff, [], null, [{ ...choices[0], deleted_at: '2026-01-01' }], roles).errors.designation_id);
  assert.ok(!Object.hasOwn(validateStaff(staff, [], null, choices, roles).fields, 'designationName'));
});
test('CSV includes every supplied loaded record without applying another search or page limit', () => {
  const loaded = Array.from({ length: 100 }, (_, index) => ({
    ...staff, name: `Loaded member ${index + 1}`, employeeCode: `EMP-LOADED-${index + 1}`, userId: `st_loaded_${index + 1}`,
  }));
  const before = structuredClone(loaded);
  const csv = exportStaffCSV(loaded);
  assert.equal(csv.trim().split('\r\n').length, 101);
  assert.ok(csv.includes('"EMP-LOADED-1"'));
  assert.ok(csv.includes('"EMP-LOADED-100"'));
  assert.ok(!csv.includes('"EMP-LOADED-101"') && !csv.includes('st_loaded_'));
  assert.deepEqual(loaded, before);
});
test('legacy staff key remains an identifier only', () => {
  assert.equal(STAFF_KEY, 'evexia.admin.staff.v1');
});
