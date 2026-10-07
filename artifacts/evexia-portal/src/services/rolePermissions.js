import { roleRequest, SessionError } from '../auth/adminSession.js';

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
export function roleRecord(data) {
  if (!data || typeof data.id !== 'string' || !/^[0-9a-f-]{36}$/.test(data.id)
      || typeof data.name !== 'string' || !data.name.trim() || typeof data.description !== 'string'
      || !Number.isSafeInteger(data.version) || data.version < 1
      || typeof data.created_at !== 'string' || typeof data.updated_at !== 'string'
      || !Array.isArray(data.permissions) || data.permissions.length !== 0) {
    throw new SessionError('Role service returned invalid metadata. Refresh roles before submitting again.');
  }
  return { id: data.id, name: data.name, description: data.description, version: data.version,
    created_at: data.created_at, updated_at: data.updated_at, permissions: [] };
}
export async function listRoles(cursor = null, options) {
  const path = `?limit=50${cursor ? `&cursor=${idPath(cursor).slice(1)}` : ''}`;
  const data = await roleRequest(path, undefined, options);
  if (!data || !Array.isArray(data.items) || typeof data.has_more !== 'boolean'
      || data.limit !== 50 || (data.has_more && (!data.next_cursor || data.next_cursor === cursor))
      || (!data.has_more && data.next_cursor !== null)) throw new SessionError('Role service returned an invalid directory. Refresh roles.');
  if (data.next_cursor) idPath(data.next_cursor);
  return { ...data, items: data.items.map(roleRecord) };
}
export const getRole = async (id, options) => roleRecord(await roleRequest(idPath(id), undefined, options));
async function mutation(path, body) {
  const data = await roleRequest(path, body);
  try { return roleRecord(data); }
  catch (error) { error.ambiguous = true; throw error; }
}
export const createRole = (fields) => mutation('', fields);
export const updateRole = (id, fields, version) => mutation(`${idPath(id)}/edit`, { ...fields, expected_version: version });
export const deleteRole = (id, version) => mutation(`${idPath(id)}/delete`, { expected_version: version });
