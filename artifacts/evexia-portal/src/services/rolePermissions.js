import { roleRequest, SessionError } from '../auth/adminSession.js';
import { MASTER_KEYS as ZONE_KEYS } from '../auth/capabilities.js';

export const ROLE_NAME_LIMIT = 100;
export const ROLE_DESCRIPTION_LIMIT = 1000;
const idPath = (id) => {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new SessionError('Invalid role reference.');
  return `/${id}`;
};
export function validateRoleName(name, roles = [], ownId) {
  const value = name.trim();
  if (!value) return 'Enter a role name.';
  if ([...value].length > ROLE_NAME_LIMIT) return 'Use at most 100 characters for the role name.';
  if (/[\u0000-\u001f\u007f]/.test(value)) return 'Use a role name without control characters.';
  if (roles.some((role) => role.id !== ownId && role.name.trim().toLowerCase() === value.toLowerCase())) return 'A role with this name already exists. Choose a different name.';
  return '';
}
export function validateRoleDescription(description) {
  if ([...description.trim()].length > ROLE_DESCRIPTION_LIMIT) return 'Use at most 1,000 characters for the description.';
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(description)) return 'Use a description without control characters.';
  return '';
}
export const validPermissions = (list) => Array.isArray(list) && new Set(list).size === list.length && list.every((key) => ZONE_KEYS.includes(key));
// Canonical catalogue order so comparisons and counts never depend on server order.
export const normalizePermissions = (list) => ZONE_KEYS.filter((key) => list.includes(key));
export const samePermissions = (a, b) => normalizePermissions(a).join() === normalizePermissions(b).join();
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value) => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
export function roleRecord(data) {
  if (Array.isArray(data?.permissions) && !validPermissions(data.permissions)) {
    throw new SessionError('Role service returned a permission this portal does not recognise. Nothing was changed. Refresh roles, and update the portal if this continues.');
  }
  if (!data || typeof data.id !== 'string' || !/^[0-9a-f-]{36}$/.test(data.id)
      || typeof data.name !== 'string' || !data.name.trim() || typeof data.description !== 'string'
      || !Number.isSafeInteger(data.version) || data.version < 1
      || !timestamp(data.created_at) || !timestamp(data.updated_at)
      || !uuid(data.created_by) || !uuid(data.updated_by)
      || !((data.deleted_at === null && data.deleted_by === null)
        || (timestamp(data.deleted_at) && uuid(data.deleted_by)))
      || !validPermissions(data.permissions)) {
    throw new SessionError('Role service returned invalid metadata. Refresh roles before submitting again.');
  }
  return { id: data.id, name: data.name, description: data.description, version: data.version,
    created_at: data.created_at, updated_at: data.updated_at, created_by: data.created_by,
    updated_by: data.updated_by, deleted_at: data.deleted_at, deleted_by: data.deleted_by,
    permissions: normalizePermissions(data.permissions) };
}
function liveRole(data) {
  const role = roleRecord(data);
  if (role.deleted_at !== null) {
    const error = new SessionError('This role is unavailable. Choose a current role or explicitly unassign it.');
    error.code = 'role_deleted'; error.status = 404;
    throw error;
  }
  return role;
}
export async function listRoles(cursor = null, options) {
  const path = `?limit=50${cursor ? `&cursor=${idPath(cursor).slice(1)}` : ''}`;
  const data = await roleRequest(path, undefined, options);
  if (!data || !Array.isArray(data.items) || typeof data.has_more !== 'boolean'
      || data.limit !== 50 || (data.has_more && (!data.next_cursor || data.next_cursor === cursor))
      || (!data.has_more && data.next_cursor !== null)) throw new SessionError('Role service returned an invalid directory. Refresh roles.');
  if (data.next_cursor) idPath(data.next_cursor);
  return { ...data, items: data.items.map(liveRole) };
}
export const getRole = async (id, options) => liveRole(await roleRequest(idPath(id), undefined, options));
async function mutation(path, body) {
  const data = await roleRequest(path, body);
  try { return roleRecord(data); }
  catch (error) { error.ambiguous = true; throw error; }
}
export const createRole = (fields) => mutation('', fields);
export const updateRole = (id, fields, version) => mutation(`${idPath(id)}/edit`, { ...fields, expected_version: version });
export const deleteRole = (id, version) => mutation(`${idPath(id)}/delete`, { expected_version: version });
export function setRolePermissions(id, permissions, version) {
  if (!validPermissions(permissions)) throw new SessionError('Choose only the listed master permissions.');
  return mutation(`${idPath(id)}/permissions`, { permissions: normalizePermissions(permissions), expected_version: version });
}
