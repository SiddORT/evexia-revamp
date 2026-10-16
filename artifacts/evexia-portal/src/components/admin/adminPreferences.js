import { recordLocalAction } from '../../services/localActivity.js';
import { useSyncExternalStore } from 'react';
import { DATE_FORMATS, CLOCK_FORMATS, TIME_ZONES, DISPLAY_DEFAULTS, displayPreferences, formatCalendarDate, formatTimestamp } from '../../services/datePresentation.js';
export { DATE_FORMATS, CLOCK_FORMATS, TIME_ZONES, DISPLAY_DEFAULTS } from '../../services/datePresentation.js';
import { ADMIN_APPEARANCES, ADMIN_THEMES, readAdminAppearance, readAdminTheme, saveAdminAppearance, saveAdminTheme } from './adminTheme.js';

export const DISPLAY_KEYS = {
  dateFormat: 'evexia.admin.dateFormat',
  timeZone: 'evexia.admin.timeZone',
  clock: 'evexia.admin.clock',
};
const OPTIONS = { dateFormat: DATE_FORMATS, timeZone: TIME_ZONES, clock: CLOCK_FORMATS, theme: ADMIN_THEMES, appearance: ADMIN_APPEARANCES };

export function validatePreference(key, value) {
  return typeof value === 'string' && Object.hasOwn(OPTIONS[key] || {}, value)
    ? value : (DISPLAY_DEFAULTS[key] ?? (key === 'theme' ? 'classic' : 'light'));
}

function read(key) {
  if (key === 'theme') return readAdminTheme();
  if (key === 'appearance') return readAdminAppearance();
  try { return validatePreference(key, window.localStorage.getItem(DISPLAY_KEYS[key])); }
  catch { return DISPLAY_DEFAULTS[key]; }
}

export function readAdminPreferences() {
  return { dateFormat: read('dateFormat'), timeZone: read('timeZone'), clock: read('clock'), theme: read('theme'), appearance: read('appearance') };
}

let current;
const listeners = new Set();
function snapshot() {
  if (!current) current = readAdminPreferences();
  return current;
}
export function subscribeAdminPreferences(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useAdminPreferences() {
  return useSyncExternalStore(subscribeAdminPreferences, snapshot, () => ({ ...DISPLAY_DEFAULTS, theme: 'classic', appearance: 'light' }));
}
export function setAdminPreference(key, value) {
  if (!Object.hasOwn(OPTIONS, key) || validatePreference(key, value) !== value) return;
  current = { ...snapshot(), [key]: value };
  if (key === 'theme') saveAdminTheme(value);
  else if (key === 'appearance') saveAdminAppearance(value);
  else try { window.localStorage.setItem(DISPLAY_KEYS[key], value); }
  catch { /* In-memory choice remains active for this visit. */ }
  recordLocalAction('settings', 'settings_changed');
  listeners.forEach((listener) => listener());
}

export function getAdminDisplayPreferences() {
  return displayPreferences(snapshot());
}
export function useAdminDateFormatters() {
  const preferences = useAdminPreferences();
  return {
    date: (value) => formatCalendarDate(value, preferences),
    timestamp: (value, seconds = false) => formatTimestamp(value, preferences, seconds),
  };
}
export function formatAdminDate(value, preferences = snapshot()) {
  return formatCalendarDate(value, preferences);
}
export function formatAdminTimestamp(value, preferences = snapshot(), seconds = false) {
  return formatTimestamp(value, preferences, seconds);
}