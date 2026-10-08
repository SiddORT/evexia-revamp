import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER_CATALOGUE, MASTER_KEYS, canViewMaster, hasMasterPermission, staffPathAllowed } from './capabilities.js';
const staff = (permissions) => ({ identity_kind: 'staff', system_role: null, permissions: ['workspace.access', ...permissions] });
test('the explicit catalogue is exactly eight masters and forty distinct action keys', () => {
  assert.equal(MASTER_CATALOGUE.length, 8);
  assert.equal(MASTER_KEYS.length, 40);
  assert.equal(new Set(MASTER_KEYS).size, 40);
});
for (const master of MASTER_CATALOGUE) {
  for (const action of ['add', 'edit', 'delete', 'export', 'import']) {
    test(`${master.key}.${action} allows only its master, routes and consuming action`, () => {
      const user = staff([`${master.key}.${action}`]);
      assert.equal(canViewMaster(user, master.key), true);
      for (const other of MASTER_CATALOGUE) {
        assert.equal(canViewMaster(user, other.key), other === master);
        assert.equal(staffPathAllowed(`/admin/masters/${other.path}`, user), other === master);
      }
      assert.equal(staffPathAllowed(`/admin/masters/${master.path}/new`, user), action === 'add');
      assert.equal(staffPathAllowed(`/admin/masters/${master.path}/00000000-0000-4000-8000-000000000001`, user), action === 'edit');
      assert.equal(staffPathAllowed(`/admin/masters/import/${master.import}`, user), action === 'import');
      for (const op of ['add', 'edit', 'delete', 'export', 'import']) assert.equal(hasMasterPermission(user, master.key, op), action === op);
      for (const route of ['/admin/staff', '/admin/roles-permissions', '/admin/settings', '/admin/masters',
        '/admin/masters/designations', `/admin/masters/${master.path}/trash`,
        `/admin/masters/${master.path}/00000000-0000-4000-8000-000000000001/payments`,
        `/admin/masters/${master.path}/00000000-0000-4000-8000-000000000001/dosage-history`]) {
        assert.equal(staffPathAllowed(route, user), false);
      }
    });
  }
}
test('unknown keys, empty roles, labels and names confer no authority; protected identity remains independent', () => {
  const fake = { ...staff(['admin.access', 'doctor.view']), name: 'Super Admin', role: 'Super Admin' };
  for (const master of MASTER_CATALOGUE) assert.equal(canViewMaster(fake, master.key), false);
  const admin = { identity_kind: 'super_admin', permissions: ['admin.access'] };
  for (const master of MASTER_CATALOGUE) assert.equal(hasMasterPermission(admin, master.key, 'import'), true);
  assert.equal(hasMasterPermission(admin, 'designation', 'add'), false);
});
