import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.BroadcastChannel = undefined;
const { exportStaffCSV, validateStaff, STAFF_KEY } = await import('./staff.js');
const staff = { name: 'Fictional Staff', email: 'staff@example.com', phone: '9876543210', dialCountry: 'IN',
  role: 'Staff', designation: 'Executive', status: 'active', dateOfJoining: '2025-01-01' };

test('API inputs omit immutable identity and keep phone/date/role validation', () => {
  const result = validateStaff({ ...staff, userId: 'caller-supplied' });
  assert.deepEqual(result.errors, {});
  assert.ok(!Object.hasOwn(result.fields, 'userId'));
  for (const override of [{ phone: '123' }, { dialCountry: 'XX' }, { dateOfJoining: '2025-02-30' }, { role: 'admin' }, { designation: '' }]) {
    assert.ok(Object.keys(validateStaff({ ...staff, ...override }).errors).length);
  }
});
test('CSV is allowlisted, credential-free and formula-protected', () => {
  const csv = exportStaffCSV([{ ...staff, name: '=HYPERLINK("bad")', id: 'internal-uuid',
    userId: 'st_public', initial_password: 'never-export', password_hash: 'never-hash', createdBy: 'internal-actor' }]);
  assert.match(csv, /"'=HYPERLINK/);
  assert.ok(!/internal-|never-/.test(csv));
  assert.match(csv, /User ID/);
});
test('CSV includes every supplied loaded record without applying another search or page limit', () => {
  const loaded = Array.from({ length: 100 }, (_, index) => ({
    ...staff, name: `Loaded member ${index + 1}`, userId: `st_loaded_${index + 1}`,
  }));
  const before = structuredClone(loaded);
  const csv = exportStaffCSV(loaded);
  assert.equal(csv.trim().split('\r\n').length, 101);
  assert.ok(csv.includes('"st_loaded_1"'));
  assert.ok(csv.includes('"st_loaded_100"'));
  assert.ok(!csv.includes('"st_loaded_101"'));
  assert.deepEqual(loaded, before);
});
test('legacy staff key remains an identifier only', () => {
  assert.equal(STAFF_KEY, 'evexia.admin.staff.v1');
});
