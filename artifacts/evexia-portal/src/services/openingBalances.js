import { recordLocalChanges, recordLocalAction, reportExport } from './localActivity.js';
import { loadDoctors } from './doctors.js';
import { parseCSV } from './masterImport.js';

export const OPENING_BALANCE_KEY = 'evexia.admin.doctor-opening-balances.v1';
export const OPENING_BALANCE_COLUMNS = [
  ['startYear', 'Financial Start Year'],
  ['endYear', 'Financial End Year'],
  ['registrationNumber', 'Doctor Registration Number'],
  ['amount', 'Opening Balance'],
  ['status', 'Status'],
];
const ACTOR = 'Admin User';
const FIELDS = ['startYear', 'endYear', 'doctorId', 'amount', 'status'];
const STORED = [...FIELDS, 'id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'];
const invalidSaved = 'Saved opening balances are unreadable or invalid. Nothing was changed. Repair or back up browser storage before refreshing.';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const norm = (value) => value.trim().toLocaleLowerCase();
const key = (doctorId, startYear, endYear) => JSON.stringify([doctorId, startYear, endYear]);
const validDate = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const nextTime = (previous) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
const year = (value) => {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  return /^\d{4}$/.test(text) && Number(text) >= 1900 && Number(text) <= 9998 ? Number(text) : null;
};
const money = (value) => {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  if (!/^[+-]?(?:\d{1,13}(?:\.\d{1,2})?|\.\d{1,2})$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && Number.isSafeInteger(Math.round(amount * 100)) ? amount : null;
};

export function validateOpeningBalance(values, records = [], doctors = [], exceptId = null) {
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
    Object.keys(values).some((field) => !FIELDS.includes(field))) {
    return { fields: null, errors: { form: 'Opening balance contains unsupported fields.' } };
  }
  const errors = {};
  const startYear = year(values.startYear);
  const endYear = year(values.endYear);
  const amount = money(values.amount);
  const doctorId = typeof values.doctorId === 'string' ? values.doctorId : '';
  if (startYear === null) errors.startYear = 'Choose a valid four-digit financial start year.';
  if (endYear === null || (startYear !== null && endYear !== startYear + 1)) errors.endYear = 'Financial end year must immediately follow the start year.';
  if (!doctorId || !doctors.some((doctor) => doctor.id === doctorId)) errors.doctorId = 'Choose a saved doctor from Doctor Master.';
  if (amount === null) errors.amount = 'Enter a finite signed amount with at most two decimal places (zero is allowed).';
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Choose an active or inactive status.';
  if (startYear !== null && endYear !== null && doctorId && records.some((record) =>
    record.id !== exceptId && key(record.doctorId, record.startYear, record.endYear) === key(doctorId, startYear, endYear))) {
    errors.doctorId = 'This doctor already has an opening balance for that financial year.';
  }
  return { fields: { startYear, endYear, doctorId, amount, status: values.status }, errors };
}

function samples(doctors) {
  const examples = [
    ['sample-doctor-1', 1250.50],
    ['sample-doctor-2', -480.25],
    ['sample-doctor-3', 0],
  ];
  return examples.flatMap(([id, amount], index) => {
    const doctor = doctors.find((item) => item.id === id && item.name.startsWith('Sample Dr.') && /^SAMPLE-REG-\d{3}$/.test(item.registrationNumber));
    if (!doctor) return [];
    const at = new Date(Date.UTC(2025, 3, index + 1, 9)).toISOString();
    return [{ id: `sample-opening-balance-${index + 1}`, startYear: 2025, endYear: 2026,
      doctorId: doctor.id, amount, status: 'active', createdBy: ACTOR, createdAt: at, updatedBy: ACTOR, updatedAt: at }];
  });
}

export function loadOpeningBalances(doctors = loadDoctors()) {
  let raw;
  try { raw = window.localStorage.getItem(OPENING_BALANCE_KEY); }
  catch { throw new Error('Opening balances could not be loaded because browser storage is unavailable.'); }
  if (raw === null) {
    const initial = samples(doctors);
    try {
      if (window.localStorage.getItem(OPENING_BALANCE_KEY) !== null) return loadOpeningBalances(doctors);
      if (!same(loadDoctors(), doctors)) throw new Error('Doctor records changed while preparing sample balances. Refresh records.');
      window.localStorage.setItem(OPENING_BALANCE_KEY, JSON.stringify(initial));
    } catch (cause) {
      if (/Doctor records changed/.test(cause.message)) throw cause;
      throw new Error('Opening balances could not be initialized in browser storage. Check storage settings and refresh.');
    }
    return initial;
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(invalidSaved); }
  if (!Array.isArray(parsed) || new Set(parsed.map((item) => item?.id)).size !== parsed.length ||
    new Set(parsed.map((item) => key(item?.doctorId, item?.startYear, item?.endYear))).size !== parsed.length ||
    parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item) ||
      Object.keys(item).length !== STORED.length || !STORED.every((field) => Object.hasOwn(item, field)) ||
      typeof item.id !== 'string' || !item.id ||
      typeof item.doctorId !== 'string' || !item.doctorId ||
      typeof item.startYear !== 'number' || year(item.startYear) !== item.startYear ||
      typeof item.endYear !== 'number' || item.endYear !== item.startYear + 1 ||
      typeof item.amount !== 'number' || money(item.amount) !== item.amount ||
      !['active', 'inactive'].includes(item.status) ||
      typeof item.createdBy !== 'string' || !item.createdBy.trim() ||
      typeof item.updatedBy !== 'string' || !item.updatedBy.trim() ||
      !validDate(item.createdAt) || !validDate(item.updatedAt) || Date.parse(item.updatedAt) < Date.parse(item.createdAt))) {
    throw new Error(invalidSaved);
  }
  // Missing doctors are deliberately retained; a deleted reference must never be reassigned.
  return parsed;
}

export function loadOpeningBalanceSnapshots() {
  const doctors = loadDoctors();
  return { records: loadOpeningBalances(doctors), doctors };
}

function save(next, expectedRecords, expectedDoctors) {
  const latestDoctors = loadDoctors();
  if (!same(latestDoctors, expectedDoctors)) throw new Error('Doctor Master changed in another tab. Refresh records before saving or importing.');
  if (!same(loadOpeningBalances(latestDoctors), expectedRecords)) throw new Error('Opening balances changed in another tab. Refresh records before saving or importing.');
  try { window.localStorage.setItem(OPENING_BALANCE_KEY, JSON.stringify(next)); }
  catch { throw new Error('Opening balances could not be saved in browser storage. Check storage settings and refresh.'); }
  recordLocalChanges('opening_balance', expectedRecords, next);
  return next;
}

function checked(values, records, doctors, exceptId) {
  const { fields, errors } = validateOpeningBalance(values, records, doctors, exceptId);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return fields;
}

export function createOpeningBalance(records, doctors, values) {
  const fields = checked(values, records, doctors);
  const now = new Date().toISOString();
  return save([{ ...fields, id: crypto.randomUUID(), createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now }, ...records], records, doctors);
}

export function updateOpeningBalance(records, doctors, id, values) {
  const previous = records.find((item) => item.id === id);
  if (!previous) throw new Error('This opening balance is no longer available. Refresh records.');
  const fields = checked(values, records, doctors, id);
  return save(records.map((item) => item.id === id ? { ...item, ...fields, updatedBy: ACTOR, updatedAt: nextTime(item.updatedAt) } : item), records, doctors);
}

export function setOpeningBalanceStatus(records, doctors, id, status) {
  const previous = records.find((item) => item.id === id);
  if (!previous) throw new Error('This opening balance is no longer available. Refresh records.');
  if (!['active', 'inactive'].includes(status) || previous.status === status) throw new Error('Choose a different valid status.');
  return save(records.map((item) => item.id === id ? { ...item, status, updatedBy: ACTOR, updatedAt: nextTime(item.updatedAt) } : item), records, doctors);
}

function cell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\p{Cc}]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function openingBalanceCSVTemplate() {
  return '\uFEFF' + OPENING_BALANCE_COLUMNS.map(([, label]) => cell(label)).join(',') + '\r\n';
}
export function exportOpeningBalanceCSV(...args) { return reportExport('opening_balance', () => buildOpeningBalanceCSV(...args)); }
function buildOpeningBalanceCSV(records, doctors) {
  return openingBalanceCSVTemplate() + records.map((record) => OPENING_BALANCE_COLUMNS.map(([field]) =>
    cell(field === 'registrationNumber'
      ? doctors.find((doctor) => doctor.id === record.doctorId)?.registrationNumber ?? ''
      : record[field])).join(',')).join('\r\n') + (records.length ? '\r\n' : '');
}

export function reviewOpeningBalanceCSV(text, records, doctors) {
  const rows = parseCSV(text);
  const headers = rows[0].cells.map((value) => value.trim());
  if (headers.length !== OPENING_BALANCE_COLUMNS.length || headers.some((header, index) => header !== OPENING_BALANCE_COLUMNS[index][1])) {
    throw new Error(`CSV headers must match this exact order: ${OPENING_BALANCE_COLUMNS.map(([, label]) => label).join(', ')}.`);
  }
  const used = new Set(records.map((record) => key(record.doctorId, record.startYear, record.endYear)));
  return rows.slice(1).map(({ line, cells }) => {
    if (cells.length !== OPENING_BALANCE_COLUMNS.length) return { line, errors: [`Expected ${OPENING_BALANCE_COLUMNS.length} columns; found ${cells.length}.`] };
    const values = Object.fromEntries(OPENING_BALANCE_COLUMNS.map(([field], index) =>
      [field, cells[index].trim().replace(/^'(?=[=+\-@])/, '')]));
    const matches = doctors.filter((doctor) => values.registrationNumber && norm(doctor.registrationNumber) === norm(values.registrationNumber));
    const { fields, errors } = validateOpeningBalance({
      startYear: values.startYear, endYear: values.endYear, doctorId: matches.length === 1 ? matches[0].id : '',
      amount: values.amount, status: values.status,
    }, [], doctors);
    const issues = Object.values(errors).filter((error) => !error.includes('Choose a saved doctor'));
    if (!values.registrationNumber || !matches.length) issues.push('Doctor registration number does not match a saved Doctor Master record.');
    if (matches.length > 1) issues.push('Doctor registration number is ambiguous in Doctor Master.');
    if (matches.length === 1 && fields.startYear !== null && fields.endYear !== null) {
      const identity = key(fields.doctorId, fields.startYear, fields.endYear);
      if (used.has(identity)) issues.push('Doctor and financial year already exist in saved records or this file.');
      used.add(identity);
    }
    return { line, values, fields, errors: issues };
  });
}

export function importOpeningBalances(...args) { const result = buildImportOpeningBalances(...args); recordLocalAction('opening_balance', 'imported'); return result; }
function buildImportOpeningBalances(entries, expectedRecords, expectedDoctors) {
  const current = loadOpeningBalanceSnapshots();
  if (!same(current.records, expectedRecords) || !same(current.doctors, expectedDoctors)) {
    throw new Error('Opening balances or Doctor Master changed since review. Refresh records and review the CSV again.');
  }
  if (!Array.isArray(entries) || !entries.length || entries.some((entry) => !entry.fields || entry.errors?.length)) {
    throw new Error('Resolve every row error before importing. Nothing was saved.');
  }
  const used = new Set(current.records.map((record) => key(record.doctorId, record.startYear, record.endYear)));
  const fields = entries.map((entry) => {
    const valid = checked(entry.fields, current.records, current.doctors);
    const identity = key(valid.doctorId, valid.startYear, valid.endYear);
    if (used.has(identity)) throw new Error('Duplicate doctor and financial year in saved records or this CSV. Nothing was saved.');
    used.add(identity);
    return valid;
  });
  const now = new Date().toISOString();
  return save([...current.records, ...fields.map((field) => ({
    ...field, id: crypto.randomUUID(), createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now,
  }))], expectedRecords, expectedDoctors);
}