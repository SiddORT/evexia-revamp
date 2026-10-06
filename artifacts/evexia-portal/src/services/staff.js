import { staffRequest } from '../auth/adminSession.js';
import { dialCountry } from './phoneCountries.js';

// Retained only as a legacy identifier. This module never reads or mutates it.
export const STAFF_KEY = 'evexia.admin.staff.v1';
export const STAFF_ROLES = ['Staff', 'Manager', 'Accountant', 'Back End', 'Sub Admin', 'Super Admin'];
export const STAFF_COLUMNS = [
  ['name', 'Name'], ['phone', 'Phone No.'], ['dialCountry', 'Dial Country'], ['userId', 'User ID'],
  ['email', 'Email ID'], ['role', 'Role'], ['status', 'Status'], ['designation', 'Designation'], ['dateOfJoining', 'Date of Joining'],
];
const INPUTS = STAFF_COLUMNS.map(([key]) => key).filter((key) => key !== 'userId');

export function validateStaff(values, _records = [], _exceptId = null, designations = []) {
  const fields = Object.fromEntries(INPUTS.map((key) => [key, typeof values[key] === 'string' ? values[key].trim() : '']));
  const errors = {};
  for (const key of INPUTS) {
    if (!fields[key]) errors[key] = `${STAFF_COLUMNS.find(([field]) => key === field)[1]} is required.`;
    if (fields[key].length > (key === 'email' ? 320 : 200)) errors[key] = 'Value is too long.';
  }
  const country = dialCountry(fields.dialCountry);
  const local = fields.dialCountry === 'IN' ? fields.phone.replace(/^\+91[\s-]?/, '') : fields.phone;
  const digits = local.replace(/[\s()-]/g, '');
  if (!country) errors.dialCountry = 'Choose a supported country.';
  if (country && (!/^[0-9\s()-]+$/.test(local) || digits.length !== country.digits ||
    (country.value === 'IN' && !/^[6-9]\d{9}$/.test(digits)))) errors.phone = 'Enter a valid phone number for the selected country.';
  if (!errors.phone) fields.phone = digits;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors.email = 'Enter a valid email address.';
  if (!STAFF_ROLES.includes(fields.role)) errors.role = 'Choose a valid role.';
  if (!['active', 'inactive'].includes(fields.status)) errors.status = 'Choose a valid status.';
  const day = fields.dateOfJoining;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) ||
    new Date(day).toISOString().slice(0, 10) !== day || day < '1900-01-01' || day > new Date().toISOString().slice(0, 10)) errors.dateOfJoining = 'Enter a valid joining date that is not in the future.';
  if (designations.length && !designations.some((item) => item.name === fields.designation && item.status === 'active') &&
    !_records.some((record) => record.id === _exceptId && record.designation === fields.designation)) errors.designation = 'Choose an active designation.';
  return { fields, errors };
}

export const loadStaff = (offset = 0, options = {}) => staffRequest(`?limit=100&offset=${offset}`, undefined, options);
export const getStaff = (id) => staffRequest(`/${id}`);
export const createStaff = (values) => staffRequest('', values);
export const updateStaff = (record, values) => staffRequest(`/${record.id}/edit`, { ...values, expected_version: record.version });
export const setStaffStatus = (record, status) => staffRequest(`/${record.id}/status`, { status, expected_version: record.version });

function csvCell(value) {
  const text = String(value ?? '');
  const protectedText = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}
export function exportStaffCSV(records) {
  // Explicit allowlist excludes passwords, hashes, internal User/profile UUIDs and audit references.
  return STAFF_COLUMNS.map(([, label]) => csvCell(label)).join(',') + '\r\n'
    + records.map((row) => STAFF_COLUMNS.map(([key]) => csvCell(row[key])).join(',')).join('\r\n') + '\r\n';
}
