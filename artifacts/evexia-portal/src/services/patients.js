import { loadDoctors } from './doctors.js';
import { loadMRs } from './mrs.js';
import { loadZones } from './zones.js';
import { parseCSV } from './masterImport.js';

export const PATIENT_STORAGE_KEY = 'evexia.admin.patients.v1';
export const PATIENT_FIELDS = ['name', 'gender', 'phone', 'email', 'dateOfBirth', 'doctorId', 'instructionsLanguage', 'status', 'addressLine1', 'addressLine2', 'landmark', 'pincode', 'city', 'state', 'country'];
const REQUIRED = PATIENT_FIELDS.filter((key) => !['email', 'addressLine2'].includes(key));
const STORED = [...PATIENT_FIELDS, 'id', 'createdAt', 'updatedAt'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const norm = (value) => value.trim().toLocaleLowerCase();
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const error = (message, code) => Object.assign(new Error(message), { code });
const recovery = () => error('Saved patient data is invalid. No records were changed. Back up or repair browser storage before refreshing.', 'RECOVERY_REQUIRED');
const dateValid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function patientAge(dob, today = new Date()) {
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (!dateValid(dob) || dob > todayDate) return '';
  const [year, month, day] = dob.split('-').map(Number);
  return today.getFullYear() - year - (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day) ? 1 : 0);
}

export function validatePatient(values) {
  const errors = {};
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some((key) => !PATIENT_FIELDS.includes(key))) {
    return { fields: null, errors: { form: 'Patient data contains unsupported fields.' } };
  }
  const fields = Object.fromEntries(PATIENT_FIELDS.map((key) => [key, typeof values[key] === 'string' ? values[key].trim() : '']));
  for (const key of REQUIRED) if (!fields[key]) errors[key] = 'This field is required.';
  if (fields.gender && !['female', 'male', 'other', 'prefer not to say'].includes(fields.gender)) errors.gender = 'Choose a valid gender.';
  if (fields.phone && !/^\d{10}$/.test(fields.phone.replace(/[\s()-]/g, ''))) errors.phone = 'Enter a 10-digit phone number.';
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors.email = 'Enter a valid email address.';
  if (fields.dateOfBirth && patientAge(fields.dateOfBirth) === '') errors.dateOfBirth = 'Enter a valid birth date, not in the future.';
  if (fields.pincode && (norm(fields.country) === 'india' ? !/^\d{6}$/.test(fields.pincode) : !/^[a-zA-Z0-9][a-zA-Z0-9 -]{1,11}$/.test(fields.pincode))) errors.pincode = 'Enter a valid postal code.';
  if (fields.status && !['active', 'inactive'].includes(fields.status)) errors.status = 'Choose a valid status.';
  return { fields, errors };
}

export function loadPatients() {
  let raw;
  try { raw = window.localStorage.getItem(PATIENT_STORAGE_KEY); }
  catch { throw error('Patient records could not be loaded because browser storage is unavailable.', 'RECOVERY_REQUIRED'); }
  if (raw === null) return [];
  let records;
  try { records = JSON.parse(raw); } catch { throw recovery(); }
  if (!Array.isArray(records) || records.some((record) =>
    !record || typeof record !== 'object' || Array.isArray(record) ||
    Object.keys(record).some((key) => !STORED.includes(key)) || !STORED.every((key) => own(record, key)) ||
    typeof record.id !== 'string' || !/^PAT-[A-Z0-9-]{6,40}$/.test(record.id) ||
    ![record.createdAt, record.updatedAt].every((date) => typeof date === 'string' && !Number.isNaN(Date.parse(date))) ||
    PATIENT_FIELDS.some((key) => typeof record[key] !== 'string') ||
    Object.keys(validatePatient(Object.fromEntries(PATIENT_FIELDS.map((key) => [key, record[key]]))).errors).length
  ) || new Set(records.map((record) => norm(record.id))).size !== records.length) throw recovery();
  return records;
}

export function readPatientSnapshots() {
  const zones = loadZones();
  const mrs = loadMRs();
  const doctors = loadDoctors();
  const records = loadPatients();
  return { zones, mrs, doctors, records };
}

function save(next, expected) {
  const current = readPatientSnapshots();
  if (['records', 'doctors', 'mrs', 'zones'].some((key) => !same(current[key], expected[key]))) {
    throw error('Patient, doctor, MR, or zone records changed. Refresh records and review the latest data before saving.', 'SNAPSHOT_CONFLICT');
  }
  try { window.localStorage.setItem(PATIENT_STORAGE_KEY, JSON.stringify(next)); }
  catch { throw error('Patient records could not be saved in this browser. Check storage settings, then refresh records.', 'RECOVERY_REQUIRED'); }
  return next;
}

function checkedFields(values, expected, previous) {
  const { fields, errors } = validatePatient(values);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  const doctor = expected.doctors.find((record) => record.id === fields.doctorId);
  if (!doctor) throw new Error('Assigned doctor is missing. Choose an available doctor before saving.');
  if (doctor.status !== 'active' && doctor.id !== previous?.doctorId) throw new Error('Choose an active saved doctor.');
  const mr = expected.mrs.find((record) => record.id === doctor.mrId);
  const zone = mr && expected.zones.find((record) => record.id === mr.zoneId);
  if (!mr || !zone) throw new Error('This doctor has a missing MR or zone assignment. Repair it in Doctor or MR Master before saving.');
  return fields;
}

export function createPatient(expected, values) {
  const fields = checkedFields(values, expected);
  const now = new Date().toISOString();
  let id;
  do { id = `PAT-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`; }
  while (expected.records.some((record) => record.id === id));
  return save([{ ...fields, id, createdAt: now, updatedAt: now }, ...expected.records], expected);
}

export function updatePatient(expected, id, values) {
  const previous = expected.records.find((record) => record.id === id);
  if (!previous) throw new Error('This patient is no longer available.');
  const fields = checkedFields(values, expected, previous);
  return save(expected.records.map((record) => record.id === id ? { ...record, ...fields, updatedAt: new Date().toISOString() } : record), expected);
}

export function setPatientStatus(expected, id, status) {
  if (!['active', 'inactive'].includes(status)) throw new Error('Choose a valid status.');
  if (!expected.records.some((record) => record.id === id)) throw new Error('This patient is no longer available.');
  return save(expected.records.map((record) => record.id === id ? { ...record, status, updatedAt: new Date().toISOString() } : record), expected);
}

export const PATIENT_CSV_COLUMNS = [
  ['id', 'Patient ID'], ['name', 'Patient Name'], ['gender', 'Gender'], ['phone', 'Phone No.'], ['email', 'Email ID'],
  ['dateOfBirth', 'Date of Birth'], ['doctorId', 'Doctor ID'], ['doctorRegistration', 'Doctor Registration Number'],
  ['instructionsLanguage', 'Instructions Language'], ['status', 'Status'], ['addressLine1', 'Address Line 1'],
  ['addressLine2', 'Address Line 2'], ['landmark', 'Landmark'], ['pincode', 'Pincode'],
  ['city', 'City'], ['state', 'State'], ['country', 'Country'],
];
const cell = (value) => {
  const text = String(value ?? '');
  const safe = /^[\s\p{Cc}]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
export function exportPatientCSV(records, doctors) {
  const rows = records.map((record) => PATIENT_CSV_COLUMNS.map(([key]) => cell(key === 'doctorRegistration'
    ? doctors.find((doctor) => doctor.id === record.doctorId)?.registrationNumber || ''
    : record[key])).join(','));
  return '\uFEFF' + [PATIENT_CSV_COLUMNS.map(([, label]) => cell(label)).join(','), ...rows].join('\r\n') + '\r\n';
}
export function patientTemplateCSV() {
  return '\uFEFF' + PATIENT_CSV_COLUMNS.map(([, label]) => cell(label)).join(',') + '\r\n';
}

export function reviewPatientCSV(text, snapshots) {
  const rows = parseCSV(text);
  const headers = PATIENT_CSV_COLUMNS.map(([, label]) => label);
  if (rows[0].cells.length !== headers.length || rows[0].cells.some((value, i) => value.trim() !== headers[i])) {
    throw new Error(`CSV headers must match the template in this order: ${headers.join(', ')}.`);
  }
  const ids = new Set(snapshots.records.map((record) => norm(record.id)));
  const identities = new Set(snapshots.records.map((record) => `${norm(record.name)}|${record.phone.replace(/\D/g, '')}|${record.dateOfBirth}`));
  const entries = rows.slice(1).map(({ line, cells }) => {
    const errors = [];
    if (cells.length !== headers.length) return { line, errors: [`Expected ${headers.length} columns; found ${cells.length}.`] };
    const row = Object.fromEntries(PATIENT_CSV_COLUMNS.map(([key], i) => [key, cells[i].trim().replace(/^'(?=[=+\-@])/, '')]));
    const id = row.id || `PAT-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    if (!/^PAT-[A-Z0-9-]{6,40}$/.test(id)) errors.push('Patient ID must be blank or a valid PAT- ID.');
    if (ids.has(norm(id))) errors.push('Patient ID already exists in saved records or this file.');
    ids.add(norm(id));
    let doctor = snapshots.doctors.find((candidate) => candidate.id === row.doctorId);
    const matches = row.doctorRegistration ? snapshots.doctors.filter((candidate) => norm(candidate.registrationNumber) === norm(row.doctorRegistration)) : [];
    if (!row.doctorId && matches.length === 1) doctor = matches[0];
    if (matches.length > 1) errors.push('Doctor registration number is ambiguous.');
    if (row.doctorId && row.doctorRegistration && (!doctor || !matches.some((candidate) => candidate.id === doctor.id))) errors.push('Doctor ID and registration number do not identify the same doctor.');
    if (!doctor) errors.push('Doctor ID or a unique saved doctor registration number is required.');
    else if (doctor.status !== 'active') errors.push('Assigned doctor must be active.');
    const fields = Object.fromEntries(PATIENT_FIELDS.map((key) => [key, key === 'doctorId' ? doctor?.id || '' : row[key]]));
    const validation = validatePatient(fields);
    errors.push(...Object.entries(validation.errors).map(([key, message]) => `${key}: ${message}`));
    const identity = `${norm(fields.name)}|${fields.phone.replace(/\D/g, '')}|${fields.dateOfBirth}`;
    if (fields.name && fields.phone && fields.dateOfBirth && identities.has(identity)) errors.push('Patient name, phone and birth date already match a saved patient or another row.');
    if (fields.name && fields.phone && fields.dateOfBirth) identities.add(identity);
    if (doctor && (!snapshots.mrs.some((mr) => mr.id === doctor.mrId && snapshots.zones.some((zone) => zone.id === mr.zoneId)))) errors.push('Doctor has a missing MR or zone assignment.');
    return { line, id, fields, errors };
  });
  return entries;
}

export function importPatients(entries, expected) {
  if (!entries.length || entries.some((entry) => entry.errors.length)) throw new Error('Resolve every row error before importing. Nothing was saved.');
  const ids = new Set(expected.records.map((record) => norm(record.id)));
  const identities = new Set(expected.records.map((record) => `${norm(record.name)}|${record.phone.replace(/\D/g, '')}|${record.dateOfBirth}`));
  for (const entry of entries) {
    if (!/^PAT-[A-Z0-9-]{6,40}$/.test(entry.id) || ids.has(norm(entry.id))) throw new Error(`Row ${entry.line}: duplicate or invalid patient ID.`);
    ids.add(norm(entry.id));
    const fields = checkedFields(entry.fields, expected);
    const identity = `${norm(fields.name)}|${fields.phone.replace(/\D/g, '')}|${fields.dateOfBirth}`;
    if (identities.has(identity)) throw new Error(`Row ${entry.line}: patient name, phone and birth date already exist.`);
    identities.add(identity);
  }
  const now = new Date().toISOString();
  return save([...entries.map(({ fields, id }) => ({ ...fields, id, createdAt: now, updatedAt: now })), ...expected.records], expected);
}