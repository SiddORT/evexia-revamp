import { masterNameError, normalizeMasterName } from './masterValidation.js';
export const DESIGNATION_COLUMNS = [
  ['name', 'Designation Name'], ['shortName', 'Short Name'], ['status', 'Status'],
];

// Entry assistance only: never call while reading saved records or importing.
export function suggestDesignationShortName(name) {
  const words = normalizeMasterName(name).match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}\u200c\u200d]*/gu) || [];
  const initials = words.map((word) => word.match(/^[\p{L}\p{N}]\p{M}*/u)[0]).join('').toUpperCase();
  return Array.from(initials).slice(0, 50).join('');
}

export function validateServerDesignation(values) {
  const errors = {};
  const fields = {
    name: normalizeMasterName(values.name),
    shortName: normalizeMasterName(values.shortName),
    status: values.status,
  };
  const nameError = masterNameError(fields.name, 'designation name');
  const shortError = fields.shortName ? masterNameError(fields.shortName, 'designation short name', { max: 50 }) : '';
  if (nameError) errors.name = nameError;
  if (shortError) errors.shortName = shortError;
  if (!['active', 'inactive'].includes(fields.status)) errors.status = 'Select Active or Inactive.';
  return { fields, errors };
}
