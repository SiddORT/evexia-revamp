import { DESIGNATION_NUMBERS } from './designations.js';

export function validateServerDesignation(values) {
  const errors = {};
  const fields = {
    name: values.name.trim().replace(/\s+/g, ' '),
    shortName: values.shortName.trim().replace(/\s+/g, ' '),
    level: Number(values.level),
    status: values.status,
  };
  if (!fields.name || fields.name.length > 200) errors.name = 'Use a designation name of 1–200 characters.';
  if (!fields.shortName || fields.shortName.length > 50) errors.shortName = 'Use a short name of 1–50 characters.';
  if (!/^\d+$/.test(String(values.level)) || !Number.isInteger(fields.level) || fields.level < 1 || fields.level > 2147483647) errors.level = 'Use a whole-number level from 1 to 2147483647.';
  if (!['active', 'inactive'].includes(fields.status)) errors.status = 'Select Active or Inactive.';
  for (const [field] of DESIGNATION_NUMBERS) {
    const text = String(values[field] ?? '').trim() || '0';
    if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text) || Number(text) > 999999999.99) errors[field] = 'Use 0–999999999.99 with at most two decimal places.';
    fields[field] = text; // Exact decimal strings, never binary-number conversion.
  }
  return { fields, errors };
}
