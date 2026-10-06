import { recordLocalChanges, recordLocalAction, reportExport } from './localActivity.js';
import { loadMRs } from './mrs.js';
import { loadZones } from './zones.js';
import { parseCSV } from './masterImport.js';

export const SALES_TARGET_KEY = 'evexia.admin.sales-targets.v1';
export const TARGET_COLUMNS = [
  ['employeeCode', 'Employee Code'], ['startYear', 'Start Year'], ['endYear', 'End Year'],
  ['q1', 'Q1'], ['q2', 'Q2'], ['q3', 'Q3'], ['q4', 'Q4'],
];

const ACTOR = 'Admin User';
const VALUE_FIELDS = ['mrId', 'startYear', 'endYear', 'q1', 'q2', 'q3', 'q4'];
const STORED_FIELDS = [...VALUE_FIELDS, 'id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalized = (value) => String(value ?? '').trim().toLocaleLowerCase();
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const invalidSaved = 'Saved sales target data is invalid. Nothing was changed. Repair or back up browser storage before retrying.';
const nextTimestamp = (previous) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();

function amountInCents(value) {
  if (!(typeof value === 'number' || typeof value === 'string') || value === '') return null;
  const text = String(value).trim();
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(text)) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return null;
  const cents = Math.round(number * 100);
  return Number.isSafeInteger(cents) && Math.abs(number * 100 - cents) < 1e-7 ? cents : null;
}

function asYear(value) {
  if (!(typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim())))) return null;
  const year = Number(value);
  return Number.isSafeInteger(year) && year >= 1 ? year : null;
}

function overlaps(first, second) {
  return first.mrId === second.mrId && first.startYear === second.startYear && first.endYear === second.endYear;
}

export function validateSalesTarget(values, records = [], mrs = [], exceptId = null) {
  const errors = {};
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
    Object.keys(values).some((key) => !VALUE_FIELDS.includes(key))) {
    return { fields: null, errors: { form: 'Sales target data contains unsupported fields. Nothing was saved.' } };
  }
  const fields = {};
  fields.mrId = typeof values.mrId === 'string' ? values.mrId.trim() : '';
  if (!fields.mrId) errors.mrId = 'MR is required.';
  else if (!mrs.some((mr) => mr.id === fields.mrId)) errors.mrId = 'Choose a saved MR.';

  fields.startYear = asYear(values.startYear);
  fields.endYear = asYear(values.endYear);
  if (fields.startYear === null) errors.startYear = 'Start year must be a whole year.';
  if (fields.endYear === null) errors.endYear = 'End year must be a whole year.';
  if (fields.startYear !== null && fields.endYear !== null && fields.endYear !== fields.startYear + 1) {
    errors.endYear = 'End year must be the consecutive year after the start year.';
  }

  let annualCents = 0;
  for (const key of ['q1', 'q2', 'q3', 'q4']) {
    const cents = amountInCents(values[key]);
    if (cents === null) errors[key] = `${key.toUpperCase()} must be a nonnegative amount with at most two decimal places.`;
    else {
      fields[key] = cents / 100;
      annualCents += cents;
      if (!Number.isSafeInteger(annualCents)) errors.form = 'Annual target total is too large.';
    }
  }
  if (Object.keys(errors).length === 0 && fields.mrId && fields.startYear !== null && fields.endYear !== null) {
    const duplicate = records.find((record) => record.id !== exceptId && overlaps(fields, record));
    if (duplicate) errors.startYear = `This MR already has a target for ${fields.startYear}–${fields.endYear}.`;
  }
  return { fields, errors };
}

function validRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
    Object.keys(record).length !== STORED_FIELDS.length ||
    !STORED_FIELDS.every((key) => own(record, key)) ||
    typeof record.id !== 'string' || !record.id ||
    typeof record.mrId !== 'string' || !record.mrId ||
    typeof record.createdBy !== 'string' || !record.createdBy.trim() ||
    typeof record.updatedBy !== 'string' || !record.updatedBy.trim() ||
    ![record.createdAt, record.updatedAt].every((date) =>
      typeof date === 'string' && !Number.isNaN(Date.parse(date))) ||
    !['q1', 'q2', 'q3', 'q4'].every((key) =>
      typeof record[key] === 'number' && amountInCents(record[key]) !== null)) return false;
  const { fields, errors } = validateSalesTarget(
    Object.fromEntries(VALUE_FIELDS.map((key) => [key, record[key]])), [], [{ id: record.mrId }],
  );
  return fields !== null && Object.keys(errors).length === 0;
}

function sampleTargets(mrs, zones) {
  const eligible = mrs.filter((mr) => mr.id.startsWith('sample-mr-') && zones.some((zone) => zone.id === mr.zoneId));
  return eligible.slice(0, 3).map((mr, index) => {
    const createdAt = new Date(Date.UTC(2025, 1, 12 + index, 9, 15)).toISOString();
    return {
      id: `sample-sales-target-${index + 1}`,
      mrId: mr.id,
      startYear: 2025,
      endYear: 2026,
      q1: 250000 + index * 25000,
      q2: 275000 + index * 25000,
      q3: 300000 + index * 25000,
      q4: 325000 + index * 25000,
      createdBy: ACTOR,
      createdAt,
      updatedBy: ACTOR,
      updatedAt: createdAt,
    };
  });
}

function read() {
  let raw;
  try { raw = window.localStorage.getItem(SALES_TARGET_KEY); }
  catch { throw new Error('Sales targets could not be loaded because browser storage is unavailable.'); }
  if (raw === null) {
    const initial = sampleTargets(loadMRs(), loadZones());
    try {
      if (window.localStorage.getItem(SALES_TARGET_KEY) !== null) return read();
      window.localStorage.setItem(SALES_TARGET_KEY, JSON.stringify(initial));
    } catch { throw new Error('Sample sales targets could not be saved in this browser. Check browser storage settings and try again.'); }
    return initial;
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(invalidSaved); }
  if (!Array.isArray(parsed) || parsed.some((record) => !validRecord(record)) ||
    new Set(parsed.map((record) => record.id)).size !== parsed.length ||
    parsed.some((record, index) => parsed.slice(0, index).some((previous) => overlaps(record, previous)))) {
    throw new Error(invalidSaved);
  }
  return parsed;
}

export function loadSalesTargets() { return read(); }

function save(next, expected, expectedMRs, expectedZones) {
  if (!same(read(), expected)) throw new Error('Sales targets changed in another tab. Refresh records before saving.');
  if (!same(loadMRs(), expectedMRs)) throw new Error('MR records changed in another tab. Refresh records before saving.');
  if (!same(loadZones(), expectedZones)) throw new Error('Zones changed in another tab. Refresh records before saving.');
  try { window.localStorage.setItem(SALES_TARGET_KEY, JSON.stringify(next)); }
  catch { throw new Error('Sales targets could not be saved in this browser. Check browser storage settings and try again.'); }
  recordLocalChanges('sales_target', expected, next);
  return next;
}

function checked(records, mrs, values, exceptId = null) {
  const { fields, errors } = validateSalesTarget(values, records, mrs, exceptId);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return fields;
}

export function createSalesTarget(records, mrs, zones, values) {
  const fields = checked(records, mrs, values);
  const now = new Date().toISOString();
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID() : `sales-target-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return save([{ ...fields, id, createdBy: ACTOR, createdAt: now, updatedBy: ACTOR, updatedAt: now }, ...records], records, mrs, zones);
}

export function updateSalesTarget(records, mrs, zones, id, values, expectedOriginal) {
  const previous = records.find((record) => record.id === id);
  if (!previous) throw new Error('This sales target is no longer available.');
  if (expectedOriginal !== undefined && !same(previous, expectedOriginal)) {
    throw new Error('This sales target changed since editing began. Close the draft and review the latest record before saving.');
  }
  const fields = checked(records, mrs, values, id);
  return save(records.map((record) => record.id === id
    ? { ...record, ...fields, updatedBy: ACTOR, updatedAt: nextTimestamp(record.updatedAt) } : record), records, mrs, zones);
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportSalesTargetCSV(...args) { return reportExport('sales_target', () => buildSalesTargetCSV(...args)); }
function buildSalesTargetCSV(records, mrs) {
  const rows = records.map((record) => {
    const mr = mrs.find((item) => item.id === record.mrId);
    const values = {
      ...record,
      employeeCode: mr ? mr.employeeCode : `Missing MR: ${record.mrId}`,
    };
    return TARGET_COLUMNS.map(([key]) => csvCell(values[key])).join(',');
  });
  return `\uFEFF${[TARGET_COLUMNS.map(([, label]) => csvCell(label)).join(','), ...rows].join('\r\n')}\r\n`;
}

export function salesTargetCSVTemplate() {
  return `\uFEFF${TARGET_COLUMNS.map(([, label]) => csvCell(label)).join(',')}\r\n`;
}

export function reviewSalesTargetCSV(text, records, mrs) {
  const rows = parseCSV(text);
  const headers = rows[0].cells.map((cell) => cell.trim());
  const expectedHeaders = TARGET_COLUMNS.map(([, label]) => label);
  if (headers.length !== expectedHeaders.length ||
    new Set(headers).size !== headers.length ||
    headers.some((header, index) => header !== expectedHeaders[index])) {
    throw new Error(`CSV headers must match this exact order: ${expectedHeaders.join(', ')}.`);
  }
  const seen = [...records];
  return rows.slice(1).map(({ line, cells }) => {
    if (cells.length !== TARGET_COLUMNS.length) {
      return { line, errors: [`Expected ${TARGET_COLUMNS.length} columns; found ${cells.length}.`] };
    }
    const values = Object.fromEntries(TARGET_COLUMNS.map(([key], index) => [
      key, cells[index].trim().replace(/^'(?=[=+\-@])/, ''),
    ]));
    const entry = { line, values, errors: [] };
    const code = normalized(values.employeeCode);
    const matches = code ? mrs.filter((mr) => normalized(mr.employeeCode) === code) : [];
    if (!code) entry.errors.push('Employee Code is required.');
    else if (!matches.length) entry.errors.push('Employee Code must match a saved MR; missing MRs cannot be imported.');
    else if (matches.length > 1) entry.errors.push('Employee Code is ambiguous; use a unique MR code.');
    const candidate = {
      mrId: matches.length === 1 ? matches[0].id : '',
      startYear: values.startYear,
      endYear: values.endYear,
      q1: values.q1, q2: values.q2, q3: values.q3, q4: values.q4,
    };
    const { fields, errors } = validateSalesTarget(candidate, seen, mrs);
    entry.errors.push(...Object.values(errors).filter((message) => !message.startsWith('Choose a saved MR.')));
    entry.fields = fields;
    if (matches.length === 1 && fields?.startYear !== null && fields?.endYear !== null) {
      seen.push({ ...fields, id: `review-${line}` });
    }
    return entry;
  });
}

export function importSalesTargets(...args) { const result = buildImportSalesTargets(...args); recordLocalAction('sales_target', 'imported'); return result; }
function buildImportSalesTargets(entries, expected) {
  if (!expected || !Array.isArray(expected.records) || !Array.isArray(expected.mrs) || !Array.isArray(expected.zones)) {
    throw new Error('Sales target snapshots are required. Refresh records and review the CSV again.');
  }
  const current = loadSalesTargets();
  const currentMRs = loadMRs();
  const currentZones = loadZones();
  if (!same(current, expected.records) || !same(currentMRs, expected.mrs) || !same(currentZones, expected.zones)) {
    throw new Error('Sales targets, MRs or zones changed since review. Refresh records and review the CSV again before importing.');
  }
  if (!Array.isArray(entries) || !entries.length) throw new Error('Resolve all row errors before importing. Nothing was saved.');
  const batch = [];
  const clean = [];
  for (const entry of entries) {
    if (!entry || !entry.values || entry.errors?.length) {
      throw new Error('Resolve all row errors before importing. Nothing was saved.');
    }
    const values = entry.values;
    if (Object.keys(values).some((key) => !TARGET_COLUMNS.some(([field]) => field === key))) {
      throw new Error('Sales target import data contains unsupported fields. Nothing was saved.');
    }
    const code = normalized(values.employeeCode);
    const matches = code ? currentMRs.filter((mr) => normalized(mr.employeeCode) === code) : [];
    if (matches.length !== 1) throw new Error(matches.length ? 'Employee Code is ambiguous. Nothing was saved.' : 'Employee Code must match a saved MR. Nothing was saved.');
    const candidate = {
      mrId: matches[0].id,
      startYear: values.startYear,
      endYear: values.endYear,
      q1: values.q1, q2: values.q2, q3: values.q3, q4: values.q4,
    };
    const fields = checked([...current, ...batch], currentMRs, candidate);
    batch.push(fields);
    clean.push(fields);
  }
  const now = new Date().toISOString();
  const next = [...current, ...clean.map((fields) => ({
    ...fields,
    id: typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID() : `sales-target-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdBy: ACTOR,
    createdAt: now,
    updatedBy: ACTOR,
    updatedAt: now,
  }))];
  return save(next, expected.records, expected.mrs, expected.zones);
}

export function sumSalesTargets(records) {
  return records.reduce((total, record) => total + record.q1 + record.q2 + record.q3 + record.q4, 0);
}