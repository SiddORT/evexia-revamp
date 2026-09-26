import { parseCSV } from './masterImport.js';
import { loadDesignations } from './designations.js';

export const STAFF_KEY = 'evexia.admin.staff.v1';
export const STAFF_ROLES = ['Staff', 'Manager', 'Accountant', 'Back End', 'Sub Admin', 'Super Admin'];
export const STAFF_COLUMNS = [
  ['name', 'Name'], ['phone', 'Phone No.'], ['userId', 'User ID'], ['email', 'Email ID'],
  ['role', 'Role'], ['status', 'Status'], ['designation', 'Designation'], ['dateOfJoining', 'Date of Joining'],
];
const KEYS = STAFF_COLUMNS.map(([key]) => key);
const STORED = [...KEYS, 'id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'];
const ACTOR = 'Admin User';
const norm = (value) => value.trim().toLocaleLowerCase();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const invalidSaved = 'Saved staff data is invalid. Nothing was changed. Back up or repair browser storage before retrying.';
const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const nextTime = (value) => new Date(Math.max(Date.now(), Date.parse(value) + 1)).toISOString();
const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function validateStaff(values, records = [], exceptId = null, designations = []) {
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
    Object.keys(values).some((key) => !KEYS.includes(key))) {
    return { fields: null, errors: { form: 'Staff data contains unsupported fields. Passwords and invitation details cannot be saved.' } };
  }
  const fields = Object.fromEntries(KEYS.map((key) => [key, typeof values[key] === 'string' ? values[key].trim() : '']));
  const errors = {};
  for (const [key, label] of STAFF_COLUMNS) {
    if (!fields[key] && (key !== 'designation' || designations.length)) errors[key] = `${label} is required.`;
    if (fields[key].length > 200) errors[key] = `${label} must be 200 characters or fewer.`;
  }
  if (fields.phone && !/^(?:\+91[\s-]?)?[6-9]\d{9}$/.test(fields.phone)) errors.phone = 'Enter a 10-digit Indian mobile number (optionally +91).';
  if (fields.userId && !/^[a-zA-Z0-9][a-zA-Z0-9._@-]{2,79}$/.test(fields.userId)) errors.userId = 'User ID must be 3–80 letters, numbers, dots, underscores, @ or hyphens.';
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors.email = 'Enter a valid email address.';
  if (fields.role && !STAFF_ROLES.includes(fields.role)) errors.role = 'Choose a valid role.';
  if (fields.status && !['active', 'inactive'].includes(fields.status)) errors.status = 'Choose an active or inactive status.';
  if (fields.dateOfJoining && (!validDay(fields.dateOfJoining) || fields.dateOfJoining > new Date().toISOString().slice(0, 10))) errors.dateOfJoining = 'Enter a valid joining date that is not in the future.';
  if (fields.designation && designations.length && !designations.some((item) =>
    item.name === fields.designation && (item.status === 'active' || records.some((record) => record.id === exceptId && record.designation === fields.designation)))) {
    errors.designation = 'Choose an active Designation Master entry.';
  }
  for (const [key, label] of [['userId', 'User ID'], ['email', 'Email ID']]) {
    if (fields[key] && records.some((item) => item.id !== exceptId && norm(item[key]) === norm(fields[key]))) errors[key] = `${label} already exists.`;
  }
  return { fields, errors };
}

function samples() {
  return [
    ['Sample Asha Rao', '9876543210', 'sample.asha', 'asha@example.test', 'Manager', 'active', '', '2025-02-10'],
    ['Sample Dev Mehta', '9876543211', 'sample.dev', 'dev@example.test', 'Accountant', 'active', '', '2025-03-11'],
    ['Sample Isha Shah', '9876543212', 'sample.isha', 'isha@example.test', 'Staff', 'inactive', '', '2025-04-15'],
  ].map((cells, index) => {
    const fields = Object.fromEntries(KEYS.map((key, i) => [key, cells[i]]));
    const now = new Date(Date.UTC(2025, 4, index + 1, 9)).toISOString();
    return { ...fields, id: `sample-staff-${index + 1}`, createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now };
  });
}

export function loadStaff() {
  let raw;
  try { raw = window.localStorage.getItem(STAFF_KEY); }
  catch { throw new Error('Staff records could not be loaded because browser storage is unavailable.'); }
  if (raw === null) {
    const initial = samples();
    try {
      if (window.localStorage.getItem(STAFF_KEY) !== null) return loadStaff();
      window.localStorage.setItem(STAFF_KEY, JSON.stringify(initial));
    } catch { throw new Error('Sample staff could not be saved. Check browser storage settings and try again.'); }
    return initial;
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(invalidSaved); }
  if (!Array.isArray(parsed) || new Set(parsed.map((item) => item?.id)).size !== parsed.length ||
    parsed.some((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).length !== STORED.length || !STORED.every((key) => Object.hasOwn(item, key)) ||
        typeof item.id !== 'string' || !item.id || typeof item.createdBy !== 'string' || !item.createdBy.trim() ||
        typeof item.updatedBy !== 'string' || !item.updatedBy.trim() ||
        !validDate(item.createdAt) || !validDate(item.updatedAt) || Date.parse(item.updatedAt) < Date.parse(item.createdAt) ||
        KEYS.some((key) => typeof item[key] !== 'string' || item[key] !== item[key].trim())) return true;
      const source = Object.fromEntries(KEYS.map((key) => [key, item[key]]));
      const result = validateStaff(source, parsed, item.id);
      return Object.keys(result.errors).length > 0 || !same(source, result.fields);
    })) throw new Error(invalidSaved);
  return parsed;
}

function save(next, expected) {
  if (!same(loadStaff(), expected)) throw new Error('Staff records changed in another tab. Refresh records before saving.');
  try { window.localStorage.setItem(STAFF_KEY, JSON.stringify(next)); }
  catch { throw new Error('Staff records could not be saved. Check browser storage settings and try again.'); }
  return next;
}
function checked(values, records, exceptId, designations) {
  const result = validateStaff(values, records, exceptId, designations);
  if (Object.keys(result.errors).length) throw new Error(Object.values(result.errors)[0]);
  return result.fields;
}
function checkDesignations(expected) {
  if (!same(loadDesignations(), expected)) throw new Error('Designations changed in another tab. Refresh records before saving.');
}
export function createStaff(records, values, designations = []) {
  checkDesignations(designations);
  const fields = checked(values, records, null, designations);
  const now = new Date().toISOString();
  return save([{ ...fields, id: crypto.randomUUID(), createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now }, ...records], records);
}
export function updateStaff(records, id, values, designations = []) {
  checkDesignations(designations);
  const old = records.find((item) => item.id === id);
  if (!old) throw new Error('This staff member is no longer available.');
  const fields = checked(values, records, id, designations);
  return save(records.map((item) => item.id === id ? { ...item, ...fields, updatedBy: ACTOR, updatedAt: nextTime(item.updatedAt) } : item), records);
}
export function setStaffStatus(records, id, status) {
  const old = records.find((item) => item.id === id);
  if (!old) throw new Error('This staff member is no longer available.');
  if (!['active', 'inactive'].includes(status) || old.status === status) throw new Error('Choose a different valid status.');
  return save(records.map((item) => item.id === id ? { ...item, status, updatedBy: ACTOR, updatedAt: nextTime(item.updatedAt) } : item), records);
}

export function staffInvitationPreview(record) {
  return {
    recipient: record.name,
    email: record.email,
    copy: `Hello ${record.name},\n\nYour details have been added to the EVEXIA staff directory under the role ${record.role}${record.designation ? ` (${record.designation})` : ''}.\n\nThis is a preview only. Please contact your administrator for account access.`,
    confirmation: 'No email was sent. No account was activated.',
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function staffCSVTemplate() { return '\uFEFF' + STAFF_COLUMNS.map(([, label]) => csvCell(label)).join(',') + '\r\n'; }
export function exportStaffCSV(records) {
  return staffCSVTemplate() + records.map((record) => KEYS.map((key) => csvCell(record[key])).join(',')).join('\r\n') + (records.length ? '\r\n' : '');
}
function alreadySeededSample(fields, records) {
  const baseline = samples().find((sample) => norm(sample.userId) === norm(fields.userId) && norm(sample.email) === norm(fields.email));
  const saved = baseline && records.find((item) => item.id === baseline.id);
  return Boolean(saved && same(saved, baseline) && KEYS.every((key) => fields[key] === baseline[key]));
}
export function reviewStaffCSV(text, records, designations = []) {
  const rows = parseCSV(text);
  const headers = rows[0].cells.map((cell) => cell.trim());
  if (headers.length !== KEYS.length || headers.some((cell, i) => cell !== STAFF_COLUMNS[i][1])) {
    throw new Error(`CSV headers must match this exact order: ${STAFF_COLUMNS.map(([, label]) => label).join(', ')}. Credential and audit columns are not accepted.`);
  }
  const users = new Set(records.map((item) => norm(item.userId)));
  const emails = new Set(records.map((item) => norm(item.email)));
  const fileUsers = new Set();
  const fileEmails = new Set();
  return rows.slice(1).map(({ line, cells }) => {
    if (cells.length !== KEYS.length) return { line, errors: [`Expected ${KEYS.length} columns; found ${cells.length}.`] };
    const values = Object.fromEntries(KEYS.map((key, i) => [key, cells[i].trim().replace(/^'(?=[=+\-@])/, '')]));
    // Identical first-run samples already exist in the destination. Do not import
    // duplicates or overwrite samples that an admin has subsequently changed.
    const skipSample = alreadySeededSample(values, records);
    const { fields, errors: fieldErrors } = validateStaff(values, [], null, skipSample ? [] : designations);
    const errors = Object.values(fieldErrors);
    if (fields.userId && (fileUsers.has(norm(fields.userId)) || (!skipSample && users.has(norm(fields.userId))))) errors.push('User ID already exists (in saved records or this file).');
    if (fields.email && (fileEmails.has(norm(fields.email)) || (!skipSample && emails.has(norm(fields.email))))) errors.push('Email ID already exists (in saved records or this file).');
    if (fields.userId) fileUsers.add(norm(fields.userId));
    if (fields.email) fileEmails.add(norm(fields.email));
    return { line, values, fields, errors, skipSample };
  });
}
export function importStaff(entries, expected, designations = []) {
  checkDesignations(designations);
  if (!entries.length || entries.some((entry) => entry.errors?.length || !entry.fields)) throw new Error('Resolve all row errors before importing. Nothing was saved.');
  const users = new Set(expected.map((item) => norm(item.userId)));
  const emails = new Set(expected.map((item) => norm(item.email)));
  const fileUsers = new Set();
  const fileEmails = new Set();
  const fields = entries.flatMap((entry) => {
    const skipSample = alreadySeededSample(entry.fields, expected);
    const field = checked(entry.fields, [], null, skipSample ? [] : designations);
    if (fileUsers.has(norm(field.userId)) || fileEmails.has(norm(field.email))) throw new Error('Duplicate User ID or Email ID in this file. Nothing was saved.');
    fileUsers.add(norm(field.userId)); fileEmails.add(norm(field.email));
    if (skipSample) return [];
    if (users.has(norm(field.userId)) || emails.has(norm(field.email))) throw new Error('Duplicate User ID or Email ID. Nothing was saved.');
    users.add(norm(field.userId)); emails.add(norm(field.email));
    return [field];
  });
  if (!fields.length) {
    if (!same(loadStaff(), expected)) throw new Error('Staff records changed in another tab. Refresh records before importing.');
    return expected;
  }
  const now = new Date().toISOString();
  return save([...expected, ...fields.map((field) => ({ ...field, id: crypto.randomUUID(),
    createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now }))], expected);
}