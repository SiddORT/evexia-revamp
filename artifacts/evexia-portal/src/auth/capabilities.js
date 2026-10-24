// Pure capability helpers. The server remains authoritative; this only decides
// what a verified identity may see or attempt in the browser.
export const ZONE_PERMISSIONS = Object.freeze([
  { key: 'zone.view', label: 'View', hint: 'Read live zone records without mutations or transfers.' },
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
  { key: 'language', label: 'Language', path: 'languages', import: 'language' },
  { key: 'designation', label: 'Designation', path: 'designations', import: 'designation' },
  { key: 'allergen', label: 'Allergen', path: 'allergens', import: 'allergen' },
  { key: 'product', label: 'Product', path: 'products', import: 'product' },
  { key: 'vendor', label: 'Vendor', path: 'vendors', import: 'vendor' },
  { key: 'sales_target', label: 'Sales Target', path: 'sales-targets', import: 'sales-target' },
  { key: 'opening_balance', label: 'Opening Balance', path: 'opening-balances', import: 'opening-balance' },
  { key: 'opening_stock', label: 'Opening Stock', path: 'opening-stock', import: 'opening-stock', actions: ['view', 'add', 'import', 'export'] },
]);
export const MASTER_PERMISSIONS = Object.freeze(MASTER_CATALOGUE.flatMap((master) =>
  ZONE_PERMISSIONS.filter(({ key }) => !master.actions || master.actions.includes(key.split('.')[1])).map(({ key, label, hint }) => ({
    key: `${master.key}.${key.split('.')[1]}`, label, master: master.key,
    hint: hint.replaceAll('zones', master.label.toLowerCase() + ' records'),
  }))));
export const MASTER_KEYS = Object.freeze(MASTER_PERMISSIONS.map(({ key }) => key));
const MASTER_ACTIONS = Object.freeze(['view', 'add', 'edit', 'delete', 'import', 'export']);
const PROCUREMENT_ACTIONS = Object.freeze(['view', 'add', 'edit', 'delete', 'export', 'print', 'history', 'activity', 'analytics']);
export const ACTION_LABELS = Object.freeze({
  view: 'View', add: 'Add', edit: 'Edit', delete: 'Delete', import: 'Import', export: 'Export',
  print: 'Print / Download PDF', history: 'View History', activity: 'View Activity', analytics: 'View Analytics',
  create: 'Create Movement', upload_attachment: 'Upload Prescription / Attachment',
  read_attachment: 'View / Download Prescription / Attachment', status: 'Activate / Deactivate',
});
export const PERMISSION_MODULES = Object.freeze([
  { key: 'masters', label: 'Masters', resources: MASTER_CATALOGUE.map((item) => ({ ...item, actions: item.actions || MASTER_ACTIONS })) },
  { key: 'inventory', label: 'Inventory', resources: [
    { key: 'purchase_order', label: 'Purchase Orders', actions: PROCUREMENT_ACTIONS },
    { key: 'purchase_received', label: 'Purchase Received', actions: PROCUREMENT_ACTIONS },
    { key: 'stock_movement', label: 'Move Stocks', actions: ['view', 'create', 'activity', 'analytics'] },
    { key: 'stock_status', label: 'Stock Status', actions: ['view', 'export', 'history'], labels: { history: 'View Stock History' } },
  ] },
  { key: 'orders', label: 'Orders', resources: [
    { key: 'immunotherapy', label: 'Immunotherapy', actions: ['view', 'add', 'edit', 'import', 'export', 'upload_attachment', 'read_attachment'] },
    { key: 'spt', label: 'SPT', actions: ['view', 'add', 'edit', 'import', 'export'] },
    { key: 'kits', label: 'Kits & Consumables', actions: ['view', 'add', 'import', 'export', 'upload_attachment', 'read_attachment'] },
    { key: 'lupin', label: 'Lupin', actions: ['view', 'add', 'import', 'export', 'upload_attachment', 'read_attachment'] },
  ] },
  { key: 'users', label: 'User Management', resources: [
    { key: 'staff', label: 'Staff Management', actions: ['view', 'add', 'edit', 'delete', 'status'] },
    { key: 'staff_access', label: 'Staff Access', actions: ['view'], labels: { view: 'View Access' },
      protected: ['Assign Role', 'Enable / Disable Login'] },
    { key: 'role', label: 'Roles', actions: ['view', 'add', 'edit', 'delete'] },
    { key: 'permissions', label: 'Permissions', actions: ['view'], labels: { view: 'View Permissions' },
      protected: ['Change Role Permissions'] },
  ] },
]);
export const ASSIGNABLE_KEYS = Object.freeze(PERMISSION_MODULES.flatMap(({ resources }) =>
  resources.flatMap(({ key, actions }) => actions.map((action) => `${key}.${action}`))));
export const STAFF_VISIBLE_PERMISSIONS = Object.freeze(['workspace.access', ...ASSIGNABLE_KEYS]);

export const hasCapability = (user, resource, action) => ASSIGNABLE_KEYS.includes(`${resource}.${action}`)
  && (isSuperAdminIdentity(user) || (isStaffIdentity(user) && user.permissions?.includes(`${resource}.${action}`)));
export const canReadResource = (user, resource) => ASSIGNABLE_KEYS.some((key) => key.startsWith(`${resource}.`)
  && (isSuperAdminIdentity(user) || (isStaffIdentity(user) && user.permissions?.includes(key))));

export const isSuperAdminIdentity = (user) => Boolean(user && user.identity_kind === 'super_admin' && user.permissions?.includes('admin.access'));
export const isStaffIdentity = (user) => Boolean(user && user.identity_kind === 'staff');
export const hasZonePermission = (user, key) => isSuperAdminIdentity(user) || (isStaffIdentity(user) && user.permissions.includes(key));
export const canViewZones = (user) => isSuperAdminIdentity(user) || (isStaffIdentity(user) && ZONE_KEYS.some((key) => user.permissions.includes(key)));
export const hasMasterPermission = (user, resource, action) => MASTER_KEYS.includes(`${resource}.${action}`)
  && (isSuperAdminIdentity(user) || (isStaffIdentity(user) && user.permissions?.includes(`${resource}.${action}`)));
export const canViewMaster = (user, resource) => MASTER_KEYS.some((key) => key.startsWith(`${resource}.`)
  && (isSuperAdminIdentity(user) || (isStaffIdentity(user) && user.permissions?.includes(key))));

const RESOURCE_NAMES = Object.freeze({
  products: 'product', 'opening-stock': 'opening_stock', 'purchase-orders': 'purchase_order',
  'purchase-received': 'purchase_received', 'immunotherapy-orders': 'immunotherapy',
  'spt-orders': 'spt', 'kits-orders': 'kits', 'lupin-orders': 'lupin',
});
export const workflowAllowed = (user, resource, path = '', { body, method, file, params = {} } = {}) => {
  if (isSuperAdminIdentity(user)) return true;
  if (!isStaffIdentity(user)) return false;
  const writing = body !== undefined || file !== undefined;
  const key = RESOURCE_NAMES[resource];
  const grant = (action) => Array.isArray(action) ? action.some((item) => hasCapability(user, key, item))
    : action === null ? canReadResource(user, key) : hasCapability(user, key, action);
  const uuid = /^\/[0-9a-f-]{36}$/i;
  if (resource === 'opening-stock') {
    if (['/sample', '/import/review'].includes(path)) return grant('import');
    if (path === '/export') return grant('export');
    if ((path === '' && writing) || path === '/preview') return grant(body?.mode === 'import' ? 'import' : 'add');
    if (/^\/requests\/[0-9a-f-]{36}$/i.test(path)) return grant(['add', 'import']);
    return !writing && (path === '' || path === '/references/items' || uuid.test(path)) && grant(null);
  }
  if (resource === 'products') {
    if (['/sample', '/import/review', '/import/commit'].includes(path)) return grant('import');
    if (path === '/export') return grant('export');
    if (path === '' && writing) return grant('add');
    if (uuid.test(path) && writing) return grant(method === 'DELETE' ? 'delete' : 'edit');
    if (/\/status$/.test(path) && writing) return grant('edit');
    if (/^\/requests\/[0-9a-f-]{36}$/i.test(path)) return grant(['add', 'edit', 'delete', 'import']);
    return !writing && (path === '' || path === '/references' || uuid.test(path)
      || /^\/filter-references\/(?:categories|allergens)$/.test(path)) && grant(null);
  }
  if (resource === 'inventory') {
    if (!writing && path === '/references/locations' && params.purpose === 'opening_stock') return canReadResource(user, 'opening_stock');
    if (!writing && ['/references/staff', '/references/lots'].includes(path)) return hasCapability(user, 'stock_movement', 'create');
    if (path === '/stock') return !writing && (params.snapshot
      ? hasCapability(user, 'stock_status', 'export') : canReadResource(user, 'stock_status'));
    if (/^\/stock\/[0-9a-f-]{36}\/history$/i.test(path)) return !writing && hasCapability(user, 'stock_status', 'history');
    if (['/movements', '/movements/preview'].includes(path) && writing) return hasCapability(user, 'stock_movement', 'create');
    if (/^\/requests\/[0-9a-f-]{36}$/i.test(path)) return hasCapability(user, 'stock_movement', 'create');
    if (/^\/movements\/[0-9a-f-]{36}\/(?:activity|analytics)$/i.test(path)) return !writing
      && hasCapability(user, 'stock_movement', path.endsWith('/activity') ? 'activity' : 'analytics');
    return !writing && (/^\/movements(?:\/[0-9a-f-]{36})?$/i.test(path)
      || /^\/references\/(?:locations|staff|lots|movement-sources|movement-destinations|movement-allergens)$/.test(path))
      && canReadResource(user, 'stock_movement');
  }
  if (['immunotherapy-orders', 'spt-orders', 'kits-orders', 'lupin-orders'].includes(resource)) {
    if (path === '/export') return grant('export');
    if (/^\/import\/(?:review|commit)$/.test(path)) return grant('import');
    if (path === '/policy' || /^\/attachments\/[0-9a-f-]{36}\/cancel$/i.test(path)) return grant('upload_attachment');
    if (path === '/patients' && resource === 'spt-orders') return grant(['add', 'import']);
    if (path === '' && writing) return grant('add');
    if (/^\/[0-9a-f-]{36}\/edit$/i.test(path)) return grant('edit');
    return !writing && (path === '' || uuid.test(path) || /^\/references\/(?:patients|doctors|mrs|allergens)$/.test(path)) && grant(null);
  }
  if (['purchase-orders', 'purchase-received'].includes(resource)) {
    if (path === '/overview') return grant('analytics');
    if (resource === 'purchase-received' && ((path === '/batch-settings' && !writing) || path === '/batch-allocations')) return grant(['add', 'edit']);
    if (path === '/export') return grant('export');
    if (path === '/activity') return grant('activity');
    if (path === '/analytics') return grant('analytics');
    if (/\/documents$/.test(path)) return !writing && grant('print');
    if (/\/history$/.test(path)) return !writing && grant('history');
    if (writing && (path === '' || path === '/preview')) return grant('add');
    if (writing && /\/(?:edit|preview)$/.test(path)) return grant('edit');
    if (writing && /\/delete$/.test(path)) return grant('delete');
    if (/^\/requests\/[0-9a-f-]{36}$/i.test(path)) return grant(['add', 'edit', 'delete']);
    return !writing && (path === '' || uuid.test(path) || ['/overview', '/filter-options'].includes(path)
      || /^\/(?:references|filter-options)\/(?:vendors|locations|products|staff|orders)$/.test(path)
      || /^\/sources\/[0-9a-f-]{36}$/i.test(path)) && grant(null);
  }
  return false;
};

// Paths a restricted staff identity may mount. Everything else is redirected
// to /admin before any unrelated screen renders.
export const STAFF_PATHS = Object.freeze(['/admin', '/admin/masters/zones', '/admin/masters/import/zone']);
export const staffPathAllowed = (path, user) => {
  if (path === '/admin') return true;
  if (path === '/admin/languages') return canViewMaster(user, 'language');
  if (path === '/admin/staff') return canReadResource(user, 'staff');
  if (path === '/admin/staff-access') return hasCapability(user, 'staff_access', 'view');
  if (path === '/admin/roles-permissions') return canReadResource(user, 'role') || hasCapability(user, 'permissions', 'view');
  const workflow = /^\/admin\/(inventory|orders)\/([^/]+)(?:\/([^/]+))?(?:\/(edit))?$/.exec(path);
  if (workflow) {
    const resource = ({
      'purchase-orders': 'purchase_order', 'purchase-received': 'purchase_received',
      'stock-status': 'stock_status', 'move-stocks': 'stock_movement',
      immunotherapy: 'immunotherapy', spt: 'spt', 'kits-consumables': 'kits', lupin: 'lupin',
    })[workflow[2]];
    if (!resource) return false;
    if (!workflow[3]) return canReadResource(user, resource);
    if (workflow[3] === 'new') return hasCapability(user, resource, resource === 'stock_movement' ? 'create' : 'add');
    if (!/^[0-9a-f-]{36}$/i.test(workflow[3])) return false;
    return workflow[4] ? hasCapability(user, resource, 'edit') : canReadResource(user, resource);
  }
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
  if (match[2] === 'import' && ['patient', 'opening_stock'].includes(master.key)) return hasMasterPermission(user, master.key, 'import');
  return /^[0-9a-f-]{36}$/.test(match[2]) && canViewMaster(user, master.key);
};
