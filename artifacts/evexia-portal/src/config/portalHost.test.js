import test from 'node:test';
import assert from 'node:assert/strict';
import { compatiblePortalPath, portalEntry } from './portalHost.js';

test('hostname role entry uses existing routes, including Doctor preview only', () => {
  assert.equal(portalEntry('admin'), '/admin/login');
  assert.equal(portalEntry('mr'), '/mr');
  assert.equal(portalEntry('doctor'), '/doctor');
  assert.equal(portalEntry(null), '/');
});
test('mapped portal preserves its own deep links but rejects incompatible prefixes', () => {
  for (const role of ['admin', 'mr', 'doctor']) {
    assert.equal(compatiblePortalPath(`/${role}`, role), true);
    assert.equal(compatiblePortalPath(`/${role}/nested/path`, role), true);
    assert.equal(compatiblePortalPath(`/${role}other`, role), false);
    assert.equal(compatiblePortalPath('/', role), false);
    for (const other of ['admin', 'mr', 'doctor'].filter((r) => r !== role)) {
      assert.equal(compatiblePortalPath(`/${other}`, role), false);
    }
  }
});
