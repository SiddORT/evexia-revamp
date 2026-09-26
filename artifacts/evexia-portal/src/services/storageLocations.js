import { parseCSV } from './masterImport.js';

export const STORAGE_LOCATION_KEY = 'evexia.admin.storage-locations.v1';
export const STORAGE_LOCATION_COLUMNS = [['name', 'Storage Location'], ['address', 'Address'], ['status', 'Status']];
const ACTOR = 'Admin User';
const FIELDS = ['name', 'address', 'status'];
const STORED = [...FIELDS, 'id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalized = (name) => name.trim().toLocaleLowerCase();
const invalidSaved = 'Saved storage location data is invalid. Nothing was changed. Repair or back up browser storage before retrying.';
const nextTimestamp = (previous) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();

function samples() {
  return [
    ['Sample Main Warehouse', 'Ground floor, 14 Industrial Road, Mumbai', 'active'],
    ['Sample Clinic Store', 'Second floor, 8 Clinic Lane, Pune', 'active'],
    ['Sample Cold Room', 'Unit 3, Research Park, Bengaluru', 'inactive'],
    ['Sample Transit Depot', 'Bay 2, 27 Station Road, Hyderabad', 'inactive'],
  ].map(([name, address, status], index) => {
    const now = new Date(Date.UTC(2025, 1, 12 + index, 9, 15)).toISOString();
    return { id: `sample-storage-location-${index + 1}`, name, address, status,
      createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now };
  });
}

export function validateStorageLocation(values, records = [], exceptId = null) {
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
    Object.keys(values).some((key) => !FIELDS.includes(key))) {
    return { fields: null, errors: { form: 'Storage location data contains unsupported fields. Nothing was saved.' } };
  }
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  const address = typeof values.address === 'string' ? values.address.trim() : '';
  const status = typeof values.status === 'string' ? values.status.trim() : '';
  const errors = {};
  if (!name) errors.name = 'Storage Location is required.';
  else if (records.some((record) => record.id !== exceptId && normalized(record.name) === normalized(name))) {
    errors.name = 'Storage Location already exists.';
  }
  if (!address) errors.address = 'Address is required.';
  if (!['active', 'inactive'].includes(status)) errors.status = 'Choose an active or inactive status.';
  return { fields: { name, address, status }, errors };
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function loadStorageLocations() {
  let raw;
  try { raw = window.localStorage.getItem(STORAGE_LOCATION_KEY); }
  catch { throw new Error('Storage locations could not be loaded because browser storage is unavailable.'); }
  if (raw === null) {
    const initial = samples();
    try {
      if (window.localStorage.getItem(STORAGE_LOCATION_KEY) !== null) return loadStorageLocations();
      window.localStorage.setItem(STORAGE_LOCATION_KEY, JSON.stringify(initial));
    } catch { throw new Error('Sample storage locations could not be saved in this browser. Check browser storage settings and try again.'); }
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
        typeof record.address !== 'string' || record.address !== record.address.trim() ||
        typeof record.createdBy !== 'string' || !record.createdBy.trim() ||
        typeof record.updatedBy !== 'string' || !record.updatedBy.trim() ||
        !validDate(record.createdAt) || !validDate(record.updatedAt) ||
        Date.parse(record.updatedAt) < Date.parse(record.createdAt)) return true;
      return Object.keys(validateStorageLocation(Object.fromEntries(FIELDS.map((field) => [field, record[field]])), parsed, record.id).errors).length > 0;
    })) throw new Error(invalidSaved);
  return parsed;
}

function save(next, expected) {
  if (!same(loadStorageLocations(), expected)) throw new Error('Storage locations changed in another tab. Refresh records before saving.');
  try { window.localStorage.setItem(STORAGE_LOCATION_KEY, JSON.stringify(next)); }
  catch { throw new Error('Storage locations could not be saved in this browser. Check browser storage settings and try again.'); }
  return next;
}

function checked(values, records, exceptId) {
  const { fields, errors } = validateStorageLocation(values, records, exceptId);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return fields;
}

export function createStorageLocation(records, values) {
  const fields = checked(values, records);
  const now = new Date().toISOString();
  return save([{ ...fields, id: crypto.randomUUID(), createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now }, ...records], records);
}

export function updateStorageLocation(records, id, values) {
  if (!records.some((record) => record.id === id)) throw new Error('This storage location is no longer available.');
  const fields = checked(values, records, id);
  return save(records.map((record) => record.id === id
    ? { ...record, ...fields, updatedBy: ACTOR, updatedAt: nextTimestamp(record.updatedAt) } : record), records);
}

export function setStorageLocationStatus(records, id, status) {
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error('This storage location is no longer available.');
  if (!['active', 'inactive'].includes(status) || record.status === status) throw new Error('Choose a different valid status.');
  return save(records.map((item) => item.id === id
    ? { ...item, status, updatedBy: ACTOR, updatedAt: nextTimestamp(item.updatedAt) } : item), records);
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportStorageLocationCSV(records) {
  return '\uFEFF' + [STORAGE_LOCATION_COLUMNS.map(([, label]) => csvCell(label)).join(','),
    ...records.map((record) => STORAGE_LOCATION_COLUMNS.map(([key]) => csvCell(record[key])).join(','))].join('\r\n') + '\r\n';
}
export function storageLocationCSVTemplate() {
  return '\uFEFF' + STORAGE_LOCATION_COLUMNS.map(([, label]) => csvCell(label)).join(',') + '\r\n';
}

export function reviewStorageLocationCSV(text, records) {
  const rows = parseCSV(text);
  const headers = rows[0].cells.map((cell) => cell.trim());
  if (headers.length !== STORAGE_LOCATION_COLUMNS.length ||
    headers.some((header, index) => header !== STORAGE_LOCATION_COLUMNS[index][1])) {
    throw new Error(`CSV headers must match this exact order: ${STORAGE_LOCATION_COLUMNS.map(([, label]) => label).join(', ')}.`);
  }
  const names = new Set(records.map((record) => normalized(record.name)));
  return rows.slice(1).map(({ line, cells }) => {
    if (cells.length !== STORAGE_LOCATION_COLUMNS.length) {
      return { line, errors: [`Expected ${STORAGE_LOCATION_COLUMNS.length} columns; found ${cells.length}.`] };
    }
    const values = Object.fromEntries(STORAGE_LOCATION_COLUMNS.map(([key], index) => [
      key, cells[index].trim().replace(/^'(?=[=+\-@])/, ''),
    ]));
    const { fields, errors } = validateStorageLocation(values);
    const issues = Object.values(errors);
    if (fields.name && names.has(normalized(fields.name))) issues.push('Storage Location already exists (in saved records or this file).');
    if (fields.name) names.add(normalized(fields.name));
    return { line, values, fields, errors: issues };
  });
}

export function importStorageLocations(entries, expected) {
  const current = loadStorageLocations();
  if (!same(current, expected)) throw new Error('Storage locations changed since review. Refresh records and review the CSV again.');
  if (!entries.length || entries.some((entry) => entry.errors?.length || !entry.fields)) {
    throw new Error('Resolve all row errors before importing. Nothing was saved.');
  }
  const names = new Set(current.map((record) => normalized(record.name)));
  const fields = entries.map((entry) => {
    const valid = checked(entry.fields, current);
    if (names.has(normalized(valid.name))) throw new Error(`Duplicate storage location: ${valid.name}. Nothing was saved.`);
    names.add(normalized(valid.name));
    return valid;
  });
  const now = new Date().toISOString();
  return save([...current, ...fields.map((entry) => ({
    ...entry, id: crypto.randomUUID(), createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now,
  }))], expected);
}