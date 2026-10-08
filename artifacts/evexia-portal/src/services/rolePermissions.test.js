import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.BroadcastChannel = undefined;
const { validateRoleName, validateRoleDescription, roleRecord, samePermissions, setRolePermissions, normalizePermissions, validPermissions } = await import('./rolePermissions.js');
const { MASTER_KEYS } = await import('../auth/capabilities.js');
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
test('permissions accept supported master keys, normalised; unknown keys refused; identity fields dropped', () => {
  const row = { id: '00000000-0000-4000-8000-000000000001', name: 'Reviewer', description: '',
    version: 1, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z', permissions: [],
    system_role: 'super_admin' };
  assert.equal(roleRecord(row).system_role, undefined);
  assert.deepEqual(roleRecord({ ...row, permissions: ['zone.import', 'zone.add'] }).permissions, ['zone.add', 'zone.import']);
  assert.throws(() => roleRecord({ ...row, permissions: ['admin.access'] }), /does not recognise/);
  assert.throws(() => roleRecord({ ...row, permissions: ['zone.add', 'zone.add'] }), /does not recognise/);
  for (const changes of [{ permissions: null }, { version: 0 }, { id: 'invalid' }]) {
    assert.throws(() => roleRecord({ ...row, ...changes }), /invalid metadata/);
  }
  assert.equal(samePermissions(['zone.edit', 'zone.add'], ['zone.add', 'zone.edit']), true);
  assert.equal(samePermissions([], ['zone.add']), false);
});
test('all forty, mixed-master and hidden selections round-trip without automatic grants', () => {
  for (const selection of [[], ['zone.add', 'patient.import', 'doctor.export'], [...MASTER_KEYS].reverse()]) {
    assert.equal(validPermissions(selection), true);
    assert.deepEqual(normalizePermissions(selection), MASTER_KEYS.filter((key) => selection.includes(key)));
    assert.equal(samePermissions(selection, normalizePermissions(selection)), true);
  }
  assert.equal(validPermissions(['designation.add']), false);
  assert.equal(validPermissions([...MASTER_KEYS, 'domain.provision']), false);
});
test('setRolePermissions rejects unknown keys before any request', () => {
  assert.throws(() => setRolePermissions('00000000-0000-4000-8000-000000000001', ['zone.view'], 1), /listed master/);
});
test('zero, partial and all selections keep the five-key scope and never mutate supplied selections', () => {
  const all = ['zone.add', 'zone.edit', 'zone.delete', 'zone.export', 'zone.import'];
  for (const selection of [[], ['zone.import'], [...all].reverse()]) {
    const before = [...selection];
    assert.equal(validPermissions(selection), true);
    assert.deepEqual(normalizePermissions(selection), all.filter((key) => selection.includes(key)));
    assert.deepEqual(selection, before);
  }
  assert.equal(validPermissions(['zone.add', 'zone.add']), false);
  assert.equal(validPermissions(['masters.all']), false);
});
