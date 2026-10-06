import { recordLocalAction } from '../../services/localActivity.js';
import { useSyncExternalStore } from 'react';
import { ADMIN_APPEARANCES, ADMIN_THEMES, readAdminAppearance, readAdminTheme, saveAdminAppearance, saveAdminTheme } from './adminTheme.js';

export const DATE_FORMATS = { 'dd-mmm-yyyy': 'DD MMM YYYY', 'mm-dd-yyyy': 'MM/DD/YYYY', 'dd-mm-yyyy': 'DD/MM/YYYY', 'yyyy-mm-dd': 'YYYY-MM-DD' };
export const CLOCK_FORMATS = { '12': '12-hour', '24': '24-hour' };
export const TIME_ZONES = {
  browser: 'Browser default',
  UTC: 'UTC',
  'Asia/Kolkata': 'Asia/Kolkata',
  'Europe/London': 'Europe/London',
  'America/New_York': 'America/New_York',
  'America/Los_Angeles': 'America/Los_Angeles',
  'Asia/Dubai': 'Asia/Dubai',
  'Asia/Singapore': 'Asia/Singapore',
  'Australia/Sydney': 'Australia/Sydney',
};
export const DISPLAY_KEYS = {
  dateFormat: 'evexia.admin.dateFormat',
  timeZone: 'evexia.admin.timeZone',
  clock: 'evexia.admin.clock',
};
export const DISPLAY_DEFAULTS = { dateFormat: 'dd-mmm-yyyy', timeZone: 'browser', clock: '12' };
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

function dateOptions(format) {
  if (format === 'yyyy-mm-dd') return null;
  return { year: 'numeric', month: format === 'dd-mmm-yyyy' ? 'short' : '2-digit', day: '2-digit' };
}
function renderDate(parts, format) {
  const { year, month, day } = parts;
  if (format === 'yyyy-mm-dd') return `${year}-${month}-${day}`;
  if (format === 'mm-dd-yyyy') return `${month}/${day}/${year}`;
  if (format === 'dd-mm-yyyy') return `${day}/${month}/${year}`;
  return `${day} ${month} ${year}`;
}
function partsOf(date, preferences, calendarOnly) {
  const format = validatePreference('dateFormat', preferences.dateFormat);
  const options = dateOptions(format);
  const zone = calendarOnly ? 'UTC' : validatePreference('timeZone', preferences.timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    ...(options || { year: 'numeric', month: '2-digit', day: '2-digit' }),
    ...(zone === 'browser' ? {} : { timeZone: zone }),
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return renderDate(parts, format);
}
// Calendar-only values are not instants: UTC is used only as a neutral parsing
// frame. The user's time zone is intentionally never applied to these values.
export function formatAdminDate(value, preferences = snapshot()) {
  if (!value) return '—';
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '—';
  const date = new Date(`${text}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return '—';
  return partsOf(date, preferences, true);
}
export function formatAdminTimestamp(value, preferences = snapshot(), seconds = false) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const zone = validatePreference('timeZone', preferences.timeZone);
  const clock = validatePreference('clock', preferences.clock);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
    hour12: clock === '12', ...(zone === 'browser' ? {} : { timeZone: zone }),
  }).format(date);
  return `${partsOf(date, preferences, false)}, ${time}`;
}