import { loadZones } from './zones.js';

const STORAGE_KEY = 'evexia.admin.mrs.v1';
export const MR_STORAGE_KEY = STORAGE_KEY;
const REQUIRED = ['name', 'phone', 'userId', 'email', 'hq', 'zoneId', 'employeeCode', 'dateOfJoining', 'designation', 'status', 'addressLine1', 'landmark', 'pincode', 'city', 'state', 'country'];
const OPTIONAL = ['reportingManagerId', 'addressLine2'];
const NUMERIC = ['paymentLimit', 'doctorDaysLimit'];
const FIELDS = [...REQUIRED, ...OPTIONAL, ...NUMERIC];
const STORED = [...FIELDS, 'id', 'createdAt', 'updatedAt'];
const labels = { name: 'MR Name', phone: 'Phone No.', userId: 'User ID', email: 'Email ID', hq: 'HQ', zoneId: 'Assigned Zone', employeeCode: 'Employee Code', dateOfJoining: 'Date of Joining', designation: 'Designation', status: 'Status', addressLine1: 'Address Line 1', landmark: 'Landmark', pincode: 'Pincode', city: 'City', state: 'State', country: 'Country' };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const normalized = (value) => value.trim().toLocaleLowerCase();
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function validateMR(values, records = [], exceptId = null) {
  const errors = {};
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some((key) => !FIELDS.includes(key))) {
    return { fields: null, errors: { form: 'MR data contains unsupported fields. Nothing was saved.' } };
  }
  const fields = {};
  for (const key of [...REQUIRED, ...OPTIONAL]) {
    fields[key] = typeof values[key] === 'string' ? values[key].trim() : '';
    if (REQUIRED.includes(key) && !fields[key]) errors[key] = `${labels[key]} is required.`;
  }
  for (const key of NUMERIC) {
    const value = values[key] === '' || values[key] == null ? 0 : Number(values[key]);
    fields[key] = value;
    if (!Number.isFinite(value) || value < 0 || (key === 'doctorDaysLimit' && !Number.isInteger(value))) errors[key] = `${key === 'paymentLimit' ? 'Payment Limit' : 'Doctor Days Limit'} must be ${key === 'doctorDaysLimit' ? 'a whole ' : 'a '}nonnegative number.`;
  }
  if (fields.phone && (!/^\+?[0-9 ()-]+$/.test(fields.phone) || !/^\d{10,15}$/.test(fields.phone.replace(/[ +()-]/g, '')))) errors.phone = 'Enter a valid phone number (10–15 digits).';
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors.email = 'Enter a valid email address.';
  if (fields.dateOfJoining && !validDate(fields.dateOfJoining)) errors.dateOfJoining = 'Enter a valid joining date.';
  if (fields.pincode && !/^\d{6}$/.test(fields.pincode)) errors.pincode = 'Enter a six-digit pincode.';
  if (fields.status && !['active', 'inactive'].includes(fields.status)) errors.status = 'Choose a valid status.';
  for (const [key, label] of [['employeeCode', 'Employee Code'], ['userId', 'User ID'], ['email', 'Email ID']]) {
    if (fields[key] && records.some((record) => record.id !== exceptId && normalized(record[key]) === normalized(fields[key]))) errors[key] = `${label} already belongs to another MR.`;
  }
  if (fields.reportingManagerId && (fields.reportingManagerId === exceptId || !records.some((record) => record.id === fields.reportingManagerId))) errors.reportingManagerId = 'Choose a saved MR as reporting manager.';
  return { fields, errors };
}

function read() {
  let raw;
  try { raw = window.localStorage.getItem(STORAGE_KEY); }
  catch { throw new Error('MR records could not be loaded because browser storage is unavailable.'); }
  if (raw === null) return [];
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Saved MR data is invalid. No records were changed. Repair or back up browser storage before retrying.'); }
  if (!Array.isArray(parsed) || parsed.some((record) =>
    !record || typeof record !== 'object' || Array.isArray(record) ||
    Object.keys(record).some((key) => !STORED.includes(key)) ||
    !STORED.every((key) => own(record, key)) ||
    typeof record.id !== 'string' || !record.id ||
    ![record.createdAt, record.updatedAt].every((date) => typeof date === 'string' && !Number.isNaN(Date.parse(date))) ||
    NUMERIC.some((key) => typeof record[key] !== 'number') ||
    Object.keys(validateMR(Object.fromEntries(FIELDS.map((key) => [key, record[key]]))).errors).length
  ) || new Set(parsed.map((record) => record.id)).size !== parsed.length ||
    ['employeeCode', 'userId', 'email'].some((field) => new Set(parsed.map((record) => normalized(record[field]))).size !== parsed.length) ||
    parsed.some((record) => record.reportingManagerId && (record.reportingManagerId === record.id || !parsed.some((candidate) => candidate.id === record.reportingManagerId)))) {
    throw new Error('Saved MR data is invalid. No records were changed. Repair or back up browser storage before retrying.');
  }
  return parsed;
}

export function loadMRs() { return read(); }

function save(next, expected, expectedZones) {
  if (JSON.stringify(read()) !== JSON.stringify(expected)) throw new Error('MR records changed in another tab. Refresh records to review the latest data before saving.');
  if (JSON.stringify(loadZones()) !== JSON.stringify(expectedZones)) throw new Error('Zones changed in another tab. Refresh records to review the latest zones before saving.');
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
  catch { throw new Error('MR records could not be saved in this browser. Check browser storage settings and try again.'); }
  return next;
}

function checkedFields(records, zones, values, id) {
  const { fields, errors } = validateMR(values, records, id);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  const previous = records.find((record) => record.id === id);
  const zone = zones.find((item) => item.id === fields.zoneId);
  if (!zone || (zone.status !== 'active' && previous?.zoneId !== zone.id)) throw new Error('Choose an active saved zone from Zone Master.');
  return fields;
}

export function createMR(records, zones, values) {
  const fields = checkedFields(records, zones, values);
  const now = new Date().toISOString();
  return save([{ ...fields, id: crypto.randomUUID(), createdAt: now, updatedAt: now }, ...records], records, zones);
}

export function updateMR(records, zones, id, values) {
  if (!records.some((record) => record.id === id)) throw new Error('This MR is no longer available.');
  const fields = checkedFields(records, zones, values, id);
  return save(records.map((record) => record.id === id ? { ...record, ...fields, updatedAt: new Date().toISOString() } : record), records, zones);
}

export function setMRStatus(records, zones, id, status) {
  if (!['active', 'inactive'].includes(status)) throw new Error('Choose a valid MR status.');
  if (!records.some((record) => record.id === id)) throw new Error('This MR is no longer available.');
  return save(records.map((record) => record.id === id ? { ...record, status, updatedAt: new Date().toISOString() } : record), records, zones);
}

export const CSV_COLUMNS = [
  ['employeeCode', 'Employee Code'], ['name', 'MR Name'], ['phone', 'Phone No.'], ['userId', 'User ID'], ['email', 'Email ID'],
  ['hq', 'HQ'], ['zoneName', 'Assigned Zone'], ['dateOfJoining', 'Date of Joining'], ['designation', 'Designation'],
  ['managerName', 'Reporting Manager'], ['paymentLimit', 'Payment Limit'], ['doctorDaysLimit', 'Doctor Days Limit'],
  ['status', 'Status'], ['addressLine1', 'Address Line 1'], ['addressLine2', 'Address Line 2'], ['landmark', 'Landmark'],
  ['pincode', 'Pincode'], ['city', 'City'], ['state', 'State'], ['country', 'Country'],
];
function csvCell(value) {
  const text = String(value ?? '');
  // Quoting alone does not stop spreadsheet apps interpreting a formula.
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function exportMRCSV(records, zones, allRecords) {
  const header = CSV_COLUMNS.map(([, label]) => csvCell(label)).join(',');
  const rows = records.map((record) => CSV_COLUMNS.map(([key]) => {
    const value = key === 'zoneName' ? zones.find((zone) => zone.id === record.zoneId)?.name || 'Deleted zone'
      : key === 'managerName' ? allRecords.find((mr) => mr.id === record.reportingManagerId)?.name || (record.reportingManagerId ? 'Missing MR' : '')
      : record[key];
    return csvCell(value);
  }).join(','));
  return '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n';
}