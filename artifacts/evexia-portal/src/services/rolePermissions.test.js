import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, MODULES, ALL_PERMISSION_KEYS, permissionKeys, selectionSummary, togglePermissions, validateRoleName, createDemoRoles } from './rolePermissions.js';

test('catalogue derives unique supported permissions from existing EVEXIA features', () => {
  assert.deepEqual(MODULES.map((module) => module.id), ['dashboard', 'masters', 'inventory', 'users', 'settings']);
  assert.equal(new Set(ALL_PERMISSION_KEYS).size, ALL_PERMISSION_KEYS.length);
  assert.deepEqual(permissionKeys(MODULES[0].rows), ['dashboard:view']);
  assert.deepEqual(permissionKeys(MODULES[0].rows, 'delete'), []);
  for (const module of MODULES) for (const row of module.rows) for (const action of row.actions) assert.ok(ACTIONS.some((item) => item.id === action));
});
test('aggregate selection has empty, mixed and full states; toggles are immutable', () => {
  const keys = permissionKeys(MODULES[2].rows);
  const initial = [keys[0], 'dashboard:view'];
  assert.deepEqual(selectionSummary([], []), { checked: false, mixed: false, count: 0, total: 0 });
  assert.equal(selectionSummary(initial, keys).mixed, true);
  const all = togglePermissions(initial, keys);
  assert.equal(selectionSummary(all, keys).checked, true);
  assert.deepEqual(togglePermissions(all, keys), ['dashboard:view']);
  assert.deepEqual(initial, [keys[0], 'dashboard:view']);
  assert.deepEqual(togglePermissions([], ['dashboard:delete']), []);
});
test('filtered row/column toggles preserve hidden selections and exclude unsupported actions', () => {
  const keys = permissionKeys(MODULES[1].rows, 'delete');
  assert.equal(keys.length, 3);
  const initial = ['patients:view'];
  const changed = togglePermissions(initial, permissionKeys([MODULES[1].rows[0]], 'view'));
  assert.ok(changed.includes('patients:view'));
  assert.ok(changed.includes('zones:view'));
});
test('role names reject blank and case-insensitive trimmed duplicates', () => {
  const roles = createDemoRoles();
  assert.ok(validateRoleName('  ', roles));
  assert.ok(validateRoleName(' demo coordinator ', roles));
  assert.equal(validateRoleName('  Fictional New Role  ', roles), '');
});
test('fictional drafts and saved snapshots are independent and reset with a new page model', () => {
  const roles = createDemoRoles();
  assert.notEqual(roles[0].permissions, roles[0].savedPermissions);
  roles[0].permissions.pop();
  assert.equal(roles[0].savedPermissions.length, ALL_PERMISSION_KEYS.length);
  roles[1].permissions.push('dashboard:view');
  assert.ok(!createDemoRoles()[1].permissions.includes('dashboard:view'));
  assert.equal(createDemoRoles()[0].permissions.length, ALL_PERMISSION_KEYS.length);
});
