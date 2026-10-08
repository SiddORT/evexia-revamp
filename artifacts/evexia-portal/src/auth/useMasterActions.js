import { useAdminSession } from './AdminBoundary.jsx';
import { hasMasterPermission, isSuperAdminIdentity } from './capabilities.js';

export function useMasterActions(resource) {
  const { user } = useAdminSession();
  return Object.fromEntries([
    ...['add', 'edit', 'delete', 'import', 'export'].map((action) =>
      [action, hasMasterPermission(user, resource, action)]),
    ['protected', isSuperAdminIdentity(user)],
  ]);
}
