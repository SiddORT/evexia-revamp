import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPLAY_KEYS, formatAdminDate, formatAdminTimestamp, readAdminPreferences,
  setAdminPreference, subscribeAdminPreferences, validatePreference,
} from './src/components/admin/adminPreferences.js';
import { ADMIN_APPEARANCE_KEY, ADMIN_THEME_KEY } from './src/components/admin/adminTheme.js';

test('saved choices are validated and existing theme and appearance keys still load', () => {
  const saved = new Map([
    [ADMIN_THEME_KEY, 'modern'], [ADMIN_APPEARANCE_KEY, 'dark'],
    [DISPLAY_KEYS.dateFormat, 'yyyy-mm-dd'], [DISPLAY_KEYS.timeZone, 'invalid/zone'], [DISPLAY_KEYS.clock, '13'],
  ]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) } };
  try {
    assert.deepEqual(readAdminPreferences(), { dateFormat: 'yyyy-mm-dd', timeZone: 'browser', clock: '12', theme: 'modern', appearance: 'dark' });
    assert.equal(validatePreference('dateFormat', '__proto__'), 'dd-mmm-yyyy');
    assert.equal(validatePreference('timeZone', 'Mars/Olympus'), 'browser');
    let updates = 0;
    const unsubscribe = subscribeAdminPreferences(() => { updates++; });
    setAdminPreference('appearance', 'light');
    setAdminPreference('theme', 'classic');
    setAdminPreference('dateFormat', 'dd-mm-yyyy');
    setAdminPreference('timeZone', 'UTC');
    setAdminPreference('clock', '24');
    setAdminPreference('clock', 'invalid');
    unsubscribe();
    assert.equal(updates, 5);
    assert.equal(saved.get(ADMIN_APPEARANCE_KEY), 'light');
    assert.equal(saved.get(ADMIN_THEME_KEY), 'classic');
    assert.equal(saved.get(DISPLAY_KEYS.dateFormat), 'dd-mm-yyyy');
    assert.equal(saved.get(DISPLAY_KEYS.timeZone), 'UTC');
    assert.equal(saved.get(DISPLAY_KEYS.clock), '24');
  } finally { delete globalThis.window; }
});

test('inaccessible storage falls back without throwing', () => {
  globalThis.window = { localStorage: { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } } };
  try {
    assert.deepEqual(readAdminPreferences(), { dateFormat: 'dd-mmm-yyyy', timeZone: 'browser', clock: '12', theme: 'classic', appearance: 'light' });
    assert.doesNotThrow(() => setAdminPreference('clock', '12'));
  } finally { delete globalThis.window; }
});

test('calendar days do not move across zones; timestamps do, using either clock', () => {
  const base = { dateFormat: 'yyyy-mm-dd', timeZone: 'America/Los_Angeles', clock: '24' };
  assert.equal(formatAdminDate('2026-01-01', base), '2026-01-01');
  assert.equal(formatAdminDate('2026-02-30', base), '—');
  assert.equal(formatAdminTimestamp('2026-01-01T01:15:00Z', base), '2025-12-31, 17:15');
  assert.equal(formatAdminTimestamp('2026-01-01T01:15:00Z', { ...base, timeZone: 'UTC', clock: '12' }), '2026-01-01, 01:15 AM');
  assert.equal(formatAdminDate('2026-01-01', { ...base, timeZone: 'Asia/Kolkata', dateFormat: 'dd-mmm-yyyy' }), '01 Jan 2026');
  assert.equal(formatAdminTimestamp('not a date', base), '—');
});