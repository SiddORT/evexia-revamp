import { parseCSV } from './masterImport.js';

export const VENDOR_KEY = 'evexia.admin.vendors.v1';
export const VENDOR_COLUMNS = [
  ['vendorName', 'Vendor Name'], ['gstNo', 'GST No.'], ['registeredAddress', 'Registered Address'],
  ['contactPersonName', 'Contact Person Name'], ['emailId', 'Email ID'], ['phoneNo', 'Phone No.'],
];
const KEYS = VENDOR_COLUMNS.map(([key]) => key);
const STORED = [...KEYS, 'id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'];
const ACTOR = 'Admin User';
const norm = (value) => value.trim().toLocaleLowerCase();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const invalidSaved = 'Saved vendor data is invalid. Nothing was changed. Back up or repair browser storage before retrying.';
const validDate = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const nextTime = (value) => new Date(Math.max(Date.now(), Date.parse(value) + 1)).toISOString();

export function validateVendor(values, records = [], exceptId = null) {
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
    Object.keys(values).some((key) => !KEYS.includes(key))) {
    return { fields: null, errors: { form: 'Vendor data contains unsupported fields. Nothing was saved.' } };
  }
  const fields = Object.fromEntries(KEYS.map((key) => [key, typeof values[key] === 'string' ? values[key].trim() : '']));
  const errors = {};
  for (const [key, label] of VENDOR_COLUMNS) {
    if (!fields[key]) errors[key] = `${label} is required.`;
  }
  if (fields.gstNo && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(fields.gstNo.toUpperCase())) {
    errors.gstNo = 'Enter a valid 15-character GST number.';
  }
  fields.gstNo = fields.gstNo.toUpperCase();
  if (fields.emailId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.emailId)) errors.emailId = 'Enter a valid email address.';
  if (fields.phoneNo && !/^(?:\+91[\s-]?)?[6-9]\d{9}$/.test(fields.phoneNo)) errors.phoneNo = 'Enter a 10-digit Indian mobile number (optionally +91).';
  if (fields.vendorName && records.some((item) => item.id !== exceptId && norm(item.vendorName) === norm(fields.vendorName))) {
    errors.vendorName = 'Vendor Name already exists.';
  }
  if (fields.gstNo && records.some((item) => item.id !== exceptId && item.gstNo.toUpperCase() === fields.gstNo)) {
    errors.gstNo = 'GST No. already exists.';
  }
  return { fields, errors };
}

function samples() {
  return [
    ['Sample North Supply', '27AAAAA0000A1Z5', 'Demo address, North District', 'Sample Contact One', 'north@example.test', '9876543210'],
    ['Sample Coastal Partners', '29BBBBB1111B1Z6', 'Demo address, Coastal District', 'Sample Contact Two', 'coastal@example.test', '9876543211'],
    ['Sample Valley Materials', '07CCCCC2222C1Z7', 'Demo address, Valley District', 'Sample Contact Three', 'valley@example.test', '9876543212'],
  ].map((cells, index) => {
    const fields = Object.fromEntries(KEYS.map((key, fieldIndex) => [key, cells[fieldIndex]]));
    const now = new Date(Date.UTC(2025, 1, 12 + index, 9, 15)).toISOString();
    return { ...fields, id: `sample-vendor-${index + 1}`, createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now };
  });
}

export function loadVendors() {
  let raw;
  try { raw = window.localStorage.getItem(VENDOR_KEY); }
  catch { throw new Error('Vendor records could not be loaded because browser storage is unavailable.'); }
  if (raw === null) {
    const initial = samples();
    try {
      if (window.localStorage.getItem(VENDOR_KEY) !== null) return loadVendors();
      window.localStorage.setItem(VENDOR_KEY, JSON.stringify(initial));
    } catch { throw new Error('Sample vendors could not be saved. Check browser storage settings and try again.'); }
    return initial;
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(invalidSaved); }
  if (!Array.isArray(parsed) || new Set(parsed.map((item) => item?.id)).size !== parsed.length ||
    parsed.some((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).length !== STORED.length || !STORED.every((key) => Object.hasOwn(item, key)) ||
        typeof item.id !== 'string' || !item.id ||
        typeof item.createdBy !== 'string' || !item.createdBy.trim() ||
        typeof item.updatedBy !== 'string' || !item.updatedBy.trim() ||
        !validDate(item.createdAt) || !validDate(item.updatedAt) || Date.parse(item.updatedAt) < Date.parse(item.createdAt) ||
        KEYS.some((key) => typeof item[key] !== 'string' || item[key] !== item[key].trim())) return true;
      const result = validateVendor(Object.fromEntries(KEYS.map((key) => [key, item[key]])), parsed, item.id);
      return Object.keys(result.errors).length > 0 || !same(result.fields, Object.fromEntries(KEYS.map((key) => [key, item[key]])));
    })) throw new Error(invalidSaved);
  return parsed;
}

function save(next, expected) {
  if (!same(loadVendors(), expected)) throw new Error('Vendor records changed in another tab. Refresh records before saving.');
  try { window.localStorage.setItem(VENDOR_KEY, JSON.stringify(next)); }
  catch { throw new Error('Vendor records could not be saved. Check browser storage settings and try again.'); }
  return next;
}
function checked(values, records, exceptId) {
  const { fields, errors } = validateVendor(values, records, exceptId);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return fields;
}
export function createVendor(records, values) {
  const fields = checked(values, records);
  const now = new Date().toISOString();
  return save([{ ...fields, id: crypto.randomUUID(), createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now }, ...records], records);
}
export function updateVendor(records, id, values) {
  const previous = records.find((item) => item.id === id);
  if (!previous) throw new Error('This vendor is no longer available.');
  const fields = checked(values, records, id);
  return save(records.map((item) => item.id === id ? { ...item, ...fields, updatedBy: ACTOR, updatedAt: nextTime(item.updatedAt) } : item), records);
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
const headers = () => VENDOR_COLUMNS.map(([, label]) => csvCell(label)).join(',');
export function vendorCSVTemplate() { return `\uFEFF${headers()}\r\n`; }
export function exportVendorCSV(records) {
  return '\uFEFF' + [headers(), ...records.map((record) => KEYS.map((key) => csvCell(record[key])).join(','))].join('\r\n') + '\r\n';
}
export function reviewVendorCSV(text, records) {
  const rows = parseCSV(text);
  const head = rows[0].cells.map((cell) => cell.trim());
  if (head.length !== KEYS.length || head.some((cell, i) => cell !== VENDOR_COLUMNS[i][1])) {
    throw new Error(`CSV headers must match this exact order: ${VENDOR_COLUMNS.map(([, label]) => label).join(', ')}.`);
  }
  const names = new Set(records.map((item) => norm(item.vendorName)));
  const gstNumbers = new Set(records.map((item) => item.gstNo.toUpperCase()));
  return rows.slice(1).map(({ line, cells }) => {
    if (cells.length !== KEYS.length) return { line, errors: [`Expected ${KEYS.length} columns; found ${cells.length}.`] };
    const values = Object.fromEntries(KEYS.map((key, i) => [key, cells[i].trim().replace(/^'(?=[=+\-@])/, '')]));
    const { fields, errors: fieldErrors } = validateVendor(values);
    const errors = Object.values(fieldErrors);
    if (fields.vendorName && names.has(norm(fields.vendorName))) errors.push('Vendor Name already exists (in saved records or this file).');
    if (fields.gstNo && gstNumbers.has(fields.gstNo)) errors.push('GST No. already exists (in saved records or this file).');
    if (fields.vendorName) names.add(norm(fields.vendorName));
    if (fields.gstNo) gstNumbers.add(fields.gstNo);
    return { line, values, fields, errors };
  });
}
export function importVendors(entries, expected) {
  if (!entries.length || entries.some((entry) => entry.errors?.length || !entry.fields)) {
    throw new Error('Resolve all row errors before importing. Nothing was saved.');
  }
  const names = new Set(expected.map((item) => norm(item.vendorName)));
  const gstNumbers = new Set(expected.map((item) => item.gstNo.toUpperCase()));
  const fields = entries.map((entry) => {
    const field = checked(entry.fields, expected);
    if (names.has(norm(field.vendorName)) || gstNumbers.has(field.gstNo)) throw new Error('Duplicate vendor name or GST number. Nothing was saved.');
    names.add(norm(field.vendorName)); gstNumbers.add(field.gstNo);
    return field;
  });
  const now = new Date().toISOString();
  return save([...expected, ...fields.map((field) => ({ ...field, id: crypto.randomUUID(),
    createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now }))], expected);
}