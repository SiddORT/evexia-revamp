// Pure capability helpers. The server remains authoritative; this only decides
// what a verified identity may see or attempt in the browser.
export const ZONE_PERMISSIONS = Object.freeze([
  { key: 'zone.add', label: 'Add', hint: 'Create zones manually.' },
  { key: 'zone.edit', label: 'Edit', hint: 'Update zones and activate or deactivate them.' },
  { key: 'zone.delete', label: 'Delete', hint: 'Soft-delete zones.' },
  { key: 'zone.export', label: 'Export', hint: 'Download CSV and Excel exports.' },
  { key: 'zone.import', label: 'Import', hint: 'Download samples, review files and commit create-only imports.' },
]);
export const ZONE_KEYS = Object.freeze(ZONE_PERMISSIONS.map((item) => item.key));
export const MASTER_CATALOGUE = Object.freeze([
  { key: 'headquarter', label: 'Headquarter', path: 'headquarters', import: 'headquarter' },
  { key: 'zone', label: 'Zone', path: 'zones', import: 'zone' },
  { key: 'mr', label: 'MR', path: 'mrs', import: 'mr' },
  { key: 'patient', label: 'Patient', path: 'patients', import: 'patient' },
  { key: 'doctor', label: 'Doctor', path: 'doctors', import: 'doctor' },
  { key: 'product_category', label: 'Product Category', path: 'product-categories', import: 'product-category' },
  { key: 'location', label: 'Storage Location', path: 'storage-locations', import: 'storage-location' },
  { key: 'courier', label: 'Courier Partner', path: 'courier-partners', import: 'courier-partner' },
]);
export const MASTER_PERMISSIONS = Object.freeze(MASTER_CATALOGUE.flatMap((master) =>
  ZONE_PERMISSIONS.map(({ key, label, hint }) => ({
    key: `${master.key}.${key.split('.')[1]}`, label, master: master.key,
    hint: hint.replaceAll('zones', master.label.toLowerCase() + ' records'),
  }))));
export const MASTER_KEYS = Object.freeze(MASTER_PERMISSIONS.map(({ key }) => key));
export const STAFF_VISIBLE_PERMISSIONS = Object.freeze(['workspace.access', ...MASTER_KEYS]);

export const isSuperAdminIdentity = (user) => Boolean(user && user.identity_kind === 'super_admin' && user.permissions?.includes('admin.access'));
export const isStaffIdentity = (user) => Boolean(user && user.identity_kind === 'staff');
export const hasZonePermission = (user, key) => isSuperAdminIdentity(user) || (isStaffIdentity(user) && user.permissions.includes(key));
export const canViewZones = (user) => isSuperAdminIdentity(user) || (isStaffIdentity(user) && ZONE_KEYS.some((key) => user.permissions.includes(key)));
export const hasMasterPermission = (user, resource, action) => MASTER_KEYS.includes(`${resource}.${action}`)
  && (isSuperAdminIdentity(user) || (isStaffIdentity(user) && user.permissions?.includes(`${resource}.${action}`)));
export const canViewMaster = (user, resource) => MASTER_KEYS.some((key) => key.startsWith(`${resource}.`)
  && (isSuperAdminIdentity(user) || (isStaffIdentity(user) && user.permissions?.includes(key))));

// Paths a restricted staff identity may mount. Everything else is redirected
// to /admin before any unrelated screen renders.
export const STAFF_PATHS = Object.freeze(['/admin', '/admin/masters/zones', '/admin/masters/import/zone']);
export const staffPathAllowed = (path, user) => {
  if (path === '/admin') return true;
  const imported = /^\/admin\/masters\/import\/([^/]+)$/.exec(path);
  if (imported) {
    const master = MASTER_CATALOGUE.find((item) => item.import === imported[1]);
    return Boolean(master && hasMasterPermission(user, master.key, 'import'));
  }
  const match = /^\/admin\/masters\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (!match) return false;
  const master = MASTER_CATALOGUE.find((item) => item.path === match[1]);
  if (!master) return false;
  if (!match[2]) return canViewMaster(user, master.key);
  if (match[2] === 'new') return hasMasterPermission(user, master.key, 'add');
  if (match[2] === 'import' && master.key === 'patient') return hasMasterPermission(user, master.key, 'import');
  return /^[0-9a-f-]{36}$/.test(match[2]) && hasMasterPermission(user, master.key, 'edit');
};
