export const DESIGNATION_COLUMNS = [
  ['name', 'Designation Name'], ['shortName', 'Short Name'], ['status', 'Status'],
];

export function validateServerDesignation(values) {
  const errors = {};
  const fields = {
    name: values.name.trim().replace(/\s+/g, ' '),
    shortName: values.shortName.trim().replace(/\s+/g, ' '),
    status: values.status,
  };
  if (!fields.name || fields.name.length > 200) errors.name = 'Use a designation name of 1–200 characters.';
  if (!fields.shortName || fields.shortName.length > 50) errors.shortName = 'Use a short name of 1–50 characters.';
  if (!['active', 'inactive'].includes(fields.status)) errors.status = 'Select Active or Inactive.';
  return { fields, errors };
}
