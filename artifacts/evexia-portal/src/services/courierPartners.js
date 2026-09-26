export const COURIER_PARTNER_STORAGE_KEY = 'evexia.admin.courier-partners.v1';
const STATUSES = ['active', 'inactive'];
const nameKey = (name) => name.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
const modifiedAt = (previous) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();

function valid(record) {
  return record !== null && typeof record === 'object' && !Array.isArray(record)
    && typeof record.id === 'string' && Boolean(record.id)
    && typeof record.name === 'string' && Boolean(record.name.trim())
    && STATUSES.includes(record.status)
    && typeof record.createdBy === 'string' && typeof record.updatedBy === 'string'
    && typeof record.createdAt === 'string' && !Number.isNaN(Date.parse(record.createdAt))
    && typeof record.updatedAt === 'string' && !Number.isNaN(Date.parse(record.updatedAt));
}

export function loadCourierPartners() {
  let raw;
  try { raw = window.localStorage.getItem(COURIER_PARTNER_STORAGE_KEY); }
  catch { throw new Error('Courier partners could not be loaded because browser storage is unavailable.'); }
  if (raw === null) return [];
  try {
    const records = JSON.parse(raw);
    if (!Array.isArray(records) || !records.every(valid)
      || new Set(records.map((record) => record.id)).size !== records.length
      || new Set(records.map((record) => nameKey(record.name))).size !== records.length) {
      throw new Error('invalid');
    }
    return records;
  } catch {
    throw new Error('Saved courier partner data is invalid. Your records were not changed. Check browser storage or restore a valid copy before trying again.');
  }
}

function save(records, expected) {
  if (JSON.stringify(loadCourierPartners()) !== JSON.stringify(expected)) {
    throw new Error('Courier partners changed in another tab. Refresh records before saving.');
  }
  try { window.localStorage.setItem(COURIER_PARTNER_STORAGE_KEY, JSON.stringify(records)); }
  catch { throw new Error('Courier partners could not be saved. Check browser storage settings and try again.'); }
  return records;
}

function nameFrom(values) {
  const name = typeof values?.name === 'string' ? values.name.trim() : '';
  if (!name) throw new Error('Courier partner name is required.');
  return name;
}

function unique(records, name, exceptId) {
  if (records.some((record) => record.id !== exceptId && nameKey(record.name) === nameKey(name))) {
    throw new Error('A courier partner with this name already exists.');
  }
}

export function createCourierPartner(records, values) {
  const name = nameFrom(values);
  unique(records, name);
  const now = new Date().toISOString();
  return save([{
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `courier-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name, status: values.status === 'inactive' ? 'inactive' : 'active',
    createdBy: 'Admin User', createdAt: now, updatedBy: 'Admin User', updatedAt: now,
  }, ...records], records);
}

export function updateCourierPartner(records, id, values) {
  const name = nameFrom(values);
  if (!records.some((record) => record.id === id)) throw new Error('This courier partner is no longer available.');
  unique(records, name, id);
  return save(records.map((record) => record.id === id
    ? { ...record, name, status: values.status === 'inactive' ? 'inactive' : 'active', updatedBy: 'Admin User', updatedAt: modifiedAt(record.updatedAt) }
    : record), records);
}

export function setCourierPartnerStatus(records, id, status) {
  if (!STATUSES.includes(status)) throw new Error('Choose a valid courier partner status.');
  if (!records.some((record) => record.id === id)) throw new Error('This courier partner is no longer available.');
  return save(records.map((record) => record.id === id
    ? { ...record, status, updatedBy: 'Admin User', updatedAt: modifiedAt(record.updatedAt) }
    : record), records);
}

export function deleteCourierPartner(records, id) {
  if (!records.some((record) => record.id === id)) throw new Error('This courier partner is no longer available.');
  return save(records.filter((record) => record.id !== id), records);
}

export function exportCourierPartnerCSV(records) {
  const columns = [
    ['name', 'Courier Partner Name'], ['status', 'Status'], ['createdBy', 'Created By'],
    ['createdAt', 'Created At'], ['updatedBy', 'Updated By'], ['updatedAt', 'Updated At'],
  ];
  const cell = (value) => {
    const text = String(value ?? '');
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return `\uFEFF${[columns.map(([, label]) => cell(label)).join(','), ...records.map((record) =>
    columns.map(([key]) => cell(record[key])).join(','))].join('\r\n')}\r\n`;
}