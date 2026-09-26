import { parseCSV } from './masterImport.js';

export const HEADQUARTER_KEY = 'evexia.admin.headquarters.v1';
export const HEADQUARTER_COLUMNS = [['name', 'HQ Name'], ['stateCode', 'State Code'], ['status', 'Status']];
const ACTOR = 'Admin User';
const FIELDS = ['name', 'stateCode', 'status'];
const STORED = [...FIELDS, 'id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalized = (name) => name.trim().toLocaleLowerCase();
const invalidSaved = 'Saved headquarter data is invalid. Nothing was changed. Repair or back up browser storage before retrying.';
const nextTimestamp = (previous) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();

function samples() {
  return [
    ['Sample Mumbai HQ', 'MH', 'active'],
    ['Sample Bengaluru HQ', 'KA', 'active'],
    ['Sample Hyderabad HQ', 'TS', 'inactive'],
    ['Sample Delhi HQ', 'DL', 'inactive'],
  ].map(([name, stateCode, status], index) => {
    const now = new Date(Date.UTC(2025, 1, 12 + index, 9, 15)).toISOString();
    return { id: `sample-headquarter-${index + 1}`, name, stateCode, status,
      createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now };
  });
}

export function validateHeadquarter(values, records = [], exceptId = null) {
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
    Object.keys(values).some((key) => !FIELDS.includes(key))) {
    return { fields: null, errors: { form: 'Headquarter data contains unsupported fields. Nothing was saved.' } };
  }
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  const stateCode = typeof values.stateCode === 'string' ? values.stateCode.trim().toUpperCase() : '';
  const status = typeof values.status === 'string' ? values.status.trim() : '';
  const errors = {};
  if (!name) errors.name = 'HQ Name is required.';
  else if (records.some((record) => record.id !== exceptId && normalized(record.name) === normalized(name))) {
    errors.name = 'HQ Name already exists.';
  }
  if (!stateCode) errors.stateCode = 'State Code is required.';
  if (!['active', 'inactive'].includes(status)) errors.status = 'Choose an active or inactive status.';
  return { fields: { name, stateCode, status }, errors };
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function loadHeadquarters() {
  let raw;
  try { raw = window.localStorage.getItem(HEADQUARTER_KEY); }
  catch { throw new Error('Headquarters could not be loaded because browser storage is unavailable.'); }
  if (raw === null) {
    const initial = samples();
    try {
      if (window.localStorage.getItem(HEADQUARTER_KEY) !== null) return loadHeadquarters();
      window.localStorage.setItem(HEADQUARTER_KEY, JSON.stringify(initial));
    } catch { throw new Error('Sample headquarters could not be saved in this browser. Check browser storage settings and try again.'); }
    return initial;
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(invalidSaved); }
  if (!Array.isArray(parsed) || new Set(parsed.map((record) => record?.id)).size !== parsed.length ||
    parsed.some((record) => {
      if (!record || typeof record !== 'object' || Array.isArray(record) ||
        Object.keys(record).length !== STORED.length ||
        !STORED.every((key) => Object.hasOwn(record, key)) ||
        typeof record.id !== 'string' || !record.id ||
        typeof record.name !== 'string' || record.name !== record.name.trim() ||
        typeof record.stateCode !== 'string' || record.stateCode !== record.stateCode.trim() ||
        typeof record.createdBy !== 'string' || !record.createdBy.trim() ||
        typeof record.updatedBy !== 'string' || !record.updatedBy.trim() ||
        !validDate(record.createdAt) || !validDate(record.updatedAt) ||
        Date.parse(record.updatedAt) < Date.parse(record.createdAt)) return true;
      return Object.keys(validateHeadquarter(Object.fromEntries(FIELDS.map((field) => [field, record[field]])), parsed, record.id).errors).length > 0;
    })) throw new Error(invalidSaved);
  return parsed;
}

function save(next, expected) {
  if (!same(loadHeadquarters(), expected)) throw new Error('Headquarters changed in another tab. Refresh records before saving.');
  try { window.localStorage.setItem(HEADQUARTER_KEY, JSON.stringify(next)); }
  catch { throw new Error('Headquarters could not be saved in this browser. Check browser storage settings and try again.'); }
  return next;
}

function checked(values, records, exceptId) {
  const { fields, errors } = validateHeadquarter(values, records, exceptId);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return fields;
}

export function createHeadquarter(records, values) {
  const fields = checked(values, records);
  const now = new Date().toISOString();
  return save([{ ...fields, id: crypto.randomUUID(), createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now }, ...records], records);
}

export function updateHeadquarter(records, id, values) {
  if (!records.some((record) => record.id === id)) throw new Error('This headquarter is no longer available.');
  const fields = checked(values, records, id);
  return save(records.map((record) => record.id === id
    ? { ...record, ...fields, updatedBy: ACTOR, updatedAt: nextTimestamp(record.updatedAt) } : record), records);
}

export function setHeadquarterStatus(records, id, status) {
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error('This headquarter is no longer available.');
  if (!['active', 'inactive'].includes(status) || record.status === status) throw new Error('Choose a different valid status.');
  return save(records.map((item) => item.id === id
    ? { ...item, status, updatedBy: ACTOR, updatedAt: nextTimestamp(item.updatedAt) } : item), records);
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportHeadquarterCSV(records) {
  return '\uFEFF' + [HEADQUARTER_COLUMNS.map(([, label]) => csvCell(label)).join(','),
    ...records.map((record) => HEADQUARTER_COLUMNS.map(([key]) => csvCell(record[key])).join(','))].join('\r\n') + '\r\n';
}
export function headquarterCSVTemplate() {
  return '\uFEFF' + HEADQUARTER_COLUMNS.map(([, label]) => csvCell(label)).join(',') + '\r\n';
}

export function reviewHeadquarterCSV(text, records) {
  const rows = parseCSV(text);
  const headers = rows[0].cells.map((cell) => cell.trim());
  if (headers.length !== HEADQUARTER_COLUMNS.length ||
    headers.some((header, index) => header !== HEADQUARTER_COLUMNS[index][1])) {
    throw new Error(`CSV headers must match this exact order: ${HEADQUARTER_COLUMNS.map(([, label]) => label).join(', ')}.`);
  }
  const names = new Set(records.map((record) => normalized(record.name)));
  return rows.slice(1).map(({ line, cells }) => {
    if (cells.length !== HEADQUARTER_COLUMNS.length) {
      return { line, errors: [`Expected ${HEADQUARTER_COLUMNS.length} columns; found ${cells.length}.`] };
    }
    const values = Object.fromEntries(HEADQUARTER_COLUMNS.map(([key], index) => [
      key, cells[index].trim().replace(/^'(?=[=+\-@])/, ''),
    ]));
    const { fields, errors } = validateHeadquarter(values);
    const issues = Object.values(errors);
    if (fields.name && names.has(normalized(fields.name))) issues.push('HQ Name already exists (in saved records or this file).');
    if (fields.name) names.add(normalized(fields.name));
    return { line, values, fields, errors: issues };
  });
}

export function importHeadquarters(entries, expected) {
  const current = loadHeadquarters();
  if (!same(current, expected)) throw new Error('Headquarters changed since review. Refresh records and review the CSV again.');
  if (!entries.length || entries.some((entry) => entry.errors?.length || !entry.fields)) {
    throw new Error('Resolve all row errors before importing. Nothing was saved.');
  }
  const names = new Set(current.map((record) => normalized(record.name)));
  const fields = entries.map((entry) => {
    const valid = checked(entry.fields, current);
    if (names.has(normalized(valid.name))) throw new Error(`Duplicate HQ Name: ${valid.name}. Nothing was saved.`);
    names.add(normalized(valid.name));
    return valid;
  });
  const now = new Date().toISOString();
  return save([...current, ...fields.map((entry) => ({
    ...entry, id: crypto.randomUUID(), createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now,
  }))], expected);
}