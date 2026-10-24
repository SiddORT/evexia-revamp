import { useAdminSession } from './AdminBoundary.jsx';
import { hasMasterPermission, isSuperAdminIdentity, PERMISSION_MODULES, hasCapability, canReadResource } from './capabilities.js';

export function useMasterActions(resource) {
  const { user } = useAdminSession();
  return Object.fromEntries([
    ...['view', 'add', 'edit', 'delete', 'import', 'export'].map((action) =>
      [action, hasMasterPermission(user, resource, action)]),
    ['read', canReadResource(user, resource)], ['protected', isSuperAdminIdentity(user)],
  ]);
}

export function useResourceActions(resource) {
  const { user } = useAdminSession();
  const actions = PERMISSION_MODULES.flatMap((module) => module.resources).find((item) => item.key === resource)?.actions || [];
  return Object.fromEntries([
    ...actions.map((action) => [action, hasCapability(user, resource, action)]),
    ['read', canReadResource(user, resource)], ['protected', isSuperAdminIdentity(user)],
  ]);
}
