const STORAGE_KEY = 'evexia.admin.zones.v1';
const INITIAL_NAMES = ['North Zone', 'South Zone', 'East Zone', 'West Zone'];
const STATUSES = ['active', 'inactive'];

function isValidZone(zone) {
  return zone !== null
    && typeof zone === 'object'
    && typeof zone.id === 'string' && zone.id.length > 0
    && typeof zone.name === 'string' && zone.name.trim().length > 0
    && STATUSES.includes(zone.status)
    && typeof zone.createdBy === 'string'
    && typeof zone.updatedBy === 'string'
    && typeof zone.createdAt === 'string' && !Number.isNaN(Date.parse(zone.createdAt))
    && typeof zone.updatedAt === 'string' && !Number.isNaN(Date.parse(zone.updatedAt));
}

function seedZones() {
  return INITIAL_NAMES.map((name, index) => {
    const createdAt = new Date(2025, 1, 12 + index, 9 + index, 15).toISOString();
    return {
      id: `seed-${index + 1}`,
      name,
      status: 'active',
      createdBy: 'Admin User',
      createdAt,
      updatedBy: 'Admin User',
      updatedAt: createdAt,
    };
  });
}

export function loadZones() {
  let stored;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    throw new Error('Zones could not be loaded because browser storage is unavailable.');
  }
  if (stored !== null) {
    let parsed;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new Error('Saved zone data is invalid. Your zones were not changed.');
    }
    if (!Array.isArray(parsed) || !parsed.every(isValidZone)) {
      throw new Error('Saved zone data is invalid. Your zones were not changed.');
    }
    return parsed;
  }
  const initial = seedZones();
  return writeZones(initial);
}

function writeZones(zones) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(zones));
  } catch {
    throw new Error('Zones could not be saved in this browser. Check browser storage settings and try again.');
  }
  return zones;
}

function saveZones(zones, expectedZones) {
  const current = loadZones();
  if (JSON.stringify(current) !== JSON.stringify(expectedZones)) {
    throw new Error('Zones changed in another tab. Reload the page to review the latest data before saving.');
  }
  return writeZones(zones);
}

function ensureUnique(zones, name, exceptId) {
  if (zones.some((zone) => zone.id !== exceptId && zone.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('A zone with this name already exists.');
  }
}

export function createZone(zones, values) {
  const name = typeof values?.name === 'string' ? values.name.trim() : '';
  if (!name) throw new Error('Zone name is required.');
  ensureUnique(zones, name);
  const timestamp = new Date().toISOString();
  const zone = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `zone-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    status: values.status === 'inactive' ? 'inactive' : 'active',
    createdBy: 'Admin User',
    createdAt: timestamp,
    updatedBy: 'Admin User',
    updatedAt: timestamp,
  };
  return saveZones([zone, ...zones], zones);
}

export function updateZone(zones, id, values) {
  const name = typeof values?.name === 'string' ? values.name.trim() : '';
  if (!name) throw new Error('Zone name is required.');
  if (!zones.some((zone) => zone.id === id)) throw new Error('This zone is no longer available.');
  ensureUnique(zones, name, id);
  return saveZones(zones.map((zone) => zone.id === id
    ? { ...zone, name, status: values.status === 'inactive' ? 'inactive' : 'active', updatedBy: 'Admin User', updatedAt: new Date().toISOString() }
    : zone), zones);
}

export function setZoneStatus(zones, id, status) {
  if (!STATUSES.includes(status)) throw new Error('Choose a valid zone status.');
  if (!zones.some((zone) => zone.id === id)) throw new Error('This zone is no longer available.');
  return saveZones(zones.map((zone) => zone.id === id
    ? { ...zone, status, updatedBy: 'Admin User', updatedAt: new Date().toISOString() }
    : zone), zones);
}

export function deleteZone(zones, id) {
  if (!zones.some((zone) => zone.id === id)) throw new Error('This zone is no longer available.');
  return saveZones(zones.filter((zone) => zone.id !== id), zones);
}

export function importZones(zones, next) {
  return saveZones(next, zones);
}

export function exportZoneCSV(zones) {
  const columns = [
    ['name', 'Zone Name'], ['status', 'Status'], ['createdBy', 'Created By'],
    ['createdAt', 'Created At'], ['updatedBy', 'Updated By'], ['updatedAt', 'Updated At'],
  ];
  const cell = (value) => {
    const text = String(value ?? '');
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return `\uFEFF${[columns.map(([, label]) => cell(label)).join(','), ...zones.map((zone) =>
    columns.map(([key]) => cell(zone[key])).join(','))].join('\r\n')}\r\n`;
}