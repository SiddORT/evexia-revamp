// Pure presentation only: no React, storage, activity or authentication imports.
export const DATE_FORMATS = { 'dd-mmm-yyyy': 'DD MMM YYYY', 'mm-dd-yyyy': 'MM/DD/YYYY', 'dd-mm-yyyy': 'DD/MM/YYYY', 'yyyy-mm-dd': 'YYYY-MM-DD' };
export const CLOCK_FORMATS = { '12': '12-hour', '24': '24-hour' };
export const TIME_ZONES = {
  browser: 'Browser default', UTC: 'UTC', 'Asia/Kolkata': 'Asia/Kolkata',
  'Europe/London': 'Europe/London', 'America/New_York': 'America/New_York',
  'America/Los_Angeles': 'America/Los_Angeles', 'Asia/Dubai': 'Asia/Dubai',
  'Asia/Singapore': 'Asia/Singapore', 'Australia/Sydney': 'Australia/Sydney',
};
export const DISPLAY_DEFAULTS = Object.freeze({ dateFormat: 'dd-mmm-yyyy', timeZone: 'browser', clock: '12' });
export function displayPreferences(preferences = DISPLAY_DEFAULTS) {
  const validated = Object.fromEntries(Object.entries({ dateFormat: DATE_FORMATS, timeZone: TIME_ZONES, clock: CLOCK_FORMATS })
    .map(([key, options]) => [key, Object.hasOwn(options, preferences?.[key]) ? preferences[key] : DISPLAY_DEFAULTS[key]]));
  if (validated.timeZone === 'browser' && typeof preferences?.resolvedTimeZone === 'string') {
    // Export snapshots may resolve to any valid browser IANA zone, not only a
    // named Settings option. Never let a changed browser zone alter that file.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: preferences.resolvedTimeZone });
      validated.resolvedTimeZone = preferences.resolvedTimeZone;
    } catch { /* Invalid explicit zones are not trusted. */ }
  }
  return Object.freeze(validated);
}
export function exportDisplayPreferences(preferences = DISPLAY_DEFAULTS) {
  const p = displayPreferences(preferences);
  return Object.freeze({ ...p, resolvedTimeZone: p.timeZone === 'browser'
    ? p.resolvedTimeZone || new Intl.DateTimeFormat().resolvedOptions().timeZone
    : p.timeZone });
}
export function effectiveTimeZone(preferences) {
  return preferences.timeZone === 'browser' ? preferences.resolvedTimeZone : preferences.timeZone;
}
function dateText(date, preferences, calendarOnly) {
  const { dateFormat } = preferences;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: dateFormat === 'dd-mmm-yyyy' ? 'short' : '2-digit', day: '2-digit',
    ...(calendarOnly ? { timeZone: 'UTC' } : effectiveTimeZone(preferences) ? { timeZone: effectiveTimeZone(preferences) } : {}),
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  const { year, month, day } = parts;
  if (dateFormat === 'yyyy-mm-dd') return `${year}-${month}-${day}`;
  if (dateFormat === 'mm-dd-yyyy') return `${month}/${day}/${year}`;
  if (dateFormat === 'dd-mm-yyyy') return `${day}/${month}/${year}`;
  return `${day} ${month} ${year}`;
}
export function formatCalendarDate(value, preferences = DISPLAY_DEFAULTS) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return '—';
  return dateText(date, displayPreferences(preferences), true);
}
export function formatTimestamp(value, preferences = DISPLAY_DEFAULTS, seconds = false) {
  // Date-only and offset-free strings are not unambiguous instants.
  if (!(value instanceof Date) && (typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value))) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  if (typeof value === 'string' && formatCalendarDate(value.slice(0, 10)) === '—') return '—';
  if (typeof value === 'string') {
    const [hour, minute, second = '0'] = value.slice(11).split(/[:Z+-]/i);
    if (+hour > 23 || +minute > 59 || +second >= 60) return '—';
  }
  const p = displayPreferences(preferences);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
    hourCycle: p.clock === '12' ? 'h12' : 'h23',
    ...(effectiveTimeZone(p) ? { timeZone: effectiveTimeZone(p) } : {}),
  }).format(date);
  return `${dateText(date, p, false)}, ${time}`;
}
