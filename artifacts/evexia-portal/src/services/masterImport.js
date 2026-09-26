import { CSV_COLUMNS, importMRs, loadMRs, MR_STORAGE_KEY, validateMR } from './mrs.js';
import { importZones, loadZones } from './zones.js';
import { loadDoctors } from './doctors.js';

export const ZONE_COLUMNS = ['Zone Name', 'Status'];
const norm = (value) => value.trim().toLocaleLowerCase();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const id = () => crypto.randomUUID();

// RFC 4180-style quoted fields, including embedded commas, quotes and line breaks.
export function parseCSV(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Choose a nonempty CSV file.');
  if (text.includes('\0')) throw new Error('CSV contains invalid binary data.');
  const input = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false, closed = false, line = 1, rowLine = 1;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else { cell += char; if (char === '\n') line++; }
    } else if (char === '"' && !cell && !closed) {
      quoted = true;
    } else if (char === ',') {
      row.push(cell); cell = ''; closed = false;
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push({ line: rowLine, cells: row });
      row = []; cell = ''; closed = false; line++; rowLine = line;
    } else {
      if (char === '"' || closed) throw new Error(`Malformed CSV near line ${line}: unexpected text after a quoted field.`);
      cell += char;
    }
  }
  if (quoted) throw new Error(`Malformed CSV near line ${rowLine}: unclosed quote.`);
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push({ line: rowLine, cells: row });
  if (rows.length < 2) throw new Error('CSV needs a header and at least one data row.');
  if (rows.length > 1001) throw new Error('Import at most 1,000 records at a time.');
  return rows;
}

export function readImportSnapshots() {
  // Do not turn an unreadable collection into an empty list.
  const zones = loadZones();
  // A Zone-only import must not seed sample MRs just by opening the file picker.
  let mrRaw;
  try { mrRaw = window.localStorage.getItem(MR_STORAGE_KEY); }
  catch { throw new Error('MR records could not be loaded because browser storage is unavailable.'); }
  const mrs = mrRaw === null ? [] : loadMRs();
  const doctors = loadDoctors();
  return { zones, mrs, doctors };
}

function columns(rows, expected) {
  const headers = rows[0].cells.map((cell) => cell.trim());
  const allowed = expected.map(([, label]) => label);
  if (headers.length !== allowed.length || new Set(headers).size !== headers.length
    || headers.some((header, index) => header !== allowed[index])) {
    throw new Error(`CSV headers must match this exact order: ${allowed.join(', ')}. Unsupported or credential columns are not accepted.`);
  }
  return rows.slice(1).map(({ line, cells }) => {
    if (cells.length !== allowed.length) return { line, error: `Expected ${allowed.length} columns; found ${cells.length}.` };
    const values = Object.fromEntries(expected.map(([key], index) => [key, cells[index].trim()]));
    return { line, values };
  });
}

export function reviewImport(kind, text, snapshots) {
  const source = parseCSV(text);
  const entries = columns(source, kind === 'mr' ? CSV_COLUMNS : ZONE_COLUMNS.map((label, index) => [index ? 'status' : 'name', label]));
  const prepared = entries.map((entry) => ({ ...entry, id: id(), errors: entry.error ? [entry.error] : [] }));
  if (kind === 'zone') {
    const names = new Set(snapshots.zones.map((zone) => norm(zone.name)));
    for (const entry of prepared) {
      if (entry.error) continue;
      const { name, status } = entry.values;
      if (!name) entry.errors.push('Zone Name is required.');
      if (name && names.has(norm(name))) entry.errors.push('Zone name already exists (in saved records or this file).');
      if (name) names.add(norm(name));
      if (!['active', 'inactive'].includes(status)) entry.errors.push('Status must be active or inactive.');
    }
  } else {
    const names = new Set(snapshots.mrs.map((mr) => norm(mr.name)));
    const codes = new Set(snapshots.mrs.map((mr) => norm(mr.employeeCode)));
    const users = new Set(snapshots.mrs.map((mr) => norm(mr.userId)));
    const emails = new Set(snapshots.mrs.map((mr) => norm(mr.email)));
    for (const entry of prepared) {
      if (entry.error) continue;
      const name = norm(entry.values.name);
      if (name && names.has(name)) entry.errors.push('MR Name already exists (in saved records or this file).');
      if (name) names.add(name);
      for (const [key, set, label] of [['employeeCode', codes, 'Employee Code'], ['userId', users, 'User ID'], ['email', emails, 'Email ID']]) {
        const value = norm(entry.values[key]);
        if (value && set.has(value)) entry.errors.push(`${label} already exists (in saved records or this file).`);
        if (value) set.add(value);
      }
    }
    const all = [...snapshots.mrs, ...prepared.filter((entry) => !entry.error).map((entry) => ({ id: entry.id, name: entry.values.name, employeeCode: entry.values.employeeCode, userId: entry.values.userId, email: entry.values.email }))];
    for (const entry of prepared) {
      if (entry.error) continue;
      // Undo the exporter's spreadsheet-formula escape before matching labels.
      const fields = Object.fromEntries(Object.entries(entry.values).map(([key, value]) =>
        [key, /^'[=+\-@]/.test(value) ? value.slice(1) : value]));
      for (const [labelKey, targetKey, items, label] of [
        ['zoneName', 'zoneId', snapshots.zones, 'Assigned Zone'],
        ['managerName', 'reportingManagerId', all, 'Reporting Manager'],
      ]) {
        const name = norm(fields[labelKey]);
        const matches = name ? items.filter((item) => norm(item.name) === name) : [];
        if (labelKey === 'zoneName' && (!matches.length || matches[0].status !== 'active')) entry.errors.push(`${label} must match an active saved zone.`);
        if (labelKey === 'managerName' && name && !matches.length) entry.errors.push(`${label} must match a saved MR or another row in this file.`);
        if (matches.length > 1) entry.errors.push(`${label} is ambiguous; use unique names.`);
        fields[targetKey] = matches.length === 1 ? matches[0].id : '';
        delete fields[labelKey];
      }
      if (fields.reportingManagerId === entry.id) entry.errors.push('An MR cannot report to themselves.');
      const { fields: valid, errors } = validateMR(fields, all, entry.id);
      entry.errors.push(...Object.values(errors));
      entry.fields = valid;
    }
  }
  return prepared;
}

export function commitImport(kind, entries, expected) {
  const current = readImportSnapshots();
  if (!same(current.zones, expected.zones) || !same(current.mrs, expected.mrs) || !same(current.doctors, expected.doctors)) {
    throw new Error('Saved zones, MRs or doctors changed since review. Refresh records and review the file again before importing.');
  }
  if (!entries.length || entries.some((entry) => entry.errors.length)) throw new Error('Resolve all row errors before importing. Nothing was saved.');
  const now = new Date().toISOString();
  if (kind === 'zone') {
    const next = [...current.zones, ...entries.map((entry) => ({
      id: entry.id, ...entry.values, createdBy: 'Admin User', createdAt: now, updatedBy: 'Admin User', updatedAt: now,
    }))];
    // One write for the whole batch, using the same snapshot guard as individual edits.
    return importZones(current.zones, next);
  }
  const next = [...current.mrs, ...entries.map((entry) => ({
    ...entry.fields, id: entry.id, createdBy: 'Admin User', createdAt: now, updatedBy: 'Admin User', updatedAt: now,
  }))];
  return importMRs(current.mrs, current.zones, next);
}