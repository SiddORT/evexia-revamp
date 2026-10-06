import { recordLocalChanges, recordLocalAction, reportExport } from './localActivity.js';
import { parseCSV } from './masterImport.js';

export const DESIGNATION_KEY = 'evexia.admin.designations.v1';
export const DESIGNATION_COLUMNS = [
  ['name', 'Designation Name'], ['shortName', 'Short Name'], ['level', 'Level'], ['status', 'Status'],
  ['basicDa', 'Basic + DA (%)'], ['hra', 'HRA (%)'], ['medicalAllowance', 'Medical Allowance (%)'],
  ['travellingAllowance', 'Travelling Allowance (%)'], ['specialAllowance', 'Special Allowance (%)'],
  ['professionalTax', 'professional tax (Rs)'],
];
export const DESIGNATION_NUMBERS = DESIGNATION_COLUMNS.slice(4);
const FIELDS = DESIGNATION_COLUMNS.map(([key]) => key);
const STORED = [...FIELDS, 'id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'];
const ACTOR = 'Admin User';
const invalidSaved = 'Saved designation data is invalid. Nothing was changed. Repair or back up browser storage before retrying.';
const norm = (value) => value.trim().toLocaleLowerCase();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const nextTime = (previous) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();

function samples() {
  return [
    { name: 'Sample Field Representative', shortName: 'SFR', level: 3, status: 'active', basicDa: 40, hra: 20, medicalAllowance: 5, travellingAllowance: 10, specialAllowance: 5, professionalTax: 200 },
    { name: 'Sample Area Manager', shortName: 'SAM', level: 2, status: 'active', basicDa: 45, hra: 20, medicalAllowance: 5, travellingAllowance: 12, specialAllowance: 8, professionalTax: 200 },
    { name: 'Sample Regional Lead', shortName: 'SRL', level: 1, status: 'inactive', basicDa: 50, hra: 25, medicalAllowance: 5, travellingAllowance: 15, specialAllowance: 10, professionalTax: 200 },
  ].map((fields, index) => {
    const now = new Date(Date.UTC(2025, 1, 12 + index, 9, 15)).toISOString();
    return { ...fields, id: `sample-designation-${index + 1}`, createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now };
  });
}

export function validateDesignation(values, records = [], exceptId = null) {
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
    Object.keys(values).some((key) => !FIELDS.includes(key))) {
    return { fields: null, errors: { form: 'Designation data contains unsupported fields. Nothing was saved.' } };
  }
  const errors = {};
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  const shortName = typeof values.shortName === 'string' ? values.shortName.trim() : '';
  if (!name) errors.name = 'Designation Name is required.';
  else if (records.some((record) => record.id !== exceptId && norm(record.name) === norm(name))) errors.name = 'Designation Name already exists.';
  if (!shortName) errors.shortName = 'Short Name is required.';
  const levelText = typeof values.level === 'number' || typeof values.level === 'string' ? String(values.level).trim() : '';
  const level = /^\d+$/.test(levelText) && Number.isSafeInteger(Number(levelText)) && Number(levelText) > 0 ? Number(levelText) : null;
  if (level === null) errors.level = 'Level must be a positive whole number.';
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Choose an active or inactive status.';
  const fields = { name, shortName, level, status: values.status };
  for (const [key, label] of DESIGNATION_NUMBERS) {
    const raw = values[key] ?? '';
    const text = typeof raw === 'number' || typeof raw === 'string' ? String(raw).trim() : '';
    const number = text === '' ? 0 : /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
    if (number === null) errors[key] = `${label} must be a non-negative number.`;
    fields[key] = number;
  }
  return { fields, errors };
}

export function loadDesignations() {
  let raw;
  try { raw = window.localStorage.getItem(DESIGNATION_KEY); }
  catch { throw new Error('Designations could not be loaded because browser storage is unavailable.'); }
  if (raw === null) {
    const initial = samples();
    try {
      if (window.localStorage.getItem(DESIGNATION_KEY) !== null) return loadDesignations();
      window.localStorage.setItem(DESIGNATION_KEY, JSON.stringify(initial));
    } catch { throw new Error('Designations could not be initialized in this browser. Check browser storage settings and try again.'); }
    return initial;
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(invalidSaved); }
  if (!Array.isArray(parsed) || new Set(parsed.map((item) => item?.id)).size !== parsed.length ||
    parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item) ||
      Object.keys(item).length !== STORED.length || !STORED.every((key) => Object.hasOwn(item, key)) ||
      typeof item.id !== 'string' || !item.id ||
      typeof item.createdBy !== 'string' || !item.createdBy.trim() ||
      typeof item.updatedBy !== 'string' || !item.updatedBy.trim() ||
      !validDate(item.createdAt) || !validDate(item.updatedAt) ||
      Date.parse(item.updatedAt) < Date.parse(item.createdAt) ||
      typeof item.name !== 'string' || item.name !== item.name.trim() ||
      typeof item.shortName !== 'string' || item.shortName !== item.shortName.trim() ||
      typeof item.level !== 'number' || DESIGNATION_NUMBERS.some(([key]) => typeof item[key] !== 'number') ||
      Object.keys(validateDesignation(Object.fromEntries(FIELDS.map((key) => [key, item[key]])), parsed, item.id).errors).length)) {
    throw new Error(invalidSaved);
  }
  return parsed;
}

function save(next, expected) {
  if (!same(loadDesignations(), expected)) throw new Error('Designations changed in another tab. Refresh records before saving.');
  try { window.localStorage.setItem(DESIGNATION_KEY, JSON.stringify(next)); }
  catch { throw new Error('Designations could not be saved in this browser. Check browser storage settings and try again.'); }
  recordLocalChanges('designation', expected, next);
  return next;
}
function checked(values, records, exceptId) {
  const result = validateDesignation(values, records, exceptId);
  if (Object.keys(result.errors).length) throw new Error(Object.values(result.errors)[0]);
  return result.fields;
}
export function createDesignation(records, values) {
  const fields = checked(values, records);
  const now = new Date().toISOString();
  return save([{ ...fields, id: crypto.randomUUID(), createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now }, ...records], records);
}
export function updateDesignation(records, id, values) {
  const old = records.find((item) => item.id === id);
  if (!old) throw new Error('This designation is no longer available.');
  const fields = checked(values, records, id);
  return save(records.map((item) => item.id === id ? { ...item, ...fields, updatedBy: ACTOR, updatedAt: nextTime(item.updatedAt) } : item), records);
}
export function setDesignationStatus(records, id, status) {
  const old = records.find((item) => item.id === id);
  if (!old) throw new Error('This designation is no longer available.');
  if (!['active', 'inactive'].includes(status) || old.status === status) throw new Error('Choose a different valid status.');
  return save(records.map((item) => item.id === id ? { ...item, status, updatedBy: ACTOR, updatedAt: nextTime(item.updatedAt) } : item), records);
}
function cell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function designationCSVTemplate() {
  return '\uFEFF' + DESIGNATION_COLUMNS.map(([, label]) => cell(label)).join(',') + '\r\n';
}
export function exportDesignationCSV(...args) { return reportExport('designation', () => buildDesignationCSV(...args)); }
function buildDesignationCSV(records) {
  return designationCSVTemplate() + records.map((record) => DESIGNATION_COLUMNS.map(([key]) => cell(record[key])).join(',')).join('\r\n') + (records.length ? '\r\n' : '');
}
export function reviewDesignationCSV(text, records) {
  const rows = parseCSV(text);
  const headers = rows[0].cells.map((value) => value.trim());
  if (headers.length !== DESIGNATION_COLUMNS.length || headers.some((header, index) => header !== DESIGNATION_COLUMNS[index][1])) {
    throw new Error(`CSV headers must match this exact order: ${DESIGNATION_COLUMNS.map(([, label]) => label).join(', ')}.`);
  }
  const names = new Set(records.map((item) => norm(item.name)));
  return rows.slice(1).map(({ line, cells }) => {
    if (cells.length !== DESIGNATION_COLUMNS.length) return { line, errors: [`Expected ${DESIGNATION_COLUMNS.length} columns; found ${cells.length}.`] };
    const values = Object.fromEntries(DESIGNATION_COLUMNS.map(([key], index) =>
      [key, cells[index].trim().replace(/^'(?=[=+\-@])/, '')]));
    const { fields, errors } = validateDesignation(values);
    const issues = Object.values(errors);
    if (fields.name && names.has(norm(fields.name))) issues.push('Designation Name already exists (in saved records or this file).');
    if (fields.name) names.add(norm(fields.name));
    return { line, values, fields, errors: issues };
  });
}
export function importDesignations(...args) { const result = buildImportDesignations(...args); recordLocalAction('designation', 'imported'); return result; }
function buildImportDesignations(entries, expected) {
  const current = loadDesignations();
  if (!same(current, expected)) throw new Error('Designations changed since review. Refresh records and review the CSV again.');
  if (!entries.length || entries.some((entry) => entry.errors?.length || !entry.fields)) {
    throw new Error('Resolve all row errors before importing. Nothing was saved.');
  }
  const names = new Set(current.map((item) => norm(item.name)));
  const fields = entries.map((entry) => {
    const valid = checked(entry.fields, current);
    if (names.has(norm(valid.name))) throw new Error(`Duplicate designation: ${valid.name}. Nothing was saved.`);
    names.add(norm(valid.name));
    return valid;
  });
  const now = new Date().toISOString();
  return save([...current, ...fields.map((field) => ({
    ...field, id: crypto.randomUUID(), createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now,
  }))], expected);
}