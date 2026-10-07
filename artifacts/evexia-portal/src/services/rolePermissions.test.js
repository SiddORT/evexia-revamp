import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.BroadcastChannel = undefined;
const { validateRoleName, validateRoleDescription, roleRecord } = await import('./rolePermissions.js');
test('bounded fields reject blank, control characters, oversized text and duplicates but permit own name', () => {
  const roles = [{ id: 'own', name: 'Reviewer' }];
  assert.match(validateRoleName('  '), /Enter/);
  assert.match(validateRoleName(' reviewer ', roles), /already exists/);
  assert.equal(validateRoleName(' reviewer ', roles, 'own'), '');
  assert.equal(validateRoleName('Super Admin'), '');
  assert.match(validateRoleName('x'.repeat(101)), /100/);
  assert.match(validateRoleName('bad\nname'), /control/);
  assert.match(validateRoleDescription('x'.repeat(1001)), /1,000/);
  assert.equal(validateRoleDescription('Line one\nLine two'), '');
});
test('only empty read-only permission metadata is accepted; projection drops unexpected identity fields', () => {
  const row = { id: '00000000-0000-4000-8000-000000000001', name: 'Reviewer', description: '',
    version: 1, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z', permissions: [],
    system_role: 'super_admin' };
  assert.equal(roleRecord(row).system_role, undefined);
  assert.deepEqual(roleRecord(row).permissions, []);
  for (const changes of [{ permissions: ['admin.access'] }, { permissions: null }, { version: 0 }, { id: 'invalid' }]) {
    assert.throws(() => roleRecord({ ...row, ...changes }), /invalid metadata/);
  }
});
