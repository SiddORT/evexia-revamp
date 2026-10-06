import { recordLocalChanges, recordLocalAction, reportExport } from './localActivity.js';
import { parseCSV } from './masterImport.js';

export const CATEGORY_STORAGE_KEY = 'evexia.admin.product-categories.v1';
export const CATEGORY_COLUMNS = [
  ['name', 'Product Category Name'], ['description', 'Description'],
  ['unitPrice', 'Unit Price'], ['status', 'Status'],
];
const ACTOR = 'Admin User';
const FIELDS = ['name', 'description', 'unitPrice', 'status'];
const STORED = [...FIELDS, 'id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalized = (name) => name.trim().toLocaleLowerCase();
const invalidSaved = 'Saved product category data is invalid. Nothing was changed. Repair or back up browser storage before retrying.';
const nextTimestamp = (previous) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();

function sampleCategories() {
  const examples = [
    { name: 'Sample Diagnostic Kits', description: 'Example point-of-care testing kits.', unitPrice: 450, status: 'active' },
    { name: 'Sample Lab Supplies', description: 'Example consumables for laboratory work.', unitPrice: 125.5, status: 'active' },
    { name: 'Sample Wellness Materials', description: 'Example health education materials.', unitPrice: 0, status: 'inactive' },
    { name: 'Sample Clinic Equipment', description: 'Example reusable clinic equipment.', unitPrice: 1800, status: 'inactive' },
  ];
  return examples.map((example, index) => {
    const date = new Date(Date.UTC(2025, 1, 12 + index, 9, 15)).toISOString();
    return {
      ...example,
      id: `sample-category-${index + 1}`,
      createdBy: ACTOR,
      createdAt: date,
      updatedBy: ACTOR,
      updatedAt: date,
    };
  });
}

export function validateCategory(values, records = [], exceptId = null) {
  const errors = {};
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
    Object.keys(values).some((key) => !FIELDS.includes(key))) {
    return { fields: null, errors: { form: 'Category data contains unsupported fields. Nothing was saved.' } };
  }
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  const description = typeof values.description === 'string' ? values.description.trim() : '';
  const status = typeof values.status === 'string' ? values.status.trim() : '';
  const priceText = typeof values.unitPrice === 'number' ? String(values.unitPrice) : values.unitPrice;
  const validPrice = typeof values.unitPrice === 'number'
    ? Number.isFinite(values.unitPrice) && values.unitPrice >= 0
    : typeof priceText === 'string' && /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(priceText.trim()) &&
      Number.isFinite(Number(priceText.trim())) && Number(priceText.trim()) >= 0;
  if (!name) errors.name = 'Product Category Name is required.';
  if (name && records.some((record) => record.id !== exceptId && normalized(record.name) === normalized(name))) {
    errors.name = 'Product Category Name already exists.';
  }
  if (!validPrice) errors.unitPrice = 'Enter a non-negative numeric Unit Price.';
  if (!['active', 'inactive'].includes(status)) errors.status = 'Choose an active or inactive status.';
  return { fields: { name, description, unitPrice: validPrice ? Number(priceText.trim()) : null, status }, errors };
}

export function loadCategories() {
  let raw;
  try { raw = window.localStorage.getItem(CATEGORY_STORAGE_KEY); }
  catch { throw new Error('Product categories could not be loaded because browser storage is unavailable.'); }
  if (raw === null) {
    const samples = sampleCategories();
    try {
      // A saved list (including []) wins if another tab initialized storage meanwhile.
      if (window.localStorage.getItem(CATEGORY_STORAGE_KEY) !== null) return loadCategories();
      window.localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(samples));
    } catch { throw new Error('Sample product categories could not be saved in this browser. Check browser storage settings and try again.'); }
    return samples;
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(invalidSaved); }
  if (!Array.isArray(parsed) || new Set(parsed.map((record) => record?.id)).size !== parsed.length ||
    parsed.some((record) => {
      if (!record || typeof record !== 'object' || Array.isArray(record) ||
        Object.keys(record).length !== STORED.length ||
        !STORED.every((key) => Object.prototype.hasOwnProperty.call(record, key)) ||
        typeof record.id !== 'string' || !record.id ||
        typeof record.name !== 'string' || record.name !== record.name.trim() ||
        typeof record.description !== 'string' || record.description !== record.description.trim() ||
        typeof record.unitPrice !== 'number' ||
        typeof record.createdBy !== 'string' || !record.createdBy.trim() ||
        typeof record.updatedBy !== 'string' || !record.updatedBy.trim() ||
        ![record.createdAt, record.updatedAt].every((date) => typeof date === 'string' &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) &&
          !Number.isNaN(Date.parse(date)) && new Date(date).toISOString() === date)) return true;
      return Object.keys(validateCategory(Object.fromEntries(FIELDS.map((field) => [field, record[field]])), parsed, record.id).errors).length > 0;
    })) throw new Error(invalidSaved);
  return parsed;
}

function save(next, expected) {
  if (!same(loadCategories(), expected)) throw new Error('Product categories changed in another tab. Refresh records before saving.');
  try { window.localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(next)); }
  catch { throw new Error('Product categories could not be saved in this browser. Check browser storage settings and try again.'); }
  recordLocalChanges('product_category', expected, next);
  return next;
}

function checked(values, records, exceptId) {
  const { fields, errors } = validateCategory(values, records, exceptId);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return fields;
}

export function createCategory(records, values) {
  const fields = checked(values, records);
  const now = new Date().toISOString();
  return save([{ ...fields, id: crypto.randomUUID(), createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now }, ...records], records);
}

export function updateCategory(records, id, values) {
  if (!records.some((record) => record.id === id)) throw new Error('This category is no longer available.');
  const fields = checked(values, records, id);
  return save(records.map((record) => record.id === id ? { ...record, ...fields, updatedBy: ACTOR, updatedAt: nextTimestamp(record.updatedAt) } : record), records);
}

export function setCategoryStatus(records, id, status) {
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error('This category is no longer available.');
  if (!['active', 'inactive'].includes(status) || record.status === status) throw new Error('Choose a different valid status.');
  return save(records.map((item) => item.id === id ? { ...item, status, updatedBy: ACTOR, updatedAt: nextTimestamp(item.updatedAt) } : item), records);
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function exportCategoryCSV(...args) { return reportExport('product_category', () => buildCategoryCSV(...args)); }
function buildCategoryCSV(records) {
  return '\uFEFF' + [CATEGORY_COLUMNS.map(([, label]) => csvCell(label)).join(','),
    ...records.map((record) => CATEGORY_COLUMNS.map(([key]) => csvCell(record[key])).join(','))].join('\r\n') + '\r\n';
}
export function categoryCSVTemplate() {
  return '\uFEFF' + CATEGORY_COLUMNS.map(([, label]) => csvCell(label)).join(',') + '\r\n';
}

export function reviewCategoryCSV(text, records) {
  const rows = parseCSV(text);
  const headers = rows[0].cells.map((cell) => cell.trim());
  if (headers.length !== CATEGORY_COLUMNS.length ||
    headers.some((header, index) => header !== CATEGORY_COLUMNS[index][1])) {
    throw new Error(`CSV headers must match this exact order: ${CATEGORY_COLUMNS.map(([, label]) => label).join(', ')}.`);
  }
  const names = new Set(records.map((record) => normalized(record.name)));
  return rows.slice(1).map(({ line, cells }) => {
    if (cells.length !== CATEGORY_COLUMNS.length) {
      return { line, errors: [`Expected ${CATEGORY_COLUMNS.length} columns; found ${cells.length}.`] };
    }
    const values = Object.fromEntries(CATEGORY_COLUMNS.map(([key], index) => [
      key, cells[index].trim().replace(/^'(?=[=+\-@])/, ''),
    ]));
    const { fields, errors } = validateCategory(values);
    const issues = Object.values(errors);
    if (fields.name && names.has(normalized(fields.name))) issues.push('Product Category Name already exists (in saved records or this file).');
    if (fields.name) names.add(normalized(fields.name));
    return { line, values, fields, errors: issues };
  });
}

export function importCategories(...args) { const result = buildImportCategories(...args); recordLocalAction('product_category', 'imported'); return result; }
function buildImportCategories(entries, expected) {
  const current = loadCategories();
  if (!same(current, expected)) throw new Error('Product categories changed since review. Refresh records and review the CSV again.');
  if (!entries.length || entries.some((entry) => entry.errors?.length || !entry.fields)) {
    throw new Error('Resolve all row errors before importing. Nothing was saved.');
  }
  const names = new Set(current.map((record) => normalized(record.name)));
  const fields = entries.map((entry) => {
    const valid = checked(entry.fields, current);
    if (names.has(normalized(valid.name))) throw new Error(`Duplicate category name: ${valid.name}. Nothing was saved.`);
    names.add(normalized(valid.name));
    return valid;
  });
  const now = new Date().toISOString();
  return save([...current, ...fields.map((entry) => ({
    ...entry, id: crypto.randomUUID(), createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now,
  }))], expected);
}