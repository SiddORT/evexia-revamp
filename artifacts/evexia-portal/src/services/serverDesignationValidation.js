import { masterNameError, normalizeMasterName } from './masterValidation.js';
export const DESIGNATION_COLUMNS = [
  ['name', 'Designation Name'], ['shortName', 'Short Name'], ['status', 'Status'],
];

export function validateServerDesignation(values) {
  const errors = {};
  const fields = {
    name: normalizeMasterName(values.name),
    shortName: normalizeMasterName(values.shortName),
    status: values.status,
  };
  const nameError = masterNameError(fields.name, 'designation name');
  const shortError = masterNameError(fields.shortName, 'designation short name', { max: 50 });
  if (nameError) errors.name = nameError;
  if (shortError) errors.shortName = shortError;
  if (!['active', 'inactive'].includes(fields.status)) errors.status = 'Select Active or Inactive.';
  return { fields, errors };
}
