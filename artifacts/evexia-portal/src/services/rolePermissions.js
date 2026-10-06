// Preview catalogue only. Never consumed by staff, authentication or route guards.
export const ACTIONS = [
  { id: 'view', label: 'View' },
  { id: 'edit', label: 'Add / Edit' },
  { id: 'delete', label: 'Delete' },
  { id: 'download', label: 'Download' },
];
const directoryActions = ['view', 'edit', 'download'];
const removableActions = ['view', 'edit', 'delete', 'download'];
const row = (id, label, actions = directoryActions) => ({ id, label, actions: [...actions] });

export const MODULES = [
  { id: 'dashboard', label: 'Dashboard', rows: [row('dashboard', 'Dashboard', ['view'])] },
  { id: 'masters', label: 'Masters', rows: [
    row('zones', 'Zone Master', removableActions),
    row('courier-partners', 'Courier Partner', removableActions),
    row('storage-locations', 'Storage Location'),
    row('headquarters', 'Headquarter Master'),
    row('mrs', 'MR Master', removableActions),
    row('doctors', 'Doctor Master'),
    row('patients', 'Patient Master'),
    row('designations', 'Designation Master'),
    row('product-categories', 'Product Category'),
    row('allergens', 'Allergen Master'),
    row('vendors', 'Vendor Master'),
    row('sales-targets', 'Sales Target Master'),
    row('opening-balances', 'Opening Balance'),
  ] },
  { id: 'inventory', label: 'Inventory', rows: [
    row('purchase-orders', 'Purchase Orders', removableActions),
    row('purchase-received', 'Purchase Received', removableActions),
  ] },
  { id: 'users', label: 'User Management', rows: [
    row('staff', 'Staff Management'),
    row('roles-permissions', 'Roles & Permissions', ['view', 'edit']),
  ] },
  { id: 'settings', label: 'Settings', rows: [row('appearance', 'Appearance & Display', ['view', 'edit'])] },
];

export function permissionKeys(rows, actionId) {
  return rows.flatMap((item) => item.actions.filter((action) => !actionId || action === actionId).map((action) => `${item.id}:${action}`));
}
export const ALL_PERMISSION_KEYS = permissionKeys(MODULES.flatMap((module) => module.rows));
export function selectionSummary(selected, keys) {
  const selection = new Set(selected);
  const count = keys.filter((key) => selection.has(key)).length;
  return { checked: keys.length > 0 && count === keys.length, mixed: count > 0 && count < keys.length, count, total: keys.length };
}
export function togglePermissions(selected, keys) {
  const next = new Set(selected);
  const remove = selectionSummary(selected, keys).checked;
  keys.forEach((key) => { if (remove) next.delete(key); else if (ALL_PERMISSION_KEYS.includes(key)) next.add(key); });
  return [...next];
}
export function validateRoleName(name, roles) {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a role name.';
  if (roles.some((role) => role.name.trim().toLowerCase() === trimmed.toLowerCase())) return 'A role with this name already exists. Choose a different name.';
  return '';
}
export function createDemoRoles() {
  const definitions = [
    { id: 'demo-coordinator', name: 'Demo Coordinator', description: 'Fictional example with every preview permission.', permissions: ALL_PERMISSION_KEYS },
    { id: 'demo-procurement', name: 'Demo Procurement', description: 'Fictional example for purchase orders and receipts.', permissions: permissionKeys(MODULES.find((module) => module.id === 'inventory').rows).filter((key) => !key.endsWith(':delete')) },
    { id: 'demo-reader', name: 'Demo Reader', description: 'Fictional example with view-only selections.', permissions: ALL_PERMISSION_KEYS.filter((key) => key.endsWith(':view')) },
  ];
  return definitions.map((role) => ({ ...role, permissions: [...role.permissions], savedPermissions: [...role.permissions] }));
}
