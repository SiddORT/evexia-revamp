import { createContext, useContext } from 'react';
import { roleConfig } from './roles.js';

export const PortalHostContext = createContext(null);
export const usePortalHost = () => useContext(PortalHostContext);
export const portalEntry = (role) => roleConfig[role]?.path || '/';
export function compatiblePortalPath(path, role) {
  const prefix = `/${role}`;
  return path === prefix || path.startsWith(`${prefix}/`);
}
