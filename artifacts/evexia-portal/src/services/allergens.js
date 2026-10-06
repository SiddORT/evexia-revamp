import { recordLocalChanges, recordLocalAction, reportExport } from './localActivity.js';
import { parseCSV } from './masterImport.js';
import { loadCategories } from './productCategories.js';
import { loadStorageLocations } from './storageLocations.js';

export const ALLERGEN_KEY = 'evexia.admin.allergens.v1';
export const ALLERGEN_COLUMNS = [
  ['name', 'Product Name'], ['categoryName', 'Category'], ['sellingPrice', 'Selling Price'],
  ['gst', 'GST'], ['storageLocationName', 'Storage Location'], ['concentration', 'Concentration'],
  ['thresholdLimit', 'Threshold limit'], ['hsnCode', 'HSN code'], ['status', 'Status'],
  ['allergens', 'Allergens / No Mix'],
];
const FIELDS = ['name', 'categoryId', 'sellingPrice', 'gst', 'storageLocationId', 'concentration', 'thresholdLimit', 'hsnCode', 'status', 'allergens'];
const STORED = [...FIELDS, 'id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'];
const ACTOR = 'Admin User';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const norm = (value) => value.trim().toLocaleLowerCase();
const invalidSaved = 'Saved allergen data is invalid. Nothing was changed. Repair or back up browser storage before retrying.';
const dateValid = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const nextTime = (previous) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
const numeric = (value, optional = false) => {
  if (optional && (value === '' || value === null)) return '';
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()) &&
    Number.isFinite(Number(text.trim())) && Number(text.trim()) >= 0 ? Number(text.trim()) : null;
};

export function loadAllergenReferences() {
  return { categories: loadCategories(), locations: loadStorageLocations() };
}

export function referenceLabel(records, id, kind) {
  const match = records.find((record) => record.id === id);
  return match ? `${match.name}${match.status === 'inactive' ? ' (inactive)' : ''}` : `Removed ${kind} (${id})`;
}

export function validateAllergen(values, records = [], refs = { categories: [], locations: [] }, exceptId = null) {
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some((key) => !FIELDS.includes(key))) {
    return { fields: null, errors: { form: 'Product data contains unsupported fields. Nothing was saved.' } };
  }
  const errors = {};
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  if (!name) errors.name = 'Product Name is required.';
  else if (records.some((record) => record.id !== exceptId && norm(record.name) === norm(name))) errors.name = 'Product Name already exists.';
  const existing = records.find((record) => record.id === exceptId);
  for (const [field, list, label] of [['categoryId', refs.categories, 'Category'], ['storageLocationId', refs.locations, 'Storage Location']]) {
    const choice = list.find((item) => item.id === values[field]);
    if (!choice || choice.status !== 'active') {
      if (!existing || existing[field] !== values[field]) errors[field] = `Choose an active ${label.toLowerCase()} from the current master.`;
    }
  }
  const sellingPrice = numeric(values.sellingPrice, true);
  const gst = numeric(values.gst);
  const thresholdLimit = numeric(values.thresholdLimit, true);
  if (sellingPrice === null) errors.sellingPrice = 'Selling Price must be a non-negative number when supplied.';
  if (gst === null || gst > 100) errors.gst = 'GST is required and must be a number from 0 to 100.';
  if (thresholdLimit === null) errors.thresholdLimit = 'Threshold limit must be a non-negative number when supplied.';
  const concentration = typeof values.concentration === 'string' ? values.concentration.trim() : '';
  if (!concentration) errors.concentration = 'Concentration is required.';
  const hsnCode = typeof values.hsnCode === 'string' ? values.hsnCode.trim() : '';
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Choose an active or inactive status.';
  if (typeof values.allergens !== 'boolean') errors.allergens = 'Choose Allergens or No Mix.';
  return { fields: { name, categoryId: values.categoryId, sellingPrice, gst, storageLocationId: values.storageLocationId,
    concentration, thresholdLimit, hsnCode, status: values.status, allergens: values.allergens }, errors };
}

function samples(refs) {
  const categories = refs.categories.filter((record) => record.status === 'active');
  const locations = refs.locations.filter((record) => record.status === 'active');
  if (!categories.length || !locations.length) return null;
  return [
    ['Sample Diagnostic Reagent', 450, 12, '10 mg/mL', 5, '3822', 'active', true],
    ['Sample Lab Buffer', 125.5, 18, '1:100', '', '3822', 'active', false],
    ['Sample Wellness Kit', '', 5, '20 mL', 2, '', 'inactive', true],
    ['Sample Clinic Solution', 1800, 12, '0.5%', '', '3004', 'inactive', false],
  ].map(([name, sellingPrice, gst, concentration, thresholdLimit, hsnCode, status, allergens], index) => {
    const now = new Date(Date.UTC(2025, 1, 12 + index, 9, 15)).toISOString();
    return { id: `sample-allergen-${index + 1}`, name, categoryId: categories[index % categories.length].id,
      sellingPrice, gst, storageLocationId: locations[index % locations.length].id, concentration,
      thresholdLimit, hsnCode, status, allergens, createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now };
  });
}

export function loadAllergens(refs = loadAllergenReferences()) {
  let raw;
  try { raw = window.localStorage.getItem(ALLERGEN_KEY); }
  catch { throw new Error('Allergen records could not be loaded because browser storage is unavailable.'); }
  if (raw === null) {
    const initial = samples(refs);
    if (!initial) throw new Error('Add an active Product Category and an active Storage Location before initializing Allergen Master. No sample records were created.');
    try {
      if (window.localStorage.getItem(ALLERGEN_KEY) !== null) return loadAllergens(refs);
      window.localStorage.setItem(ALLERGEN_KEY, JSON.stringify(initial));
    } catch { throw new Error('Sample allergen records could not be saved in this browser. Check browser storage settings and try again.'); }
    return initial;
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(invalidSaved); }
  if (!Array.isArray(parsed) || new Set(parsed.map((record) => record?.id)).size !== parsed.length ||
    parsed.some((record) => {
      if (!record || typeof record !== 'object' || Array.isArray(record) ||
        Object.keys(record).length !== STORED.length || !STORED.every((key) => Object.hasOwn(record, key)) ||
        typeof record.id !== 'string' || !record.id ||
        typeof record.name !== 'string' || record.name !== record.name.trim() ||
        typeof record.categoryId !== 'string' || !record.categoryId ||
        typeof record.storageLocationId !== 'string' || !record.storageLocationId ||
        typeof record.concentration !== 'string' || record.concentration !== record.concentration.trim() ||
        typeof record.hsnCode !== 'string' || record.hsnCode !== record.hsnCode.trim() ||
        typeof record.createdBy !== 'string' || !record.createdBy.trim() ||
        typeof record.updatedBy !== 'string' || !record.updatedBy.trim() ||
        !dateValid(record.createdAt) || !dateValid(record.updatedAt) || Date.parse(record.updatedAt) < Date.parse(record.createdAt)) return true;
      return Object.keys(validateAllergen(Object.fromEntries(FIELDS.map((field) => [field, record[field]])), parsed, refs, record.id).errors).length > 0;
    })) throw new Error(invalidSaved);
  return parsed;
}

function save(next, expected, refs) {
  const currentRefs = loadAllergenReferences();
  if (!same(currentRefs, refs)) throw new Error('Product categories or storage locations changed in another tab. Refresh records before saving.');
  if (!same(loadAllergens(currentRefs), expected)) throw new Error('Allergen records changed in another tab. Refresh records before saving.');
  try { window.localStorage.setItem(ALLERGEN_KEY, JSON.stringify(next)); }
  catch { throw new Error('Allergen records could not be saved in this browser. Check browser storage settings and try again.'); }
  recordLocalChanges('allergen', expected, next);
  return next;
}
function checked(values, records, refs, exceptId) {
  const { fields, errors } = validateAllergen(values, records, refs, exceptId);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return fields;
}
export function createAllergen(records, refs, values) {
  const fields = checked(values, records, refs);
  const now = new Date().toISOString();
  return save([{ ...fields, id: crypto.randomUUID(), createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now }, ...records], records, refs);
}
export function updateAllergen(records, refs, id, values) {
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error('This product is no longer available.');
  const fields = checked(values, records, refs, id);
  return save(records.map((item) => item.id === id ? { ...item, ...fields, updatedBy: ACTOR, updatedAt: nextTime(item.updatedAt) } : item), records, refs);
}
export function setAllergenStatus(records, refs, id, status) {
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error('This product is no longer available.');
  if (!['active', 'inactive'].includes(status) || record.status === status) throw new Error('Choose a different valid status.');
  return save(records.map((item) => item.id === id ? { ...item, status, updatedBy: ACTOR, updatedAt: nextTime(item.updatedAt) } : item), records, refs);
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function allergenCSVTemplate() {
  return '\uFEFF' + ALLERGEN_COLUMNS.map(([, label]) => csvCell(label)).join(',') + '\r\n';
}
export function exportAllergenCSV(...args) { return reportExport('allergen', () => buildAllergenCSV(...args)); }
function buildAllergenCSV(records, refs) {
  return '\uFEFF' + [ALLERGEN_COLUMNS.map(([, label]) => csvCell(label)).join(','),
    ...records.map((record) => ALLERGEN_COLUMNS.map(([key]) => csvCell(
      key === 'categoryName' ? (refs.categories.find((item) => item.id === record.categoryId)?.name ?? referenceLabel(refs.categories, record.categoryId, 'category'))
        : key === 'storageLocationName' ? (refs.locations.find((item) => item.id === record.storageLocationId)?.name ?? referenceLabel(refs.locations, record.storageLocationId, 'storage location'))
          : key === 'allergens' ? (record.allergens ? 'Allergens' : 'No Mix') : record[key])).join(','))].join('\r\n') + '\r\n';
}
export function reviewAllergenCSV(text, records, refs) {
  const rows = parseCSV(text);
  const headers = rows[0].cells.map((cell) => cell.trim());
  if (headers.length !== ALLERGEN_COLUMNS.length || headers.some((header, index) => header !== ALLERGEN_COLUMNS[index][1])) {
    throw new Error(`CSV headers must match this exact order: ${ALLERGEN_COLUMNS.map(([, label]) => label).join(', ')}.`);
  }
  const names = new Set(records.map((record) => norm(record.name)));
  return rows.slice(1).map(({ line, cells }) => {
    if (cells.length !== ALLERGEN_COLUMNS.length) return { line, errors: [`Expected ${ALLERGEN_COLUMNS.length} columns; found ${cells.length}.`] };
    const values = Object.fromEntries(ALLERGEN_COLUMNS.map(([key], index) => [key, cells[index].trim().replace(/^'(?=[=+\-@])/, '')]));
    const issues = [];
    const fields = { ...values };
    for (const [key, idKey, list, label] of [['categoryName', 'categoryId', refs.categories, 'Category'], ['storageLocationName', 'storageLocationId', refs.locations, 'Storage Location']]) {
      const matches = list.filter((item) => norm(item.name) === norm(values[key]));
      if (matches.length !== 1 || matches[0].status !== 'active') issues.push(`${label} must uniquely match an active saved ${label.toLowerCase()}.`);
      fields[idKey] = matches.length === 1 ? matches[0].id : '';
      delete fields[key];
    }
    fields.allergens = values.allergens === 'Allergens';
    if (!['Allergens', 'No Mix'].includes(values.allergens)) issues.push('Allergens / No Mix must be Allergens or No Mix.');
    const result = validateAllergen(fields, records, refs);
    issues.push(...Object.values(result.errors));
    if (result.fields?.name && names.has(norm(result.fields.name))) issues.push('Product Name already exists (in saved records or this file).');
    if (result.fields?.name) names.add(norm(result.fields.name));
    return { line, values, fields: result.fields, errors: [...new Set(issues)] };
  });
}
export function importAllergens(...args) { const result = buildImportAllergens(...args); recordLocalAction('allergen', 'imported'); return result; }
function buildImportAllergens(entries, expected, refs) {
  if (!entries.length || entries.some((entry) => entry.errors?.length || !entry.fields)) throw new Error('Resolve all row errors before importing. Nothing was saved.');
  const names = new Set(expected.map((record) => norm(record.name)));
  const fields = entries.map((entry) => {
    const field = checked(entry.fields, expected, refs);
    if (names.has(norm(field.name))) throw new Error(`Duplicate product name: ${field.name}. Nothing was saved.`);
    names.add(norm(field.name));
    return field;
  });
  const now = new Date().toISOString();
  return save([...expected, ...fields.map((field) => ({ ...field, id: crypto.randomUUID(),
    createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now }))], expected, refs);
}