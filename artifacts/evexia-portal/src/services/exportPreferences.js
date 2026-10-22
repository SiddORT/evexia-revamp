// Browser export boundary only. Pure serializers receive the captured result.
import { DISPLAY_DEFAULTS, exportDisplayPreferences, effectiveTimeZone } from './datePresentation.js';

const unsaved = {};
export function setUnsavedExportPreference(key, value) {
  if (value === undefined) delete unsaved[key];
  else unsaved[key] = value;
}
export function captureExportPreferences() {
  const values = {};
  for (const key of Object.keys(DISPLAY_DEFAULTS)) {
    try { values[key] = window.localStorage.getItem(`evexia.admin.${key}`); }
    catch { values[key] = DISPLAY_DEFAULTS[key]; }
    if (Object.hasOwn(unsaved, key)) values[key] = unsaved[key];
  }
  return exportDisplayPreferences(values);
}
export function exportPreferenceHeader(preferences) {
  return JSON.stringify({ dateFormat: preferences.dateFormat, timeZone: effectiveTimeZone(preferences), clock: preferences.clock });
}
