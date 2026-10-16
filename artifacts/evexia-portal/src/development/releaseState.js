import { probeCompatibility } from './compatibility.js';
import { knownFailure } from './failureGuidance.js';

const environment = import.meta.env || {};
export const gateEnabled = environment.EVEXIA_DEVELOPMENT_GATE === true;
// Preserve one store and the ORIGINAL fetch across replacement of this module.
// Otherwise HMR stacks wrappers whose old closures can stay blocked forever.
const store = import.meta.hot?.data.release || {
  state: { status: gateEnabled ? 'checking' : 'ready', reason: '' },
  listeners: new Set(), epoch: 0, controller: null,
  nativeFetch: globalThis.fetch?.bind(globalThis),
};
if (import.meta.hot) import.meta.hot.data.release = store;
export const releaseSnapshot = () => store.state;
export const releaseSubscribe = listener => { store.listeners.add(listener); return () => store.listeners.delete(listener); };
export const developmentBlocked = () => gateEnabled && store.state.status !== 'ready';
export function developmentRequestUrl(input, base) {
  return new URL(input instanceof URL ? input.href
    : typeof input === 'string' ? input : input.url, base);
}
function publish(status, reason = '') {
  store.state = { status, reason };
  store.listeners.forEach(listener => listener());
}
export function invalidateRelease() {
  store.epoch++;
  store.controller?.abort();
  publish('blocked', 'source_changed');
}
export async function retryRelease() {
  if (store.reloadRequired) {
    publish('blocked', 'frontend_reload_required');
    return;
  }
  const generation = ++store.epoch;
  store.controller?.abort();
  store.controller = new AbortController();
  const activeController = store.controller;
  const timeout = setTimeout(() => activeController.abort(), 12000);
  publish('checking');
  try {
    await probeCompatibility(store.nativeFetch, environment.EVEXIA_DEVELOPMENT_CONTRACT,
      environment.BASE_URL, activeController.signal);
    if (generation === store.epoch) publish('ready');
  } catch (error) {
    if (generation === store.epoch) publish('blocked', knownFailure(error?.message) ? error.message : 'unavailable');
  } finally { clearTimeout(timeout); }
}

if (gateEnabled && typeof window !== 'undefined') {
  const reloadBlocked = () => {
    store.reloadRequired = true;
    invalidateRelease();
    publish('blocked', 'frontend_reload_required');
  };
  window.addEventListener('evexia:automatic-reload-blocked', reloadBlocked);
  import.meta.hot?.dispose(() => window.removeEventListener('evexia:automatic-reload-blocked', reloadBlocked));
  // Block background requests as well as hidden controls. Never replay them.
  window.fetch = async (input, options) => {
    const url = developmentRequestUrl(input, location.href);
    const protectedApi = url.origin === location.origin && url.pathname.startsWith('/api/');
    if (protectedApi && developmentBlocked()) throw Error('Development compatibility is not verified. Retry explicitly.');
    const generation = store.epoch;
    if (protectedApi) {
      const headers = new Headers(options?.headers || (input instanceof Request ? input.headers : undefined));
      const expected = environment.EVEXIA_DEVELOPMENT_CONTRACT;
      headers.set('X-Evexia-Development-Contract', `${expected.contract}:${expected.schema}`);
      options = { ...options, headers };
    }
    const response = await store.nativeFetch(input, options);
    if (protectedApi && response.status === 503) invalidateRelease();
    if (protectedApi && generation !== store.epoch) throw Error('Development compatibility changed during this request. Check the result before retrying.');
    return response;
  };
}

if (gateEnabled && import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', invalidateRelease);
  import.meta.hot.on('vite:ws:disconnect', invalidateRelease);
  const fullReload = () => {
    store.reloadRequired = true;
    invalidateRelease();
    publish('blocked', 'frontend_reload_required');
  };
  import.meta.hot.on('vite:beforeFullReload', fullReload);
  // Remain blocked after HMR until explicit retry. React retains editor state.
  import.meta.hot.on('evexia:compatibility-invalidated', invalidateRelease);
  import.meta.hot.dispose(() => {
    import.meta.hot.off('vite:beforeUpdate', invalidateRelease);
    import.meta.hot.off('vite:ws:disconnect', invalidateRelease);
    import.meta.hot.off('vite:beforeFullReload', fullReload);
    import.meta.hot.off('evexia:compatibility-invalidated', invalidateRelease);
    invalidateRelease();
  });
}
