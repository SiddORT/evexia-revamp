// Tokens live only in this module's memory. No credential or identity storage.
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
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('evexia-auth-events') : null;

export class SessionError extends Error {
  constructor(message, status = 0, replaced = false) { super(message); this.status = status; this.replaced = replaced; }
}

function publish(next) {
  state = Object.freeze(next);
  listeners.forEach((listener) => listener());
}

export const getSession = () => state;
export const subscribeSession = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

function clear(message = '') {
  generation += 1;
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
    if (state.status === 'authenticated' && Date.now() >= expiresAt) void verifySession(true);
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

function safeAdmin(user) {
  if (!user || typeof user.id !== 'string' || typeof user.email !== 'string' || user.system_role !== 'super_admin' || !Array.isArray(user.permissions) || !user.permissions.includes('admin.access')) {
    throw new SessionError('This account does not have Admin access.', 403);
  }
  return Object.freeze({ id: user.id, email: user.email, username: user.username, system_role: user.system_role, permissions: user.permissions.filter((permission) => ['admin.access', 'staff.manage', 'roles.manage'].includes(permission)) });
}

async function accept(payload, epoch) {
  if (epoch !== generation) return;
  if (typeof payload?.access_token !== 'string' || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0) {
    throw new SessionError('The sign-in service returned an invalid session.');
  }
  // Do not authorize using login/refresh role selection alone: verify DB identity.
  const user = safeAdmin(await request('/me', undefined, payload.access_token));
  if (epoch !== generation) return;
  token = payload.access_token;
  expiresAt = Date.now() + payload.expires_in * 1000;
  publish({ status: 'authenticated', user, message: '' });
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => { void verifySession(true); }, Math.max(0, expiresAt - Date.now()));
}

export async function loginAdmin(identifier, password, remember) {
  restorationAllowed = true;
  clear();
  const epoch = generation;
  publish({ status: 'checking', user: null, message: '' });
  try {
    await cookieLock(async () => {
      if (epoch !== generation) return;
      const payload = await request('/login', { identifier, password, remember_me: remember });
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

export function verifySession(forceRefresh = false) {
  if (pending) return pending;
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
          const user = safeAdmin(await request('/me', undefined, oldToken));
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
        await accept(await request('/refresh', {}), epoch);
      });
    } catch (error) {
      if (epoch !== generation) return;
      token = null;
      clearTimeout(expiryTimer);
      if (error.status === 401 || error.status === 403) {
        restorationAllowed = false;
        clear(previousUser && error.replaced ? REPLACED_MESSAGE : '');
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
  return () => {
    if (epoch !== generation || !owner || state.user?.id !== owner || state.status !== 'authenticated') {
      throw new SessionError('Your session changed. Export cancelled. Please retry after signing in.', 401);
    }
  };
}

// Dedicated authenticated staff transport. Never replay mutations: a lost create
// response may already have committed and its initial password is unrecoverable.
export async function staffRequest(path = '', body, { signal } = {}) {
  if (!/^(?:|\/search|\/[0-9a-f-]{36}(?:\/(?:edit|status))?|\?limit=\d+&offset=\d+)$/.test(path)) {
    throw new SessionError('Unsupported staff operation.');
  }
  const mutation = body !== undefined && path !== '/search';
  const epoch = generation;
  const owner = state.user?.id;
  const check = () => {
    signal?.throwIfAborted();
    if (epoch !== generation || !owner || state.user?.id !== owner || state.status !== 'authenticated' || !token) {
      throw new SessionError('Your session changed. Please sign in again.', 401);
    }
    if (!state.user.permissions.includes('staff.manage')) throw new SessionError('Staff Management access denied.', 403);
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
    const error = new SessionError(!mutation ? 'Unable to load staff. Check your connection and retry.'
      : 'Save outcome could not be confirmed. Refresh the directory before submitting again; the server may have saved it.');
    error.ambiguous = mutation;
    throw error;
  }
  if (pending) await pending;
  checkResponse();
  let data;
  try { data = await response.json(); }
  catch {
    const error = new SessionError('Staff service returned an invalid response. Refresh the directory before submitting again.');
    error.ambiguous = mutation;
    throw error;
  }
  if (pending) await pending;
  checkResponse();
  if (!response.ok) {
    if (response.status === 401) { restorationAllowed = false; clear(); }
    const code = data?.error?.code;
    const error = new SessionError(
      code === 'staff_stale' ? 'This staff record changed. Your draft is still here. Review current details before retrying.'
        : code === 'staff_duplicate' ? 'That email or identity already exists. Check the directory.'
        : response.status === 422 ? 'Some staff fields are invalid. Check the details and try again.'
        : response.status === 403 ? 'Staff Management access denied.'
        : response.status === 401 ? 'Your session expired. Please sign in again.'
        : 'Staff service is unavailable. Your draft has not been discarded.', response.status);
    error.code = code;
    error.ambiguous = mutation && response.status >= 500 && code !== 'staff_unavailable';
    throw error;
  }
  return data;
}

export async function roleRequest(path = '', body, { signal } = {}) {
  if (!/^(?:|\/[0-9a-f-]{36}(?:\/(?:edit|delete))?|\?limit=(?:[1-9]\d?|100)(?:&cursor=[0-9a-f-]{36})?)$/.test(path)
      || (body !== undefined && path !== '' && !/\/(?:edit|delete)$/.test(path))) {
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
    if (!state.user.permissions.includes('roles.manage')) throw new SessionError('Role Management access denied.', 403);
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
    if (response.status === 401) { restorationAllowed = false; clear(); }
    const code = data?.error?.code;
    const error = new SessionError(
      code === 'role_stale' ? 'This role changed. Your draft is still here. Review current details before retrying.'
        : code === 'role_deleted' ? 'This role was deleted. Your draft is still here. Refresh roles to continue.'
        : code === 'role_duplicate' ? 'A role with this name already exists. Choose a different name.'
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
// Narrow reporting facility: credentials never leave this module.
// Shared Zone transport. No automatic replay of a potentially committed write.
export async function zoneRequest(path = '', { body, file, params = {}, download = false, signal } = {}) {
  if (!/^(?:|\/export|\/import\/(?:review|commit)|\/[0-9a-f-]{36}(?:\/(?:edit|status|delete))?)$/.test(path)) {
    throw new SessionError('Unsupported Zone operation.');
  }
  const epoch = generation;
  const owner = state.user?.id;
  const check = () => {
    signal?.throwIfAborted();
    if (epoch !== generation || !owner || state.user?.id !== owner || state.status !== 'authenticated' || !token) {
      throw new SessionError('Your session changed. Sign in again before retrying.', 401);
    }
    if (!state.user.permissions.includes('admin.access')) throw new SessionError('Zone access denied.', 403);
  };
  if (pending) await pending;
  else if (state.status === 'authenticated' && Date.now() >= expiresAt) await verifySession(true);
  check();
  const writing = body !== undefined || file !== undefined;
  const load = () => fetch(`/api/v1/admin/zones${path}?${new URLSearchParams(params)}`, {
    method: writing ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(writing ? { 'Content-Type': file ? 'application/octet-stream' : 'application/json' } : {}) },
    ...(writing ? { body: file || JSON.stringify(body) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
  });
  let response;
  try {
    response = await load();
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
      : 'Unable to load zones. Check your connection and retry.');
    failure.ambiguous = writing && path !== '/import/review';
    throw failure;
  }
  if (pending) await pending;
  check();
  let data;
  try { data = response.ok && download ? await response.blob() : await response.json(); }
  catch {
    check();
    const error = new SessionError('Zone response could not be read. Refresh and inspect current records before retrying.');
    error.ambiguous = writing && path !== '/import/review';
    throw error;
  }
  if (pending) await pending;
  check();
  if (!response.ok) {
    const error = new SessionError(response.status >= 500 && data?.error?.code !== 'zone_unavailable'
      ? 'Zone service is unavailable. Your draft is preserved. Retry later; inspect records first if a save was pending.'
      : data?.error?.message || 'Zone request failed. Review the details and retry.', response.status);
    error.code = data?.error?.code;
    error.ambiguous = writing && response.status >= 500 && error.code !== 'zone_unavailable';
    throw error;
  }
  return data;
}

export async function reportingRequest(resource, params = {}, { signal } = {}) {
  if (!['summary', 'users', 'sessions', 'events', 'activity', 'sessions/export', 'events/export'].includes(resource)) {
    throw new SessionError('Unsupported report.');
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
  const writing = resource === 'activity';
  const keys = writing ? ['events'] : resource === 'users' ? ['q', 'limit', 'offset']
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
        ...(writing ? { body: JSON.stringify({ events: params.events }) } : {}),
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
    response = await load(token); // one retry only
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) clear();
    throw new SessionError(
      response.status === 403 ? 'This account does not have Admin access.'
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
