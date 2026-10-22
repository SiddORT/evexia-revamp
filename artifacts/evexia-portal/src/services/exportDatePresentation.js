// Pure file serializer helpers: no React, browser storage, auth or lifecycle.
import { exportDisplayPreferences, effectiveTimeZone, formatCalendarDate, formatTimestamp } from './datePresentation.js';

export function exportDate(value, preferences) {
  return value == null || value === '' ? '' : formatCalendarDate(value, preferences);
}
export function exportTimestamp(value, preferences) {
  return value == null || value === '' ? '' : formatTimestamp(value, preferences, true);
}
export function presentExportTable(headers, rows, { calendarColumns = [], timestampColumns = [] }, preferences) {
  const p = exportDisplayPreferences(preferences);
  const dates = new Set(calendarColumns);
  const instants = new Set(timestampColumns);
  return [
    headers.map((title, index) => instants.has(index) ? title.replace('(UTC)', `(${effectiveTimeZone(p)})`) : title),
    ...rows.map((row) => row.map((value, index) => dates.has(index) ? exportDate(value, p)
      : instants.has(index) ? exportTimestamp(value, p) : value)),
  ];
}
