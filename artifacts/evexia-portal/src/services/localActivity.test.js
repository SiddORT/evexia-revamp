import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordLocalAction, recordLocalChanges, reportExport, subscribeLocalActivity } from './localActivity.js';

test('metadata-only create/update/delete observations, no payload or record identities', () => {
  const events = [], stop = subscribeLocalActivity((e) => events.push(e));
  recordLocalChanges('patient', [{ id: 'private-id', name: 'PRIVATE', password: 'SECRET' }], [
    { id: 'private-id', name: 'OTHER PRIVATE' }, { id: 'second-private', email: 'PRIVATE' },
  ]);
  recordLocalChanges('patient', [{ id: 'private-id' }], []);
  stop();
  assert.deepEqual(events, [
    { resource: 'patient', action: 'created' }, { resource: 'patient', action: 'updated' },
    { resource: 'patient', action: 'deleted' },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|SECRET|private-id/);
});

test('no-op writes, failed exports and subscriber failures do not alter outcomes', () => {
  const events = [], stop = subscribeLocalActivity((e) => events.push(e));
  recordLocalChanges('zone', [{ id: 'one', name: 'same' }], [{ id: 'one', name: 'same' }]);
  assert.throws(() => reportExport('zone', () => { throw Error('failed'); }), /failed/);
  assert.deepEqual(events, []);
  const stopBad = subscribeLocalActivity(() => { throw Error('offline'); });
  assert.equal(reportExport('zone', () => 'CSV'), 'CSV');
  assert.deepEqual(events, [{ resource: 'zone', action: 'exported' }]);
  stopBad(); stop();
});

test('non-record settings are observed, and free-form metadata is discarded', () => {
  const events = [], stop = subscribeLocalActivity((e) => events.push(e));
  recordLocalChanges('communication', { channels: { email: { enabled: false } } }, { channels: { email: { enabled: true } } });
  recordLocalAction('private-patient-name', 'created');
  recordLocalAction('zone', 'raw-password');
  stop();
  assert.deepEqual(events, [{ resource: 'communication', action: 'settings_changed' }]);
});
