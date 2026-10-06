// Observations only. No record values, identifiers or names leave this module.
const listeners = new Set();
const resources = new Set([
  'dashboard', 'zone', 'courier_partner', 'storage_location', 'headquarter',
  'mr', 'doctor', 'patient', 'designation', 'staff', 'product_category',
  'allergen', 'vendor', 'sales_target', 'opening_balance', 'purchase_order',
  'purchase_received', 'communication', 'message_template', 'invoice_template',
  'receipt_template', 'settings', 'roles_permissions', 'activity_logs', 'masters',
]);
const actions = new Set(['page_view', 'created', 'updated', 'deleted', 'imported', 'exported', 'settings_changed']);
export function subscribeLocalActivity(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function recordLocalAction(resource, action) {
  if (!resources.has(resource) || !actions.has(action)) return;
  for (const listener of listeners) {
    try { listener({ resource, action }); } catch { /* Never undo a committed local write. */ }
  }
}
function rows(value) {
  if (!value || typeof value !== 'object') return [];
  if (!Array.isArray(value) && value.id !== undefined) return [value];
  return Object.values(value).flatMap(rows);
}
export function recordLocalChanges(resource, before, after) {
  try {
    const oldRows = new Map(rows(before).map((r) => [r.id, r]));
    const newRows = new Map(rows(after).map((r) => [r.id, r]));
    if (!oldRows.size && !newRows.size && JSON.stringify(before) !== JSON.stringify(after)) {
      recordLocalAction(resource, 'settings_changed');
    }
    if ([...newRows.keys()].some((id) => !oldRows.has(id))) recordLocalAction(resource, 'created');
    if ([...oldRows.keys()].some((id) => !newRows.has(id))) recordLocalAction(resource, 'deleted');
    if ([...newRows].some(([id, r]) => oldRows.has(id) && JSON.stringify(r) !== JSON.stringify(oldRows.get(id)))) recordLocalAction(resource, 'updated');
  } catch { /* Activity observation cannot change storage semantics. */ }
}
export function reportExport(resource, build) {
  const result = build();
  recordLocalAction(resource, 'exported');
  return result;
}
