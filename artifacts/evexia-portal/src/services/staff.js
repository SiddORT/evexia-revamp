import { staffRequest } from '../auth/adminSession.js';
import { dialCountry, normalizePhone } from './phoneCountries.js';

// Retained only as a legacy identifier. This module never reads or mutates it.
export const STAFF_KEY = 'evexia.admin.staff.v1';
export const STAFF_ROLES = ['Staff', 'Manager', 'Accountant', 'Back End', 'Sub Admin', 'Super Admin'];
export const STAFF_COLUMNS = [
  ['name', 'Name'], ['phone', 'Phone No.'], ['dialCountry', 'Dial Country'], ['userId', 'User ID'],
  ['email', 'Email ID'], ['role', 'Role'], ['status', 'Status'], ['designationName', 'Designation'], ['dateOfJoining', 'Date of Joining'],
];
const INPUTS = STAFF_COLUMNS.map(([key]) => key === 'designationName' ? 'designation_id' : key).filter((key) => key !== 'userId');

export function validateStaff(values, _records = [], _exceptId = null, designations = []) {
  const fields = Object.fromEntries(INPUTS.map((key) => [key, typeof values[key] === 'string' ? values[key].trim() : '']));
  const errors = {};
  for (const key of INPUTS) {
    if (!fields[key]) errors[key] = `${key === 'designation_id' ? 'Designation' : STAFF_COLUMNS.find(([field]) => key === field)[1]} is required.`;
    if (fields[key].length > (key === 'email' ? 320 : 200)) errors[key] = 'Value is too long.';
  }
  const country = dialCountry(fields.dialCountry);
  const digits = normalizePhone(fields.phone, fields.dialCountry, 'staff');
  if (!country) errors.dialCountry = 'Choose a supported country.';
  if (country && digits === null) errors.phone = 'Enter a valid phone number for the selected country.';
  if (!errors.phone) fields.phone = digits;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors.email = 'Enter a valid email address.';
  if (!STAFF_ROLES.includes(fields.role)) errors.role = 'Choose a valid role.';
  if (!['active', 'inactive'].includes(fields.status)) errors.status = 'Choose a valid status.';
  const day = fields.dateOfJoining;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) ||
    new Date(day).toISOString().slice(0, 10) !== day || day < '1900-01-01' || day > new Date().toISOString().slice(0, 10)) errors.dateOfJoining = 'Enter a valid joining date that is not in the future.';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fields.designation_id) ||
    (!designations.some((item) => item.id === fields.designation_id && item.status === 'active' && !item.deleted_at) &&
    !_records.some((record) => record.id === _exceptId && record.designation_id === fields.designation_id))) errors.designation_id = 'Choose an active designation.';
  return { fields, errors };
}

export const loadStaff = (offset = 0, options = {}) => staffRequest(`?limit=100&offset=${offset}`, undefined, options);
export const searchStaff = (query, cursor = null, options = {}) => staffRequest('/search', { query, cursor, limit: 100 }, options);
export const getStaff = (id) => staffRequest(`/${id}`);
export const createStaff = (values) => staffRequest('', values);
export const updateStaff = (record, values) => staffRequest(`/${record.id}/edit`, { ...values, expected_version: record.version });
export const setStaffStatus = (record, status) => staffRequest(`/${record.id}/status`, { status, expected_version: record.version });
export const deleteStaff = (record) => staffRequest(`/${record.id}/delete`, { expected_version: record.version });

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

// Explicit access assignment. Separate from metadata edits; never implied by labels.
const UUID = /^[0-9a-f-]{36}$/;
export function validateAccess({ customRoleId, loginEnabled }) {
  if (customRoleId !== null && !(typeof customRoleId === 'string' && UUID.test(customRoleId))) return 'Choose a role from the list or select no role.';
  if (typeof loginEnabled !== 'boolean') return 'Choose whether workspace login is enabled.';
  return '';
}
export const accessOf = (record) => ({ customRoleId: record?.custom_role_id ?? null, loginEnabled: record?.workspace_login_enabled === true });
export function setStaffAccess(record, { customRoleId, loginEnabled }) {
  const problem = validateAccess({ customRoleId, loginEnabled });
  if (problem) return Promise.reject(Object.assign(new Error(problem), { code: 'access_invalid' }));
  return staffRequest(`/${record.id}/access`, { custom_role_id: customRoleId, workspace_login_enabled: loginEnabled, expected_version: record.version });
}
