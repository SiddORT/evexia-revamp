import test from 'node:test';
import assert from 'node:assert/strict';
import { DATE_FORMATS, TIME_ZONES, formatCalendarDate as date, formatTimestamp as stamp, displayPreferences } from './src/services/datePresentation.js';

test('every date style stays on the same calendar day in every supported zone and clock', () => {
  const expected = ['31 Dec 2026', '12/31/2026', '31/12/2026', '2026-12-31'];
  for (const [index, dateFormat] of Object.keys(DATE_FORMATS).entries()) {
    for (const timeZone of Object.keys(TIME_ZONES)) for (const clock of ['12', '24']) {
      assert.equal(date('2026-12-31', { dateFormat, timeZone, clock }), expected[index]);
    }
  }
});

test('instants cross midnight, both DST transitions, and explicit offsets without changing calendar values', () => {
  const p = { dateFormat: 'yyyy-mm-dd', timeZone: 'America/New_York', clock: '24' };
  assert.equal(stamp('2026-01-01T01:15:12Z', p, true), '2025-12-31, 20:15:12');
  assert.equal(stamp('2026-03-08T06:59:59Z', p, true), '2026-03-08, 01:59:59');
  assert.equal(stamp('2026-03-08T07:00:00Z', p, true), '2026-03-08, 03:00:00');
  assert.equal(stamp('2026-11-01T05:30:00Z', p), '2026-11-01, 01:30');
  assert.equal(stamp('2026-11-01T06:30:00Z', p), '2026-11-01, 01:30');
  assert.equal(stamp('2026-01-01T00:00:00Z', { ...p, timeZone: 'UTC' }), '2026-01-01, 00:00');
  assert.equal(stamp('2026-01-01T05:30:00+05:30', { ...p, timeZone: 'UTC', clock: '12' }), '2026-01-01, 12:00 AM');
});

test('all formats apply to timestamp dates with either clock and browser/default zone', () => {
  const input = '2026-12-31T13:14:15Z';
  const expected = ['31 Dec 2026', '12/31/2026', '31/12/2026', '2026-12-31'];
  for (const [index, dateFormat] of Object.keys(DATE_FORMATS).entries()) {
    for (const clock of ['12', '24']) {
      const p = { dateFormat, clock, timeZone: 'UTC' };
      assert.equal(stamp(input, p, true), `${expected[index]}, ${clock === '12' ? '01:14:15 PM' : '13:14:15'}`);
      const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      assert.equal(stamp(new Date(input), { ...p, timeZone: 'browser' }), stamp(input, { ...p, timeZone: browserZone }));
    }
  }
});

test('invalid, absent and ambiguous values use one safe placeholder; snapshots are validated and immutable', () => {
  for (const value of [null, undefined, '', 'garbage', '2026-02-30', '2026-13-01', '2026-2-1', new Date(NaN), 0, {}]) {
    assert.equal(date(value), '—');
    assert.equal(stamp(value), '—');
  }
  for (const value of ['2026-02-30T10:00:00Z', '2026-01-01T10:00:00', '2026-01-01T25:00:00Z']) assert.equal(stamp(value), '—');
  assert.equal(date('2024-02-29'), '29 Feb 2024');
  assert.equal(date('2025-02-29'), '—');
  const p = displayPreferences({ dateFormat: '__proto__', clock: 'garbage', timeZone: 'Mars' });
  assert.deepEqual(p, { dateFormat: 'dd-mmm-yyyy', timeZone: 'browser', clock: '12' });
  assert.ok(Object.isFrozen(p));
});
