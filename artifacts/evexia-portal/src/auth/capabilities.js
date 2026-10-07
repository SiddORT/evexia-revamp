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
export const STAFF_VISIBLE_PERMISSIONS = Object.freeze(['workspace.access', ...ZONE_KEYS]);

export const isSuperAdminIdentity = (user) => Boolean(user && user.identity_kind === 'super_admin' && user.permissions?.includes('admin.access'));
export const isStaffIdentity = (user) => Boolean(user && user.identity_kind === 'staff');
export const hasZonePermission = (user, key) => isSuperAdminIdentity(user) || (isStaffIdentity(user) && user.permissions.includes(key));
export const canViewZones = (user) => isSuperAdminIdentity(user) || (isStaffIdentity(user) && ZONE_KEYS.some((key) => user.permissions.includes(key)));

// Paths a restricted staff identity may mount. Everything else is redirected
// to /admin before any unrelated screen renders.
export const STAFF_PATHS = Object.freeze(['/admin', '/admin/masters/zones', '/admin/masters/import/zone']);
export const staffPathAllowed = (path) => STAFF_PATHS.includes(path);
