// Tokens live only in this module's memory. No credential or identity storage.
import { STAFF_VISIBLE_PERMISSIONS, MASTER_CATALOGUE, canViewMaster, hasMasterPermission, hasCapability, canReadResource, isSuperAdminIdentity, workflowAllowed } from './capabilities.js';
import { captureExportPreferences, exportPreferenceHeader } from '../services/exportPreferences.js';
import { privateUploadMessage, privateRequestReference, privateFileId } from './privateFileErrors.js';
const AUTH_URL = '/api/v1/auth';
const LOCK_NAME = 'evexia-auth-cookie';
const REPLACED_MESSAGE = 'Your Admin session ended because this account was signed in elsewhere. Please log in again.';
let state = Object.freeze({ status: 'idle', user: null, message: '' });
let token = null;
let expiresAt = 0;
let generation = 0;
let pending = null;
let expiryTimer = null;
let restorationAllowed = true;
const listeners = new Set();
const serverDownloads = new WeakMap();
const serverInitiations = new Map();
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('evexia-auth-events') : null;

export class SessionError extends Error {
  constructor(message, status = 0, replaced = false) { super(message); this.status = status; this.replaced = replaced; }
}

function publish(next) {
  state = Object.freeze(next);
  listeners.forEach((listener) => listener());
}

export const getSession = () => state;
export const subscribeSession = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

// A user ID alone does not distinguish privileged reads from MR-scoped reads.
export const contactReadScope = (user = state.user) => JSON.stringify([
  user?.id ?? null, user?.identity_kind ?? null, user?.mr_id ?? null,
]);

export function forgetSessionAfterPasswordReset() {
  restorationAllowed = false;
  clear('Your password was reset. Please sign in again.');
  channel?.postMessage({ type: 'identity-changed' });
}

function clear(message = '') {
  generation += 1;
  serverInitiations.clear();
  token = null;
  expiresAt = 0;
  clearTimeout(expiryTimer);
  publish({ status: 'anonymous', user: null, message });
}

if (channel) channel.onmessage = ({ data }) => {
  if (data?.type === 'signed-out' || data?.type === 'identity-changed') {
    restorationAllowed = false;
    clear('Your session changed in another tab. Please log in again.');
  }
};
if (typeof window !== 'undefined') {
  const recheck = () => {
    // Fresh-token focus changes must not unmount forms or discard local drafts.
    // Route changes verify /me; only an expired token needs a blocking restore.
    if (state.status === 'authenticated' && Date.now() >= expiresAt) void verifySession(true, portalOf(state.user));
  };
  window.addEventListener('focus', recheck);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recheck(); });
}

async function cookieLock(work) {
  // Rotating cookies are shared across tabs. An in-tab mutex alone is unsafe.
  if (!globalThis.navigator?.locks) {
    throw new SessionError('Secure sign-in requires a browser with Web Locks support. Use a current browser over HTTPS.');
  }
  return navigator.locks.request(LOCK_NAME, work);
}

async function request(path, body, bearer) {
  let response;
  try {
    response = await fetch(`${AUTH_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new SessionError('Unable to reach the sign-in service. Check your connection and try again.');
  }
  if (!response.ok) {
    const message = response.status === 429 ? 'Too many attempts. Try again later.'
      : response.status === 401 ? 'Invalid credentials or expired session.'
      : response.status === 403 ? 'This account does not have Admin access.'
      : 'The sign-in service is unavailable. Try again later.';
    // Ignore arbitrary response text and reasons on login failures. The hint
    // is not authorization and is displayed only for a previously verified tab.
    const replaced = response.status === 401 && ['/me', '/refresh'].includes(path)
      && response.headers.get('X-Session-Reason') === 'replaced';
    throw new SessionError(message, response.status, replaced);
  }
  if (response.status === 204) return null;
  try { return await response.json(); }
  catch { throw new SessionError('The sign-in service returned an invalid response.'); }
}

const portalOf = (user) => (user?.identity_kind === 'mr' ? 'mr' : 'admin');

// Verified MR identity from the database /me response: never admin, staff or permissions.
function safeMr(user) {
  if (user && typeof user.id === 'string' && user.identity_kind === 'mr' && user.system_role === 'mr'
      && typeof user.mr_id === 'string' && /^[0-9a-f-]{36}$/i.test(user.mr_id)
      && Array.isArray(user.permissions) && user.permissions.length === 0) {
    return Object.freeze({ id: user.id, mr_id: user.mr_id, email: user.email ?? null, username: user.username ?? null, display_name: displayDetail(user.display_name), system_role: 'mr', identity_kind: 'mr', permissions: Object.freeze([]) });
  }
  throw new SessionError('This account does not have MR access.', 403);
}
const safeFor = (user, portal) => (portal === 'mr' ? safeMr(user) : safeAdmin(user));
// Presentation-only values: never participate in permissions or routing.
const displayDetail = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

function safeAdmin(user) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : null;
  const kind = user?.identity_kind ?? (user?.system_role === 'super_admin' ? 'super_admin' : undefined);
  if (user && typeof user.id === 'string' && permissions && kind === 'super_admin' && typeof user.email === 'string'
      && user.system_role === 'super_admin' && permissions.includes('admin.access')) {
    return Object.freeze({ id: user.id, email: user.email, username: user.username, display_name: displayDetail(user.display_name), system_role: user.system_role, identity_kind: 'super_admin', permissions: permissions.filter((permission) => ['admin.access', 'staff.manage', 'roles.manage'].includes(permission)) });
  }
  // Verified restricted staff: never admin.access, never a system role.
  if (user && typeof user.id === 'string' && permissions && kind === 'staff' && user.system_role == null
      && (user.email === null || user.email === undefined || typeof user.email === 'string')
      && permissions.includes('workspace.access') && !permissions.includes('admin.access')) {
    return Object.freeze({ id: user.id, email: user.email ?? null, username: user.username ?? null,
      staff_name: displayDetail(user.staff_name), staff_designation: displayDetail(user.staff_designation),
      staff_role: displayDetail(user.staff_role),
      system_role: null, identity_kind: 'staff', permissions: Object.freeze(STAFF_VISIBLE_PERMISSIONS.filter((permission) => permissions.includes(permission))) });
  }
  throw new SessionError('This account does not have Admin access.', 403);
}

async function accept(payload, epoch, portal = 'admin') {
  if (epoch !== generation) return;
  if (typeof payload?.access_token !== 'string' || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0) {
    throw new SessionError('The sign-in service returned an invalid session.');
  }
  // Do not authorize using login/refresh role selection alone: verify DB identity.
  const user = safeFor(await request('/me', undefined, payload.access_token), portal);
  if (epoch !== generation) return;
  token = payload.access_token;
  expiresAt = Date.now() + payload.expires_in * 1000;
  publish({ status: 'authenticated', user, message: '' });
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => { void verifySession(true, portal); }, Math.max(0, expiresAt - Date.now()));
}

export async function loginAdmin(identifier, password, remember) {
  restorationAllowed = true;
  clear();
  const epoch = generation;
  publish({ status: 'checking', user: null, message: '' });
  try {
    await cookieLock(async () => {
      if (epoch !== generation) return;
      const payload = await request('/login', { identifier, password, remember_me: remember, identity_kind: 'admin' });
      try {
        await accept(payload, epoch);
      } catch (error) {
        // A valid non-Admin login must not leave its cookie signed in.
        if (error.status === 403) await request('/logout', {});
        throw error;
      }
    });
    if (epoch === generation && state.status === 'authenticated') channel?.postMessage({ type: 'identity-changed' });
  } catch (error) {
    if (epoch === generation) clear(error.message);
    throw error;
  }
}

export async function loginMr(identifier, password, remember) {
  restorationAllowed = true;
  clear();
  const epoch = generation;
  publish({ status: 'checking', user: null, message: '' });
  try {
    await cookieLock(async () => {
      if (epoch !== generation) return;
      const payload = await request('/login', { identifier, password, remember_me: remember, identity_kind: 'mr' });
      try { await accept(payload, epoch, 'mr'); }
      catch (error) {
        // A valid Admin/staff login must not leave its cookie signed in via the MR portal.
        if (error.status === 403) await request('/logout', {});
        throw error;
      }
    });
    if (epoch === generation && state.status === 'authenticated') channel?.postMessage({ type: 'identity-changed' });
  } catch (error) {
    if (epoch === generation) clear(error.status === 403 ? 'This account is not an MR account. Use the matching portal.' : error.message);
    throw error;
  }
}

// Change-own-password for a verified MR. Revokes sessions server-side, so end locally too.
export async function changeMrPassword(currentPassword, newPassword) {
  if (state.status !== 'authenticated' || state.user?.identity_kind !== 'mr' || !token) throw new SessionError('Your session changed. Please sign in again.', 401);
  const epoch = generation;
  let response;
  try {
    response = await fetch(`${AUTH_URL}/change-password`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      signal: AbortSignal.timeout(20000),
    });
  } catch { throw new SessionError('Password change could not be confirmed. Try signing in with the new password before retrying.'); }
  if (epoch !== generation) throw new SessionError('Your session changed. Please sign in again.', 401);
  if (!response.ok) {
    throw new SessionError(response.status === 401 || response.status === 403 ? 'Current password is incorrect or your session expired.'
      : response.status === 422 ? 'The new password does not meet the password policy.'
      : response.status === 429 ? 'Too many attempts. Try again later.' : 'Password change failed. Try again later.', response.status);
  }
  return true;
}

let pendingPortal = null;
export function verifySession(forceRefresh = false, portalArg) {
  // Compatibility checks must not trigger cookie rotation or reset mounted drafts.
  // Omitted portal follows the already-verified identity; never default a verified MR to Admin.
  const portal = portalArg ?? portalOf(state.user);
  if (pending) return pendingPortal === portal ? pending : pending.then(() => verifySession(forceRefresh, portal));
  pendingPortal = portal;
  if (!restorationAllowed) return Promise.resolve();
  const epoch = generation;
  const oldToken = token;
  // A previously verified identity is retained solely to preserve mounted local
  // drafts. Renewing/error states never authorize interaction or API access.
  const previousUser = state.user;
  publish({ status: previousUser ? 'renewing' : 'checking', user: previousUser, message: '' });
  pending = (async () => {
    try {
      if (oldToken && Date.now() < expiresAt) {
        try {
          const user = safeFor(await request('/me', undefined, oldToken), portal);
          if (!forceRefresh) {
            if (epoch === generation) publish({ status: 'authenticated', user, message: '' });
            return;
          }
        } catch (error) {
          // A known replaced bearer must not restore through a newer shared
          // cookie. Ordinary access expiry still follows the renewal path.
          if (error.status !== 401 || error.replaced) throw error;
        }
      }
      await cookieLock(async () => {
        if (epoch !== generation || !restorationAllowed) return;
        await accept(await request('/refresh', {}), epoch, portal);
      });
    } catch (error) {
      if (epoch !== generation) return;
      token = null;
      clearTimeout(expiryTimer);
      if (error.status === 401 || error.status === 403) {
        restorationAllowed = false;
        clear(previousUser && error.replaced ? (previousUser.identity_kind === 'mr'
          ? REPLACED_MESSAGE.replace('Admin', 'MR') : REPLACED_MESSAGE) : '');
      }
      else publish({ status: previousUser ? 'renewal-error' : 'error', user: previousUser, message: error.message });
    } finally { pending = null; }
  })();
  return pending;
}

export async function logoutAdmin({ beforeRevoke } = {}) {
  restorationAllowed = false;
  clear();
  const epoch = generation;
  channel?.postMessage({ type: 'signed-out' });
  try {
    await cookieLock(async () => {
      // UI authorization is already cleared. Give already-dispatched,
      // session-bound activity at most two seconds before server revocation.
      if (beforeRevoke) {
        let timeout;
        await Promise.race([
          Promise.resolve(beforeRevoke).catch(() => {}),
          new Promise((resolve) => { timeout = setTimeout(resolve, 2000); }),
        ]);
        clearTimeout(timeout);
      }
      return request('/logout', {});
    });
  } catch {
    if (epoch === generation) publish({ status: 'anonymous', user: null, message: 'Signed out of this tab, but server revocation could not be confirmed. Close this browser or retry Sign Out before leaving a shared device.' });
    return false;
  }
  if (epoch === generation) publish({ status: 'anonymous', user: null, message: '' });
  return true;
}

export function reportingIdentityGuard() {
  const epoch = generation;
  const owner = state.user?.id;
  const scope = contactReadScope();
  return () => {
    if (epoch !== generation || !owner || state.user?.id !== owner || scope !== contactReadScope() || state.status !== 'authenticated') {
      throw new SessionError('Your session changed. Export cancelled. Please retry after signing in.', 401);
    }
  };
}

// Dedicated authenticated staff transport. Never replay mutations: a lost create
// response may already have committed and its initial password is unrecoverable.
export async function staffRequest(path = '', body, { signal } = {}) {
  const accessSearchPath = path === '/access-directory/search';
  const accessListPath = /^\/access-directory\?offset=\d+&limit=\d+(?:&status=(?:active|inactive))?(?:&workspace_login_enabled=(?:true|false))?$/.test(path);
  const accessDirectoryPath = accessListPath || accessSearchPath;
  if ((accessSearchPath && body === undefined) || (accessListPath && body !== undefined)) {
    throw new SessionError('Unsupported Staff Access read.');
  }
  const designationReferencePath = /^\/designation-references\?query=[^&]*&offset=\d+$/.test(path);
  const encodedRole = '(?:[A-Za-z0-9_.!~*\\x27()-]|%[0-9A-Fa-f]{2}|\\+){1,1200}';
  const listingPath = new RegExp(`^\\?limit=\\d+&offset=\\d+(?:&status=(?:active|inactive))?(?:&designation_id=[0-9a-f-]{36})?(?:&role=${encodedRole})?$`).test(path);
  const roleChoicesPath = /^\/role-choices\?query=(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-Fa-f]{2}|\+)*&offset=\d+&include_retained=(?:true|false)$/.test(path);
  if (!accessDirectoryPath && !designationReferencePath && !listingPath && !roleChoicesPath && !/^(?:|\/search|\/filter-designations(?:\?cursor=[0-9a-f-]{36})?|\/[0-9a-f-]{36}(?:\/(?:edit|status|access|delete))?)$/.test(path)) {
    throw new SessionError('Unsupported staff operation.');
  }
  const mutation = body !== undefined && path !== '/search' && !accessSearchPath;
  const accessDirectoryRead = accessDirectoryPath && !mutation;
  const invalidAccessResponse = 'Staff Access returned an invalid response. Use Refresh access to retry.';
  const epoch = generation;
  const owner = state.user?.id;
  const check = () => {
    signal?.throwIfAborted();
    if (epoch !== generation || !owner || state.user?.id !== owner || state.status !== 'authenticated' || !token) {
      throw new SessionError('Your session changed. Please sign in again.', 401);
    }
    const action = path.endsWith('/status') ? 'status' : path.endsWith('/delete') ? 'delete'
      : path.endsWith('/edit') ? 'edit' : mutation && path === '' ? 'add' : null;
    if (accessDirectoryPath ? !hasCapability(state.user, 'staff_access', 'view')
      : designationReferencePath ? !(hasCapability(state.user, 'staff', 'add') || hasCapability(state.user, 'staff', 'edit'))
      : path.endsWith('/access') ? !isSuperAdminIdentity(state.user)
      : !(action ? hasCapability(state.user, 'staff', action) : canReadResource(state.user, 'staff'))) {
      throw new SessionError('Staff Management access denied.', 403);
    }
  };
  if (pending) await pending;
  else if (state.status === 'authenticated' && Date.now() >= expiresAt) await verifySession(true);
  check();
  const checkResponse = () => {
    try { check(); }
    catch (error) { error.ambiguous = mutation; throw error; }
  };
  let response;
  try {
    response = await fetch(`/api/v1/admin/staff${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
  } catch {
    if (pending) await pending;
    checkResponse();
    const error = new SessionError(accessDirectoryRead ? 'Unable to load Staff Access. Check your connection and use Refresh access to retry.'
      : !mutation ? 'Unable to load staff. Check your connection and retry.'
      : 'Save outcome could not be confirmed. Refresh the directory before submitting again; the server may have saved it.');
    error.ambiguous = mutation;
    throw error;
  }
  if (pending) await pending;
  checkResponse();
  let data;
  try { data = await response.json(); }
  catch {
    const error = new SessionError(accessDirectoryRead ? invalidAccessResponse
      : 'Staff service returned an invalid response. Refresh the directory before submitting again.');
    error.ambiguous = mutation;
    throw error;
  }
  if (pending) await pending;
  checkResponse();
  if (!response.ok) {
    if (response.status === 403 && state.user?.identity_kind === 'staff') await verifySession(false, 'admin');
    if (response.status === 401) { restorationAllowed = false; clear(); }
    const code = data?.error?.code;
    const error = new SessionError(
      accessDirectoryRead ? (response.status === 401 ? 'Your session expired. Please sign in again.'
        : response.status === 403 ? 'Staff Management access denied.'
        : 'Unable to load Staff Access because the service is unavailable. Use Refresh access to retry.')
        : code === 'staff_stale' ? 'This staff record changed. Your draft is still here. Review current details before retrying.'
        : code === 'staff_role_invalid' ? 'The selected role is no longer available. Your draft is still here. Search current roles and choose again.'
        : code === 'staff_designation_invalid' ? 'The selected designation is no longer active or available. Your draft is still here. Search designations and choose again.'
        : code === 'role_deleted' || code === 'role_not_found' ? 'The selected role no longer exists. Your choices are still here. Reload roles and choose another or remove the assignment.'
        : code === 'staff_protected' ? 'This account cannot be assigned a role or workspace login.'
        : code === 'staff_email_duplicate' ? 'Email ID is already used or reserved by another account. Enter a different email.'
        : code === 'staff_employee_code_duplicate' ? 'Employee Code is already used or reserved by another account, including retained history. Enter a different code.'
        : code === 'staff_employee_code_invalid' ? 'Employee Code has unsupported case normalization. Choose a different code.'
        : code === 'staff_email_invalid' ? 'Email ID has unsupported case normalization. Choose a different email.'
        : code === 'staff_duplicate' ? 'Email ID or Employee Code is already used or reserved. Check both fields.'
        : response.status === 422 ? 'Some staff fields are invalid. Check the details and try again.'
        : response.status === 403 ? 'Staff Management access denied.'
        : response.status === 401 ? 'Your session expired. Please sign in again.'
        : 'Staff service is unavailable. Your draft has not been discarded.', response.status);
    error.code = code;
    error.ambiguous = mutation && response.status >= 500 && code !== 'staff_unavailable';
    throw error;
  }
  if (accessDirectoryRead) {
    const params = new URLSearchParams(path.split('?')[1] || '');
    const limit = accessSearchPath ? (body.limit ?? 100) : Number(params.get('limit'));
    const expectedStatus = accessSearchPath ? body.status : params.get('status');
    const expectedLogin = accessSearchPath ? body.workspace_login_enabled
      : params.has('workspace_login_enabled') ? params.get('workspace_login_enabled') === 'true' : null;
    const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
    const metadataValid = accessSearchPath
      ? data?.limit === limit && data.scan_limit === 500 && validCount(data.scanned)
        && data.scanned <= data.scan_limit && data.items?.length <= data.scanned
        && typeof data.has_more === 'boolean'
        && (data.has_more
          ? data.scanned > 0 && typeof data.next_cursor === 'string'
            && /^[0-9a-f-]{36}$/.test(data.next_cursor) && data.next_cursor !== body.cursor
          : data.next_cursor === null)
      : validCount(data?.total) && validCount(data.filtered) && data.filtered <= data.total
        && data.items?.length === Math.min(limit, Math.max(0, data.filtered - Number(params.get('offset'))));
    if (!metadataValid || !Array.isArray(data?.items) || data.items.length > limit
        || data.items.some((row) => !row || typeof row.id !== 'string' || typeof row.name !== 'string'
          || !(row.employeeCode === null || typeof row.employeeCode === 'string')
          || !['active', 'inactive'].includes(row.status) || typeof row.role !== 'string'
          || typeof row.workspace_login_enabled !== 'boolean'
          || (expectedStatus && row.status !== expectedStatus)
          || (expectedLogin != null && row.workspace_login_enabled !== expectedLogin))) {
      throw new SessionError(invalidAccessResponse);
    }
  }
  return data;
}

export async function roleRequest(path = '', body, { signal } = {}) {
  if (!/^(?:|\/[0-9a-f-]{36}(?:\/(?:edit|delete|permissions))?|\?limit=(?:[1-9]\d?|100)(?:&cursor=[0-9a-f-]{36})?)$/.test(path)
      || (body !== undefined && path !== '' && !/\/(?:edit|delete|permissions)$/.test(path))) {
    throw new SessionError('Unsupported role operation.');
  }
  const mutation = body !== undefined;
  const epoch = generation;
  const owner = state.user?.id;
  const check = () => {
    signal?.throwIfAborted();
    if (epoch !== generation || !owner || state.user?.id !== owner || state.status !== 'authenticated' || !token) {
      throw new SessionError('Your session changed. Please sign in again.', 401);
    }
    const action = path.endsWith('/delete') ? 'delete' : path.endsWith('/edit') ? 'edit' : mutation ? 'add' : null;
    if (path.endsWith('/permissions') ? !isSuperAdminIdentity(state.user)
      : !(action ? hasCapability(state.user, 'role', action)
        : canReadResource(state.user, 'role') || hasCapability(state.user, 'permissions', 'view'))) {
      throw new SessionError('Role Management access denied.', 403);
    }
  };
  if (pending) await pending;
  else if (state.status === 'authenticated' && Date.now() >= expiresAt) await verifySession(true);
  check();
  const guardResponse = () => {
    try { check(); }
    catch (error) { error.ambiguous = mutation; throw error; }
  };
  const uncertain = () => {
    const error = new SessionError(mutation
      ? 'Save outcome could not be confirmed. Refresh roles before submitting again; the server may have saved the change.'
      : 'Unable to load roles. Check your connection and retry.');
    error.ambiguous = mutation;
    return error;
  };
  let response;
  try {
    response = await fetch(`/api/v1/admin/roles${path}`, {
      method: mutation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(mutation ? { 'Content-Type': 'application/json' } : {}) },
      ...(mutation ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
  } catch {
    if (pending) await pending;
    guardResponse();
    throw uncertain();
  }
  if (pending) await pending;
  guardResponse();
  let data;
  try { data = await response.json(); }
  catch { throw uncertain(); }
  if (pending) await pending;
  guardResponse();
  if (!response.ok) {
    if (response.status === 403 && state.user?.identity_kind === 'staff') await verifySession(false, 'admin');
    if (response.status === 401) { restorationAllowed = false; clear(); }
    const code = data?.error?.code;
    const error = new SessionError(
      code === 'role_stale' ? 'This role changed. Your draft is still here. Review current details before retrying.'
        : code === 'role_deleted' ? 'This role was deleted. Your draft is still here. Refresh roles to continue.'
        : code === 'role_assigned' || code === 'role_in_use' ? 'This role is assigned to staff. Remove it from those staff in Staff Management before deleting it.'
        : code === 'role_duplicate' ? 'A role with this name already exists. Choose a different name.'
        : code === 'role_permission_unknown' ? 'One of the selected permissions is not recognised. Reload this role and try again.'
        : response.status === 422 && path.endsWith('/permissions') ? 'The permission selection was rejected. Reload this role and try again.'
        : response.status === 422 ? 'Role fields are invalid. Use a name of 1–100 characters and a description of at most 1,000 characters.'
        : response.status === 403 ? 'Role Management access denied.'
        : response.status === 401 ? 'Your session expired. Please sign in again.'
        : response.status >= 500 && code !== 'roles_unavailable' && mutation ? uncertain().message
        : 'Role service is unavailable. Your draft has not been discarded.', response.status);
    error.code = code;
    error.ambiguous = mutation && response.status >= 500 && code !== 'roles_unavailable';
    throw error;
  }
  return data;
}

// Exact portal-host settings, Super Admin only. Never replay an uncertain write.
export async function roleUrlRequest(path = '', body, { signal } = {}) {
  if (!/^(?:|\/primary|\/domain-action|\/[0-9a-f-]{36}\/(?:edit|delete))$/i.test(path)
      || (path && body === undefined)) throw new SessionError('Unsupported Role URL operation.');
  const mutation = body !== undefined;
  const epoch = generation;
  const owner = state.user?.id;
  const check = () => {
    signal?.throwIfAborted();
    if (epoch !== generation || !owner || state.user?.id !== owner || state.status !== 'authenticated' || !token) {
      throw new SessionError('Your session changed. Sign in again before retrying.', 401);
    }
    if (state.user.identity_kind !== 'super_admin') throw new SessionError('Role URLs are restricted to Super Admin.', 403);
  };
  if (pending) await pending;
  else if (state.status === 'authenticated' && Date.now() >= expiresAt) await verifySession(true, 'admin');
  check();
  const uncertain = () => {
    const error = new SessionError(mutation
      ? 'Save outcome could not be confirmed. Reload mappings and review before retrying; the server may have saved the change.'
      : 'Unable to load Role URLs. Check your connection and retry.');
    error.ambiguous = mutation;
    return error;
  };
  let response, data;
  try {
    response = await fetch(`/api/v1/admin/role-urls${path}`, {
      method: mutation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(mutation ? { 'Content-Type': 'application/json' } : {}) },
      ...(mutation ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    data = await response.json();
  } catch { throw uncertain(); }
  if (pending) await pending;
  try { check(); } catch (error) { error.ambiguous = mutation; throw error; }
  if (!response.ok) {
    if (response.status === 401) {
      await verifySession(true, 'admin');
      throw new SessionError('Session checked. Your draft is preserved; retry explicitly.', 401);
    }
    const domainMessage = ['/primary', '/domain-action'].includes(path) &&
      [409, 429].includes(response.status) && typeof data?.error?.message === 'string'
      ? data.error.message.slice(0, 300) : '';
    const error = new SessionError(domainMessage || (response.status === 409
      ? 'Hostname already exists, changed or was removed. Your draft is preserved. Reload mappings and review before retrying.'
      : response.status === 422 ? 'Use a bare production hostname or HTTPS origin, without credentials, ports, paths, queries, fragments or wildcards.'
      : response.status === 403 ? 'Role URLs are restricted to Super Admin.'
      : response.status === 429 ? 'Too many DNS actions. Wait before retrying.'
      : uncertain().message), response.status);
    error.code = response.status === 409 ? 'role_url_stale' : data?.error?.code;
    error.ambiguous = mutation && response.status >= 500;
    throw error;
  }
  const isDomain = path === '/primary' || path === '/domain-action';
  const domainShape = (d) => d && typeof d.hostname === 'string' &&
    ['primary', 'role'].includes(d.kind) && Number.isInteger(d.version) && d.version >= 1 &&
    typeof d.active === 'boolean' && ['unverified', 'pending', 'verified', 'failed', 'expired', 'unavailable', 'revoked'].includes(d.status);
  if (mutation ? (isDomain ? !domainShape(data) : (!data?.id || !Number.isInteger(data.version)))
    : (!Array.isArray(data?.items) || !Array.isArray(data?.domains) ||
      !data.domains.every(domainShape) || !Array.isArray(data?.bootstrap_hosts) ||
      !data.bootstrap_hosts.every((host) => typeof host === 'string'))) throw uncertain();
  return data;
}
// Write-only Communication credentials are sent once, never logged or replayed.
export async function communicationRequest(path = '', body, { signal } = {}) {
  if (!/^(?:|\/[0-9a-f-]{36}(?:\/(?:edit|delete|default))?)$/i.test(path)
      || (body !== undefined && path && !/\/(?:edit|delete|default)$/.test(path))) {
    throw new SessionError('Unsupported Communication operation.');
  }
  const mutation = body !== undefined;
  const epoch = generation;
  const owner = state.user?.id;
  const check = () => {
    signal?.throwIfAborted();
    if (epoch !== generation || !owner || state.user?.id !== owner || state.status !== 'authenticated' || !token) {
      throw new SessionError('Your session changed. Sign in again before retrying.', 401);
    }
    if (state.user.identity_kind !== 'super_admin') throw new SessionError('Communication is restricted to Super Admin.', 403);
  };
  if (pending) await pending;
  else if (state.status === 'authenticated' && Date.now() >= expiresAt) await verifySession(true, 'admin');
  check();
  const uncertain = () => {
    const error = new SessionError(mutation
      ? 'Save outcome could not be confirmed. Load latest settings and review before retrying; the change may already be saved.'
      : 'Unable to load Communication. Check your connection and retry.');
    error.ambiguous = mutation;
    return error;
  };
  let response, data;
  try {
    response = await fetch(`/api/v1/admin/communication${path}`, {
      method: mutation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(mutation ? { 'Content-Type': 'application/json' } : {}) },
      ...(mutation ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    data = await response.json();
  } catch { throw uncertain(); }
  if (pending) await pending;
  try { check(); } catch (error) { error.ambiguous = mutation; throw error; }
  if (!response.ok) {
    const code = data?.error?.code;
    const messages = {
      communication_stale: 'Communication changed. Your draft is kept. Load latest settings and review before retrying.',
      communication_duplicate: 'Use a unique configuration name within this channel.',
      communication_credential_required: 'Enter the credential for this configuration type.',
      communication_replacement: 'Choose a same-channel replacement default.',
      communication_unavailable: 'Encrypted Communication storage is unavailable. Ask the operator to check keys and migration readiness.',
    };
    const error = new SessionError(messages[code] || (response.status === 422
      ? 'Configuration fields are invalid. Check required values, field lengths, HTTPS endpoint and credential.'
      : response.status === 403 ? 'Communication is restricted to Super Admin.'
      : response.status === 401 ? 'Your session expired. Sign in again; your draft is kept.'
      : uncertain().message), response.status);
    error.code = code;
    error.ambiguous = mutation && response.status >= 500;
    throw error;
  }
  return data;
}

// Separate endpoint boundary; no browser-local fallback and no mutation replay.
export async function emailTemplateRequest(path = '', body, { signal } = {}) {
  if (!/^(?:|\/events|\/[0-9a-f-]{36}(?:\/(?:edit|delete|test|modern-layout))?)$/i.test(path)
      || (body !== undefined && path && !/\/(?:edit|delete|test)$/.test(path))
      || (body === undefined && /\/(?:edit|delete|test)$/.test(path))) throw new SessionError('Unsupported email template operation.');
  const mutation = body !== undefined;
  const testSend = /\/test$/.test(path);
  const epoch = generation, owner = state.user?.id;
  const check = () => {
    signal?.throwIfAborted();
    if (epoch !== generation || !owner || state.user?.id !== owner || state.status !== 'authenticated' || !token)
      throw new SessionError('Your session changed. Sign in again before retrying; your draft is kept.', 401);
    if (state.user.identity_kind !== 'super_admin') throw new SessionError('Email templates are restricted to Super Admin.', 403);
  };
  if (pending) await pending;
  else if (state.status === 'authenticated' && Date.now() >= expiresAt) await verifySession(true, 'admin');
  check();
  const uncertain = () => {
    const error = new SessionError(mutation
      ? testSend ? 'Test submission outcome is uncertain. Check Email Logs; do not automatically resend.'
        : 'Save outcome could not be confirmed. Load latest to reconcile before retrying; your draft is kept.'
      : 'Unable to load email templates. Check your connection and retry.');
    error.ambiguous = mutation;
    return error;
  };
  let response, data;
  try {
    response = await fetch(`/api/v1/admin/email-templates${path}`, {
      method: mutation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(mutation ? { 'Content-Type': 'application/json' } : {}) },
      ...(mutation ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    data = await response.json();
  } catch (cause) {
    const error = uncertain();
    // Fixed categories only: never display exception messages, URLs, response
    // bodies or credentials. A JSON parse failure is not a connection failure.
    let detail;
    if (cause?.name === 'TimeoutError') {
      error.code = 'ET_TIMEOUT';
      detail = 'The request timed out after 15 seconds.';
    } else if (cause?.name === 'AbortError') {
      error.code = 'ET_CANCELLED';
      detail = 'The request was cancelled.';
    } else if (response) {
      const html = response.headers?.get?.('Content-Type')?.toLowerCase().includes('text/html');
      error.code = html ? 'ET_HTML_RESPONSE' : 'ET_INVALID_JSON';
      detail = `The server returned HTTP ${response.status} ${html ? 'HTML instead of JSON' : 'without readable JSON'}.`;
    } else {
      error.code = 'ET_NETWORK';
      detail = 'The browser could not complete the connection to the template API.';
    }
    error.message += ` ${detail} [${error.code}]`;
    throw error;
  }
  if (pending) await pending;
  try { check(); } catch (error) { error.ambiguous = mutation; throw error; }
  if (!response.ok) {
    if (response.status === 401) {
      await verifySession(true, 'admin');
      throw new SessionError('Session checked. Your draft is preserved; retry explicitly.', 401);
    }
    const error = new SessionError(testSend && response.status === 422
      ? 'Enter one valid To email address only, without a display name, spaces or additional recipients.'
      : testSend && response.status === 409 ? 'Saved template version changed. Close this dialog and load latest before a new test.'
      : testSend && response.status === 429 ? 'Test-email limit reached. Retry after 15 minutes.'
      : response.status === 409
      ? 'Template changed, or its name/event is already in use. Load latest and review; your draft is kept.'
      : response.status === 422 ? 'Template rejected. Check variables, required recovery link/expiry, safe HTML and field lengths.'
      : response.status === 403 ? 'Email templates are restricted to Super Admin.'
      : response.status === 404 ? (
        /^\/[0-9a-f-]{36}(?:\/(?:edit|delete))?$/i.test(path) && data?.error?.code === 'email_template_not_found'
          ? 'Template no longer exists. Load latest; your draft is kept.'
          : 'Email template API is unavailable for this operation. Ask the operator to verify the running release and schema; your draft is kept.')
      : response.status >= 500 ? 'Email template storage is unavailable. Ask the operator to check migration readiness; load latest before retrying.'
      : uncertain().message, response.status);
    error.code = response.status === 409 ? 'conflict' : data?.error?.code;
    error.ambiguous = mutation && response.status >= 500;
    throw error;
  }
  return data;
}

// Narrow reporting facility: credentials never leave this module.
// Shared master transport. No automatic replay of a potentially committed write.
// Per-operation Zone authorization. Staff never reach other master services;
// trash and restore stay Super Admin only. The server re-checks every call.
function masterAllowed(user, resource, path, writing, params = {}) {
  if (user.identity_kind === 'mr') return resource === 'doctors' && (
    path === '' || (!writing && (['/references', '/filters', '/sample', '/export'].includes(path)
      || /^\/[0-9a-f-]{36}(?:\/orders)?$/.test(path) || (/^\/postal\/[1-9][0-9]{5}$/.test(path) && (params.action || 'add') === 'add')))
    || (writing && ['/import/review', '/import/commit'].includes(path)));
  if (user.permissions.includes('admin.access')) return true;
  const master = MASTER_CATALOGUE.find((item) => item.path === resource);
  if (user.identity_kind !== 'staff' || !master) return false;
  if (/^\/trash$|\/(?:restore|reset)$/.test(path)) return false;
  const need = path === '' ? (writing ? 'add' : null)
    : /^\/[0-9a-f-]{36}$/.test(path) ? null
    : /\/(?:edit|status|contact)$/.test(path) || path === '/bulk' ? 'edit'
    : /\/delete$/.test(path) ? 'delete'
    : path === '/export' ? 'export'
    : path === '/sample' || /^\/import\//.test(path) ? 'import'
    : path === '/username' ? 'add'
    : /^\/account\//.test(path) ? 'add'
    : /^\/[0-9a-f-]{36}\/doctors$/.test(path) && resource === 'mrs' ? null
    : /^\/postal\//.test(path) ? (params.action || 'add')
    : path === '/language-choices' && resource === 'patients' && !writing ? null
    : ['/references', '/filters', '/choices'].includes(path) || /^\/references\/(?:categories|locations)$/.test(path) ? null : undefined;
  if (need === undefined) return false;
  return need ? hasMasterPermission(user, master.key, need) : canViewMaster(user, master.key);
}

function attachMasterValidation(error, data, label) {
  const fields = (Array.isArray(data?.error?.fields) ? data.error.fields : [])
    .filter((item) => /^body(?:\.[A-Za-z_][A-Za-z_0-9]*(?:\.\d+\.[A-Za-z_][A-Za-z_0-9]*)?)?$/.test(item.field));
  if (!fields.length) return;
  error.fields = Object.fromEntries(fields.filter((item) => item.field !== 'body')
    .map((item) => [item.field.slice(5), item.message || 'Check this field.']));
  error.message = [...new Set(fields.map((item) => `${item.field === 'body' ? label : item.field.slice(5)}: ${item.message || 'Check this field.'}`))].join(' ');
}

async function masterRequest(resource, path = '', { body, file, params = {}, download = false, signal } = {}) {
  const exportDisplay = download && path === '/export' ? exportPreferenceHeader(captureExportPreferences()) : null;
  const zone = resource === 'zones';
  if (!['languages', 'allergens', 'vendors', 'opening-balances', 'zones', 'courier-partners', 'storage-locations', 'designations', 'headquarters', 'mrs', 'doctors', 'patients', 'product-categories', 'sales-targets'].includes(resource)) throw new SessionError('Unsupported master resource.');
  const label = resource === 'languages' ? 'Language' : resource === 'opening-balances' ? 'Opening balance' : resource === 'sales-targets' ? 'Sales target' : resource === 'allergens' ? 'Allergen' : resource === 'vendors' ? 'Vendor' : resource === 'patients' ? 'Patient' : resource === 'doctors' ? 'Doctor' : resource === 'mrs' ? 'MR' : resource === 'product-categories' ? 'Product category' : zone ? 'Zone' : resource === 'headquarters' ? 'Headquarter' : resource === 'designations' ? 'Designation' : resource === 'storage-locations' ? 'Storage location' : 'Courier partner';
  const unavailable = resource === 'languages' ? 'language_unavailable' : resource === 'opening-balances' ? 'opening_balance_unavailable' : resource === 'sales-targets' ? 'sales_target_unavailable' : resource === 'allergens' ? 'allergen_unavailable' : resource === 'vendors' ? 'vendor_unavailable' : resource === 'patients' ? 'patient_unavailable' : resource === 'doctors' ? 'doctor_unavailable' : resource === 'mrs' ? 'mr_unavailable' : resource === 'product-categories' ? 'product_category_unavailable' : zone ? 'zone_unavailable' : resource === 'headquarters' ? 'headquarter_unavailable' : resource === 'designations' ? 'designation_unavailable' : resource === 'storage-locations' ? 'location_unavailable' : 'courier_unavailable';
  const mrRoute = /^(?:|\/references|\/username|\/account\/[a-z][a-z0-9._-]{2,31}|\/postal\/[1-9][0-9]{5}|\/sample|\/export|\/import\/(?:review|commit)|\/[0-9a-f-]{36}(?:\/(?:edit|status|contact|delete|reset|doctors))?)$/;
  const route = resource === 'languages' ? /^(?:|\/sample|\/export|\/import\/(?:review|commit)|\/[0-9a-f-]{36}(?:\/(?:edit|delete|history))?)$/ : resource === 'sales-targets' ? /^(?:|\/choices|\/sample|\/export|\/import\/(?:review|commit)|\/[0-9a-f-]{36}(?:\/(?:edit|status|delete))?)$/ : resource === 'allergens' ? /^(?:|\/references\/(?:categories|locations)|\/sample|\/export|\/import\/(?:review|commit)|\/[0-9a-f-]{36}(?:\/(?:edit|status|delete))?)$/ : resource === 'patients' ? /^(?:|\/references|\/filters|\/postal\/[1-9][0-9]{5}|\/sample|\/export|\/import\/(?:review|commit)|\/[0-9a-f-]{36}(?:\/(?:edit|status|delete))?)$/ : resource === 'doctors' ? /^(?:|\/references|\/filters|\/bulk|\/postal\/[1-9][0-9]{5}|\/sample|\/export|\/import\/(?:review|commit)|\/[0-9a-f-]{36}(?:\/(?:edit|status|contact|delete))?)$/ : resource === 'mrs' ? mrRoute : zone
    ? /^(?:|\/trash|\/export|\/import\/(?:review|commit)|\/[0-9a-f-]{36}(?:\/(?:edit|status|delete|restore))?)$/
    : /^(?:|\/export|\/import\/(?:review|commit)|\/[0-9a-f-]{36}(?:\/(?:edit|status|delete))?)$/;
  if (!route.test(path) && !(resource === 'patients' && path === '/language-choices' && body === undefined && file === undefined)
      && !(resource === 'doctors' && /^\/[0-9a-f-]{36}\/orders$/.test(path) && body === undefined && file === undefined && !download)
      && !(resource === 'headquarters' && path === '/zone-choices' && body === undefined && file === undefined)
      && !(resource === 'storage-locations' && /^\/postal\/[1-9][0-9]{5}$/.test(path))
      && !(['vendors', 'designations', 'headquarters', 'product-categories', 'opening-balances'].includes(resource) && path === '/sample') && !(resource === 'opening-balances' && path === '/references')) {
    throw new SessionError(`Unsupported ${label} operation.`);
  }
  if (path.startsWith('/postal/') && (body !== undefined || file !== undefined || download
      || Object.keys(params).some((key) => key !== 'action') || !['add', 'edit'].includes(params.action || 'add'))) {
    throw new SessionError(`Unsupported ${label} operation.`);
  }
  const epoch = generation;
  const readScope = contactReadScope();
  const owner = state.user?.id;
  let languageCommitDispatched = false;
  let languageCommitRejected = false;
  const check = () => {
    signal?.throwIfAborted();
    if (epoch !== generation || !owner || state.user?.id !== owner || readScope !== contactReadScope() || state.status !== 'authenticated' || !token) {
      const error = new SessionError('Your session changed. Sign in again before retrying.', 401);
      error.ambiguous = languageCommitDispatched && !languageCommitRejected;
      throw error;
    }
    if (!masterAllowed(state.user, resource, path, body !== undefined || file !== undefined, params)) {
      const error = new SessionError(`${label} access denied.`, 403);
      error.ambiguous = languageCommitDispatched && !languageCommitRejected;
      throw error;
    }
  };
  if (pending) await pending;
  else if (state.status === 'authenticated' && Date.now() >= expiresAt) await verifySession(true);
  check();
  const downloadKey = `${resource}/${path}/${params.format || 'csv'}`;
  const initiation = download ? (serverInitiations.get(downloadKey) || crypto.randomUUID()) : null;
  if (download) serverInitiations.set(downloadKey, initiation);
  const downloadGuard = reportingIdentityGuard();
  const writing = body !== undefined || file !== undefined;
  const budget = resource === 'mrs' && path === '/import/commit' ? 150000 : 30000;
  const load = () => fetch(`/api/v1/admin/${resource}${path}?${new URLSearchParams(params)}`, {
    method: writing ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(download ? { 'X-Download-Initiation': initiation } : {}), ...(exportDisplay ? { 'X-Evexia-Export-Display': exportDisplay } : {}), ...(writing ? { 'Content-Type': file ? 'application/octet-stream' : 'application/json' } : {}) },
    ...(writing ? { body: file || JSON.stringify(body) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(budget)]) : AbortSignal.timeout(budget),
  });
  let response;
  try {
    languageCommitDispatched = resource === 'languages' && path === '/import/commit';
    response = await load();
    languageCommitRejected = response.status >= 400 && response.status < 500;
    if (response.status === 401) {
      // A rejected request cannot have mutated data. Renew, but ask the user
      // to explicitly retry writes; reads can safely be repeated once.
      await verifySession(true);
      check();
      if (writing) throw new SessionError('Session renewed. Your draft is preserved; retry explicitly.', 401);
      response = await load();
    }
  } catch (error) {
    check();
    if (error instanceof SessionError) throw error;
    const failure = new SessionError(writing
      ? 'Save outcome could not be confirmed. Refresh and inspect records before retrying; the server may have saved it.'
      : `Unable to load ${resource}. Check your connection and retry.`);
    failure.ambiguous = writing && path !== '/import/review';
    throw failure;
  }
  if (pending) await pending;
  check();
  let data;
  try { data = response.ok && download ? await response.blob() : await response.json(); }
  catch {
    check();
    const error = new SessionError(`${label} response could not be read. Refresh and inspect current records before retrying.`);
    error.ambiguous = writing && path !== '/import/review';
    throw error;
  }
  if (pending) await pending;
  check();
  if (!response.ok) {
    if (response.status === 403 && state.user?.identity_kind === 'staff') await verifySession(false, 'admin');
    const error = new SessionError(response.status >= 500 && data?.error?.code !== unavailable
      ? `${label} service is unavailable. Your draft is preserved. Retry later; inspect records first if a save was pending.`
      : data?.error?.message || `${label} request failed. Review the details and retry.`, response.status);
    error.code = data?.error?.code;
    if (resource === 'headquarters' && response.status === 422 && data?.error?.fields?.length) {
      error.fields = Object.fromEntries(data.error.fields
        .filter((item) => /^body\.(?:name|state_code|status|zone_id|areas(?:\.\d+\.(?:name|code|id))?)$/.test(item.field))
        .map((item) => [item.field.replace(/^body\./, ''), item.message || 'Check this field.']));
      error.message = 'Headquarter validation failed. Check the marked fields; nothing was saved.';
    }
    if (resource === 'vendors' && response.status === 422 && data?.error?.fields?.length) {
      error.fields = Object.fromEntries(data.error.fields.filter((item) => /^body\.[A-Za-z]+$/.test(item.field))
        .map((item) => [item.field.replace(/^body\./, ''), 'Check this required field, format and length.']));
      error.message = 'Vendor validation failed. Check the marked fields. Your draft is preserved.';
    }
    if (resource === 'sales-targets' && response.status === 422 && data?.error?.fields?.length) {
      error.fields = Object.fromEntries(data.error.fields.filter((item) => /^body\.[A-Za-z0-9]+$/.test(item.field)).map((item) => [item.field.replace(/^body\./, ''), item.message || 'Check this value.']));
      error.message = data?.error?.message || 'Sales target validation failed. Check the marked fields. Your draft is preserved.';
    }
    if (['doctors', 'patients'].includes(resource) && response.status === 422 && data?.error?.fields?.length) {
      const fields = [...new Set(data.error.fields.map((item) => item.field.replace(/^body\./, '')))];
      error.message = `${label} validation failed: ${fields.join(', ')}. Check required fields, formats and the documented limits. Nothing was saved.`;
    }
    if (response.status === 422 && data?.error?.fields?.length && [
      'zones', 'languages', 'courier-partners', 'designations', 'mrs', 'doctors', 'patients',
      'vendors', 'product-categories', 'storage-locations', 'headquarters', 'products',
      'allergens', 'sales-targets', 'opening-balances', 'opening-stock',
    ].includes(resource)) {
      attachMasterValidation(error, data, label);
    }
    // A Language commit can have an uncertain outcome even when its safe
    // database error was mapped to "unavailable". Never encourage create replay.
    error.ambiguous = writing && path !== '/import/review' && response.status >= 500 && (['languages', 'headquarters'].includes(resource) || error.code !== unavailable);
    // The server may have revoked one action without ending the staff session.
    // Refresh the authoritative matrix; never replay the denied operation.
    if (response.status === 403 && zone && state.user?.identity_kind === 'staff') await verifySession();
    throw error;
  }
  if (download) {
    if (!/^[0-9a-f-]{36}$/i.test(response.headers.get('X-Download-Log') || '')) {
      throw new SessionError('Download logging could not be confirmed. No file was released. Retry.');
    }
    serverDownloads.set(data, downloadGuard);
    serverInitiations.delete(downloadKey);
  }
  return data;
}
export function serverDownloadGuard(blob) {
  const guard = serverDownloads.get(blob);
  if (!guard) throw new SessionError('Server download acceptance is missing. No file was released.');
  guard();
  serverDownloads.delete(blob);
  return guard;
}
export const languageRequest = (path, options) => masterRequest('languages', path, options);
export const zoneRequest = (path, options) => masterRequest('zones', path, options);
export const courierRequest = (path, options) => masterRequest('courier-partners', path, options);
export const locationRequest = (path, options) => masterRequest('storage-locations', path, options);
export const designationRequest = (path, options) => masterRequest('designations', path, options);
export const salesTargetRequest = (path, options) => masterRequest('sales-targets', path, options);
export const vendorRequest = (path, options) => masterRequest('vendors', path, options);
export const allergenRequest = (path, options) => masterRequest('allergens', path, options);
export const mrRequest = (path, options) => masterRequest('mrs', path, options);
export const doctorRequest = (path, options) => masterRequest('doctors', path, options);
export const patientRequest = (path, options) => masterRequest('patients', path, options);
export const headquarterRequest = (path, options) => masterRequest('headquarters', path, options);
export const productCategoryRequest = (path, options) => masterRequest('product-categories', path, options);
export const openingBalanceRequest = (path, options) => masterRequest('opening-balances', path, options);

export const purchaseReceivedRequest = (path, options) => purchaseOrderRequest(path, options, 'purchase-received');
export const inventoryRequest = (path, options) => purchaseOrderRequest(path, options, 'inventory');


/** Opening Stock transport: JSON, multipart review and logged blob downloads. */
export async function openingStockRequest(path = '', { body, params = {}, signal, method, file, download } = {}) {
  const exportDisplay = download && path === '/export' ? exportPreferenceHeader(captureExportPreferences()) : null;
  const uid = '[0-9a-f-]{36}';
  const ok = new RegExp(`^(?:|/references/items|/preview|/sample|/export|/import/review|/requests/${uid}|/${uid}(?:/(?:activity|analytics))?)$`, 'i');
  if (!ok.test(path)) throw new SessionError('Unsupported opening stock operation.');
  const writing = body !== undefined || file !== undefined;
  const mutation = writing && path !== '/preview' && path !== '/import/review';
  const epoch = generation; const owner = state.user?.id;
  const check = () => {
    signal?.throwIfAborted();
    if (epoch !== generation || !owner || state.user?.id !== owner || state.status !== 'authenticated' || !token) {
      const e = new SessionError('Your session changed. Your draft is preserved; sign in again before retrying.', 401); e.ambiguous = mutation; throw e;
    }
    if (!workflowAllowed(state.user, 'opening-stock', path, { body, params, method, file })) throw new SessionError('Opening Stock access denied.', 403);
  };
  if (pending) await pending;
  else if (state.status === 'authenticated' && Date.now() >= expiresAt) await verifySession(true, 'admin');
  check();
  const downloadKey = `opening-stock/${path}/${params.format || 'csv'}/${params.query || ''}`;
  const initiation = download ? (serverInitiations.get(downloadKey) || crypto.randomUUID()) : null;
  if (download) serverInitiations.set(downloadKey, initiation);
  const downloadGuard = reportingIdentityGuard();
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) search.set(k, String(v)); });
  let form;
  if (file !== undefined) { form = new FormData(); form.append('file', file); }
  let response, data;
  try {
    response = await fetch(`/api/v1/admin/opening-stock${path}${search.size ? `?${search}` : ''}`, {
      method: writing ? 'POST' : (method || 'GET'), credentials: 'same-origin', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(download ? { 'X-Download-Initiation': initiation } : {}), ...(exportDisplay ? { 'X-Evexia-Export-Display': exportDisplay } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(form ? { body: form } : body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    });
    data = response.ok && download ? await response.blob() : await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    const e = new SessionError(mutation ? 'Save outcome is unconfirmed. Your draft is preserved; check the outcome before saving again.' : 'Opening stock could not be loaded. Check your connection and retry.');
    e.ambiguous = mutation; throw e;
  }
  if (pending) await pending;
  try { check(); } catch (e) { e.ambiguous = mutation; throw e; }
  if (!response.ok) {
    if (response.status === 403 && state.user?.identity_kind === 'staff') await verifySession(false, 'admin');
    if (response.status === 401) { await verifySession(true, 'admin'); const e = new SessionError('Session checked. Your draft is preserved; retry explicitly.', 401); e.ambiguous = mutation; throw e; }
    const e = new SessionError(response.status === 403 ? 'Your current saved role does not allow this opening stock operation.'
      : response.status >= 500 ? 'Opening stock service is unavailable. Your draft is preserved; check the outcome before saving again.'
      : typeof data?.error?.message === 'string' ? data.error.message : 'Opening stock fields are invalid. Check quantities, rates and references.', response.status);
    e.code = data?.error?.code;
    if (response.status === 422) attachMasterValidation(e, data, 'Opening stock');
    e.ambiguous = mutation && response.status >= 500; throw e;
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (mutation) {
    const expected = new Set((body?.rows || []).map((r) => `${r.sourceId}:${r.rowId}`));
    const returned = new Set((data?.records || []).map((r) => `${r.sourceId}:${r.rowId}`));
    if (!Array.isArray(data?.records) || !Number.isSafeInteger(data.postedCount) || data.postedCount < 0
        || !Number.isSafeInteger(data.alreadyImportedCount) || data.alreadyImportedCount < 0
        || data.postedCount + data.alreadyImportedCount !== data.records.length
        || returned.size !== data.records.length
        || data.records.some((r) => !uuidPattern.test(r.id) || !uuidPattern.test(r.lotId)
          || !expected.has(`${r.sourceId}:${r.rowId}`) || r.source !== 'opening'
          || !/^\d+\.\d{3}$/.test(r.quantity) || !/^\d+\.\d{2}$/.test(r.unitRate))) {
      const e = new SessionError('The server save response is incomplete. Keep this draft and check the save outcome before another save.');
      e.ambiguous = true; throw e;
    }
  }
  if (download) {
    if (!/^[0-9a-f-]{36}$/i.test(response.headers.get('X-Download-Log') || '')) throw new SessionError('Download logging could not be confirmed. No file was released. Retry.');
    serverDownloads.set(data, downloadGuard); serverInitiations.delete(downloadKey);
  }
  return data;
}
export const productMasterRequest = (path, options) => purchaseOrderRequest(path, options, 'products');
export async function purchaseOrderRequest(path = '', { body, params = {}, signal, method, file, download } = {}, resource = 'purchase-orders') {
  const allowed = resource === 'spt-orders'
    ? /^(?:|\/(?:export|patients|import\/(?:review|commit))|\/references\/(?:patients|doctors|mrs)|\/[0-9a-f-]{36}(?:\/edit)?)$/i
    : resource === 'lupin-orders'
    ? /^(?:|\/(?:export|policy|import\/(?:review|commit))|\/references\/(?:patients|doctors|mrs)|\/attachments\/[0-9a-f-]{36}\/cancel|\/[0-9a-f-]{36})$/i
    : resource === 'immunotherapy-orders'
    ? /^(?:|\/(?:export|policy|patient-registration|patient-languages|import\/(?:review|commit))|\/references\/(?:patients|doctors|mrs|allergens)|\/[0-9a-f-]{36}(?:\/(?:edit|approve|reject|resubmit))?)$/i
    : resource === 'kits-orders'
    ? /^(?:|\/(?:export|policy|patient-registration|patient-languages|import\/(?:review|commit))|\/references\/(?:patients|doctors|mrs|allergens)|\/[0-9a-f-]{36}(?:\/edit)?)$/i
    : resource === 'products'
    ? /^(?:|\/sample|\/export|\/import\/(?:review|commit)|\/references|\/filter-references\/(?:categories|allergens)|\/assemblies(?:\/preview|\/[0-9a-f-]{36})?|\/requests\/[0-9a-f-]{36}|\/[0-9a-f-]{36}(?:\/(?:status|activity|analytics|assemblies))?)$/i
    : resource === 'inventory'
    ? /^\/(?:stock(?:\/[0-9a-f-]{36}\/(?:history|ledger|adjustment-choices))?|adjustments(?:\/preview|\/[0-9a-f-]{36})?|adjustment-requests\/[0-9a-f-]{36}|initialization|references\/(?:locations|staff|lots)|requests\/[0-9a-f-]{36}|movements(?:\/preview|\/[0-9a-f-]{36}(?:\/(?:activity|analytics))?)?)$/i
    : resource === 'purchase-received'
    ? /^(?:|\/(?:export|activity|analytics|preview|filter-options|batch-settings|batch-allocations)|\/references\/(?:staff|orders)|\/(?:sources|requests)\/[0-9a-f-]{36}|\/[0-9a-f-]{36}(?:\/(?:preview|edit|delete|documents|history))?)$/i
    : /^(?:|\/(?:export|overview|activity|analytics|preview)|\/(?:references|filter-options)\/(?:vendors|locations|products)|\/[0-9a-f-]{36}(?:\/(?:preview|edit|delete|documents|history))?)$/i;
  const immunotherapyDecision = resource === 'immunotherapy-orders'
    && /^\/[0-9a-f-]{36}\/(?:approve|reject|resubmit)$/i.test(path);
  if (!allowed.test(path) || (immunotherapyDecision && body === undefined)) {
    throw new SessionError('Unsupported purchase order operation.');
  }
  if ((file !== undefined && (resource !== 'products' || !['/import/review', '/import/commit'].includes(path)))
      || (download && (resource !== 'products' || !['/sample', '/export'].includes(path)))) {
    throw new SessionError('Unsupported product transfer operation.');
  }
  const uid = '[0-9a-f-]{36}';
  const methodRoutes = { PUT: new RegExp(`^/${uid}$`, 'i'), PATCH: new RegExp(`^/${uid}/status$`, 'i'), DELETE: new RegExp(`^/${uid}$`, 'i') };
  if (method !== undefined && (resource !== 'products' || !methodRoutes[method]?.test(path) || body === undefined)) {
    throw new SessionError('Unsupported purchase order operation.');
  }
  const writing = body !== undefined || file !== undefined;
  if (writing && ['purchase-orders', 'purchase-received'].includes(resource) && /\/(?:documents|history)$/.test(path)) {
    throw new SessionError('Saved documents and history are read-only.');
  }
  const httpMethod = method || (writing ? 'POST' : 'GET');
  const epoch = generation;
  const readScope = contactReadScope();
  const owner = state.user?.id;
  const mutation = writing && !path.endsWith('/preview') && path !== '/import/review';
  const batchOperation = resource === 'purchase-received' && ['/batch-settings', '/batch-allocations'].includes(path);
  const mrOrder = ['immunotherapy-orders', 'kits-orders', 'spt-orders', 'lupin-orders'].includes(resource) && state.user?.identity_kind === 'mr';
  const check = () => {
    signal?.throwIfAborted();
    if (epoch !== generation || !owner || state.user?.id !== owner || readScope !== contactReadScope() || state.status !== 'authenticated' || !token) {
      throw new SessionError('Your session changed. Your draft is preserved; sign in again before retrying.', 401);
    }
    if (!mrOrder && !workflowAllowed(state.user, resource, path, { body, params, method, file })) {
      throw new SessionError('Workspace operation access denied.', 403);
    }
  };
  if (pending) await pending;
  else if (state.status === 'authenticated' && Date.now() >= expiresAt) await verifySession(true, mrOrder ? 'mr' : 'admin');
  check();
  const downloadKey = `products/${path}/${new URLSearchParams(params)}`;
  const initiation = download ? (serverInitiations.get(downloadKey) || crypto.randomUUID()) : null;
  if (download) serverInitiations.set(downloadKey, initiation);
  const downloadGuard = download ? reportingIdentityGuard() : null;
  const form = file === undefined ? null : new FormData();
  if (form) form.append('file', file);
  const uncertain = () => {
    const error = new SessionError(batchOperation
      ? 'Batch settings or allocation could not be confirmed. Your draft is preserved. Retry the same allocation, or load saved settings before saving again.'
      : mutation
      ? 'Save outcome is unconfirmed. Retry the same reviewed order to check or finish this save safely.'
      : 'Unable to load purchase orders. Check your connection and retry.');
    error.ambiguous = mutation;
    return error;
  };
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (resource === 'products' && key === 'allergen_ids' && Array.isArray(value)) {
      value.forEach((id) => search.append(key, String(id)));
    } else if (value !== '' && value != null) search.set(key, String(value));
  });
  let response, data;
  try {
    response = await fetch(`/api/v1/admin/${resource}${path}${search.size ? `?${search}` : ''}`, {
      method: httpMethod, credentials: 'same-origin', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(download ? { 'X-Download-Initiation': initiation } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(form ? { body: form } : body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(file ? 60000 : 20000)]) : AbortSignal.timeout(file ? 60000 : 20000),
    });
    data = response.ok && download ? await response.blob() : await response.json();
  } catch (error) { if (signal?.aborted) throw error; throw uncertain(); }
  if (pending) await pending;
  try { check(); } catch (error) { error.ambiguous = mutation; throw error; }
  if (!response.ok) {
    if (response.status === 403 && state.user?.identity_kind === 'staff') await verifySession(false, 'admin');
    if (response.status === 401) {
      await verifySession(true, mrOrder ? 'mr' : 'admin');
      const error = new SessionError('Session checked. Your draft is preserved; retry explicitly.', 401);
      error.ambiguous = mutation;
      throw error;
    }
    const error = new SessionError(response.status === 403 ? (mrOrder ? 'MR order access denied. Your draft is preserved.' : 'Purchase orders are restricted to the protected Super Admin.')
      : response.status >= 500 && !(batchOperation && typeof data?.error?.message === 'string') ? uncertain().message
      : typeof data?.error?.message === 'string' ? data.error.message
      : 'Purchase order fields are invalid. Check dates, quantities and current references.', response.status);
    error.code = data?.error?.code;
    if (resource === 'immunotherapy-orders') {
      error.terminal = response.status >= 400 && response.status < 500
        && response.headers.get('X-Immunotherapy-Outcome') === 'rejected';
    }
    error.ambiguous = mutation && response.status >= 500;
    if (resource === 'kits-orders') error.requestId = response.headers.get('X-Request-ID') || data?.error?.request_id;
    if (resource === 'immunotherapy-orders' && response.status === 422) {
      // Retain only known structural locations and machine codes, never server
      // validator messages, input values or untrusted extra-property names.
      const location = /^body(?:\.(?:orderDate|patientId|doctorId|mrId|dosage|histamine|saline|remarks|shipping|status|poNumber|idempotencyKey|expected_version|groups(?:\.\d{1,3}(?:\.(?:id|mrp|items(?:\.\d{1,3}(?:\.(?:allergenId|result|rate))?)?))?)?|attachmentIds(?:\.\d{1,2})?))?$/;
      const codes = new Set(['missing', 'uuid_parsing', 'uuid_type', 'string_type', 'string_too_short', 'string_too_long', 'string_pattern_mismatch', 'literal_error', 'too_short', 'too_long', 'list_type', 'model_type', 'value_error', 'extra_forbidden', 'int_type', 'greater_than_equal', 'invalid_value']);
      error.validationFields = (Array.isArray(data?.error?.fields) ? data.error.fields : []).slice(0, 20)
        .filter((item) => typeof item?.field === 'string' && location.test(item.field) && codes.has(item.code))
        .map(({ field, code }) => ({ field, code }));
      error.message = error.code === 'imm_prescription_required'
        ? 'Attach at least one verified prescription for the selected patient before saving or importing this order.'
        : error.code === 'imm_pricing' ? 'Admin approval requires every allergen/suborder rate and a verified prescription. PO number is optional. Rejection does not require pricing. Your draft is preserved.'
        : error.code === 'imm_admin_review' ? 'Use Approve order or Reject order on a pending saved order. Approval moves it directly to In process; ordinary status edits and imports cannot make that decision. Your draft is preserved.'
        : 'Some Immunotherapy order fields are invalid. Check required results in mm, bottle allergens, Admin rates, optional PO length, patient assignments and prescriptions. Your draft is preserved.';
    }
    if (resource === 'products' && response.status === 422) attachMasterValidation(error, data, 'Product');
    if (batchOperation && path === '/batch-settings') {
      if (response.status === 422) {
        error.message = mutation
          ? 'Batch settings validation failed. Check the mode and prefix (up to 64 letters, digits, dots, underscores or hyphens). Your edits are preserved.'
          : 'The API rejected the batch settings read, which sends no fields. Ask the operator to check the running API version and route. No saved mode was loaded.';
      } else if ([404, 405].includes(response.status)) {
        error.message = 'The running API does not provide this batch settings operation. Ask the operator to align the API and development schema. Your edits are preserved.';
      }
    }
    throw error;
  }
  if (batchOperation) {
    if (path === '/batch-settings') {
      if (!['manual', 'system', 'product'].includes(data?.mode) || !Number.isSafeInteger(data?.version) || data.version < 1
        || typeof data.prefix !== 'string' || !/^[A-Za-z0-9._-]{0,64}$/.test(data.prefix) || typeof data.policyToken !== 'string' || !data.policyToken) throw uncertain();
    } else if (data?.idempotencyKey !== body?.idempotencyKey || !Array.isArray(data.lines)
      || data.lines.length !== body.lineIds.length || new Set(data.lines.map((line) => line?.lineId)).size !== body.lineIds.length
      || data.lines.some((line) => !line || !body.lineIds.includes(line.lineId) || typeof line.batchNo !== 'string' || !line.batchNo.trim() || line.batchNo.length > 120)) throw uncertain();
  } else if (mutation && resource === 'spt-orders') {
    if (path === '/import/commit') {
      if (!Number.isInteger(data?.imported) || !Array.isArray(data.orders) || data.orders.length !== data.imported) throw uncertain();
    } else if (path === '/patients') {
      if (!data?.id || data.source !== 'spt' || typeof data.name !== 'string') throw uncertain();
    } else if (!data?.id || !data?.number || !Number.isInteger(data.version) || !Array.isArray(data.patients)) throw uncertain();
  } else if (mutation && resource === 'lupin-orders') {
    if (path.startsWith('/attachments/')) {
      if (!data?.id || data.cancelled !== true) throw uncertain();
    } else if (path === '/import/commit') {
      if (data?.imported !== body.entries.length || !Array.isArray(data.orders) || data.orders.length !== data.imported) throw uncertain();
    } else if (!data?.id || !data?.number || !Number.isInteger(data.version)
      || !data.doctor || !data.mr || !Array.isArray(data.patients)
      || !Array.isArray(data.attachments) || !Number.isInteger(data.patientCount)
      || typeof data.price !== 'string' || typeof data.total !== 'string') throw uncertain();
  } else if (mutation && resource === 'kits-orders') {
    if (path === '/import/commit') {
      if (data?.imported !== body.entries.length || !Array.isArray(data.orders)) throw uncertain();
    } else if (!data?.id || !data?.number || !Number.isInteger(data.version)
      || !data.doctor || !data.billing || !data.recipient || !Array.isArray(data.attachments)) throw uncertain();
  } else if (mutation && resource === 'immunotherapy-orders') {
    if (path === '/patient-registration') {
      if (!data?.id || !data?.doctorId || data.mrId !== state.user?.mr_id) throw uncertain();
    } else if (path === '/import/commit') {
      if (!Number.isInteger(data?.imported) || data.imported !== body.entries.length || !Array.isArray(data.orders)) throw uncertain();
    } else if (!data?.id || !data?.number || !Number.isInteger(data.version) || !Array.isArray(data.groups)
      || !data.patient || !data.doctor || !data.mr || !Array.isArray(data.attachments)) throw uncertain();
  } else if (mutation && resource === 'products') {
    if (path === '/import/commit') {
      if (data?.kind !== 'product_import' || data.id !== params.idempotency_key
          || !Number.isSafeInteger(data.imported) || data.imported < 1 || data.imported > 500
          || !Number.isSafeInteger(data.memberRows) || data.memberRows < data.imported * 2 || data.memberRows > 1000) throw uncertain();
    } else if (method !== 'DELETE' && !data?.id) throw uncertain();
  } else if (mutation && (!data?.id || (resource !== 'inventory' && !data?.number) || (!(resource === 'inventory' && path === '/adjustments') && !Array.isArray(data.lines)))) throw uncertain();
  if (download) {
    if (!/^[0-9a-f-]{36}$/i.test(response.headers.get('X-Download-Log') || '')) throw new SessionError('Download logging could not be confirmed. No file was released. Retry.');
    serverDownloads.set(data, downloadGuard); serverInitiations.delete(downloadKey);
  }
  return data;
}

export async function immunotherapyFileRequest(path = '', { file, patientId, signal, download = false, kits = false, lupin = false, uploadId } = {}) {
  if (!/^(?:|\/[0-9a-f-]{36}(?:\/download)?)$/i.test(path)) throw new SessionError('Unsupported prescription operation.');
  const guard = reportingIdentityGuard();
  if (pending) await pending;
  else if (state.status === 'authenticated' && Date.now() >= expiresAt) await verifySession(true, portalOf(state.user));
  guard();
  if (state.user?.identity_kind !== 'mr' && !hasCapability(state.user, lupin ? 'lupin' : kits ? 'kits' : 'immunotherapy',
    file ? 'upload_attachment' : 'read_attachment')) throw new SessionError('Access denied.', 403);
  const mrPresentation = state.user?.identity_kind === 'mr';
  if (file && !kits && !lupin && !/^[0-9a-f-]{36}$/i.test(patientId || '')) throw new SessionError('Choose a real patient before uploading.');
  const form = file ? new FormData() : null;
  if (form) form.append('file', file);
  let response, data;
  const safeFailure = (code) => {
    const requestId = response?.headers.get('X-Request-ID') || data?.error?.request_id;
    const error = new SessionError(`${privateUploadMessage(code, response?.status)} Your draft and selected files remain in this tab.${mrPresentation ? '' : privateRequestReference(requestId)}`, response?.status || 0);
    error.fileId = privateFileId(response?.headers.get('X-File-ID'));
    error.code = code;
    error.requestId = requestId;
    return error;
  };
  try {
    response = await fetch(file ? (lupin ? `/api/v1/admin/lupin-orders/attachments?upload_id=${encodeURIComponent(uploadId || '')}` : kits ? '/api/v1/admin/kits-orders/attachments' : `/api/v1/admin/immunotherapy-orders/prescriptions/${patientId}`) : `/api/v1/files${path}`, {
      method: file ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
      ...(form ? { body: form } : {}), signal: signal || AbortSignal.timeout(60000),
    });
    data = response.ok && download ? await response.blob() : await response.json();
  } catch (error) {
    if (lupin) throw error; // Keep Lupin's separate retry contract unchanged.
    throw safeFailure();
  }
  guard();
  if (!response.ok) {
    if (response.status === 403 && state.user?.identity_kind === 'staff') await verifySession(false, 'admin');
    if (response.status === 401) await verifySession(true, portalOf(state.user));
    const error = lupin ? new SessionError(data?.error?.message || 'Order attachment unavailable. Your order draft is preserved; retry explicitly.', response.status)
      : safeFailure(data?.error?.code);
    if (lupin) error.fileId = response.headers.get('X-File-ID');
    throw error;
  }
  if (!lupin && !download && (!privateFileId(data?.id)
      || !['uploading', 'quarantined', 'verified', 'rejected', 'pending_delete', 'deleted'].includes(data?.state)
      || !['pending', 'clean', 'infected', 'unavailable', 'error'].includes(data?.scanner_status))) {
    throw safeFailure('file_response_invalid');
  }
  if (download) serverDownloads.set(data, guard);
  return data;
}
export async function reportingRequest(resource, params = {}, { signal } = {}) {
  const invitation = /^invitations\/(staff|mr)\/[0-9a-f-]{36}$/i.test(resource);
  if (!invitation && !['emails', 'summary', 'users', 'sessions', 'events', 'activity', 'sessions/export', 'events/export', 'downloads', 'downloads/initiate'].includes(resource)) {
    throw new SessionError('Unsupported report.');
  }
  const mrKitsDownload = state.user?.identity_kind === 'mr' && resource === 'downloads/initiate'
    && ['kits_orders', 'spt_orders', 'lupin_orders'].includes(params.source) && ['template', 'export'].includes(params.kind) && ['CSV', 'XLSX'].includes(params.format);
  if (state.user?.identity_kind === 'mr' && !mrKitsDownload) throw new SessionError('Reporting access denied.', 403);
  if (state.user?.identity_kind === 'staff') {
    const sourceResource = ({ storage_location: 'location', kits_orders: 'kits', spt_orders: 'spt', lupin_orders: 'lupin',
      po_invoice: 'purchase_order', pr_receipt: 'purchase_received' })[params.source] || params.source;
    const action = ['sample', 'template'].includes(params.kind) ? 'import'
      : params.kind === 'export' ? 'export' : ['po_invoice', 'pr_receipt'].includes(params.source) ? 'print' : null;
    if (resource !== 'downloads/initiate' || !action || !hasCapability(state.user, sourceResource, action)) {
      throw new SessionError('Reporting access denied.', 403);
    }
  }
  const epoch = generation;
  const owner = state.user?.id;
  const check = () => {
    signal?.throwIfAborted();
    if (epoch !== generation || !owner || state.user?.id !== owner) {
      throw new SessionError('Your session changed. Please log in again.', 401);
    }
    if (state.status !== 'authenticated' || !token) {
      throw new SessionError(state.message || 'Authentication required.', 401);
    }
  };
  if (pending) await pending;
  else if (state.status === 'authenticated' && Date.now() >= expiresAt) await verifySession(true);
  check();
  const query = new URLSearchParams();
  const writing = invitation || resource === 'emails' || resource === 'activity' || resource === 'downloads/initiate';
  const keys = invitation ? ['expected_version'] : resource === 'emails' ? ['start', 'end', 'purpose', 'status', 'recipient', 'limit', 'offset']
    : resource === 'downloads/initiate' ? ['initiation_id', 'source', 'kind', 'format']
    : resource === 'downloads' ? ['q', 'user_id', 'start', 'end', 'format', 'limit', 'offset']
    : writing ? ['events'] : resource === 'users' ? ['q', 'limit', 'offset']
    : resource === 'summary' ? [] : resource === 'sessions/export'
      ? ['user_id', 'start', 'end', 'state', 'q']
       : resource === 'events/export' ? ['user_id', 'start', 'end', 'q'] : resource === 'sessions'
      ? ['user_id', 'start', 'end', 'state', 'q', 'limit', 'offset']
       : ['user_id', 'start', 'end', 'q', 'limit', 'offset'];
  for (const [key, value] of Object.entries(params)) {
    if (!keys.includes(key)) throw new SessionError('Unsupported report filter.');
    if (!writing && value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const load = async (bearer) => {
    let response;
    try {
      response = await fetch(`/api/v1/admin/reporting/${resource}${query.size ? `?${query}` : ''}`, {
        method: writing ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        ...(writing ? { keepalive: true } : {}),
        headers: { Authorization: `Bearer ${bearer}`, ...(writing ? { 'Content-Type': 'application/json' } : {}) },
        ...(writing ? { body: JSON.stringify(params) } : {}),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      });
    } catch {
      signal?.throwIfAborted();
      if (pending) await pending;
      check();
      throw new SessionError('Unable to load reports. Check your connection and retry.');
    }
    if (pending) await pending;
    check();
    return response;
  };
  const original = token;
  let response = await load(original);
  if (response.status === 401) {
    // Another simultaneous request may already have renewed this token.
    if (pending) await pending;
    else if (token === original) await verifySession(true);
    check();
    if (!invitation) response = await load(token); // never replay an invitation mutation
  }
  if (!response.ok) {
    if (response.status === 403 && state.user?.identity_kind === 'staff') await verifySession(false, 'admin');
    if (invitation && ![401, 403].includes(response.status)) {
      const data = await response.json().catch(() => null);
      throw new SessionError(data?.error?.message || data?.detail || 'Invitation could not complete. Check Email Logs before trying again.', response.status);
    }
    if (response.status === 401 || (response.status === 403 && state.user?.identity_kind !== 'staff')) clear();
    else if (response.status === 403 && state.user?.identity_kind === 'staff') await verifySession();
    throw new SessionError(
      response.status === 403 ? 'This account is not permitted to perform this reporting or download action.'
        : response.status === 401 ? 'Your session expired. Please log in again.'
        : response.status === 422 ? 'Invalid report filters. Check the date range.'
        : response.status === 409 && resource.endsWith('/export') ? 'More than 5,000 rows match. Narrow the user or UTC date filters and retry. No file was downloaded.'
        : 'Unable to load reports. Please retry.', response.status,
    );
  }
  let body;
  if (response.status === 204) return null;
  try { body = await response.json(); }
  catch { throw new SessionError('The reporting service returned an invalid response.'); }
  if (pending) await pending;
  check(); // also guard logout while decoding a delayed response body
  return body;
}

export function safeAdminReturn(value) {
  if (typeof value !== 'string' || !/^\/admin(?:\/|$)/.test(value) || value.startsWith('/admin/login') || /[\\?#%\u0000-\u0020]/.test(value)) return '/admin';
  if (value.split('/').some((part) => part === '.' || part === '..')) return '/admin';
  return value;
}
