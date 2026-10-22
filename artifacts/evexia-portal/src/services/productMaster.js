import { getSession, productMasterRequest as request } from '../auth/adminSession.js';
import { downloadServerBlob } from './downloads.js';

const clean = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v != null));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const listProducts = (params, signal) => request('', { params: clean(params), signal });
export const listMemberReferences = (_kind, params, signal) => request('/references', { params: clean(params), signal });
export const listProductFilterReferences = (kind, params, signal) => {
  if (!['categories', 'allergens'].includes(kind)) throw new Error('Unsupported product filter directory.');
  return request(`/filter-references/${kind}`, { params: clean(params), signal });
};
export const getProduct = (id, signal) => request(`/${id}`, { signal });
export const createProduct = (body) => request('', { body });
export const updateProduct = (id, body) => request(`/${id}`, { body, method: 'PUT' });
export const setProductStatus = (id, body) => request(`/${id}/status`, { body, method: 'PATCH' });
export const deleteProduct = (id, body) => request(`/${id}`, { body, method: 'DELETE' });
export const productActivity = (id, params, signal) => request(`/${id}/activity`, { params: clean(params), signal });
export const productAnalytics = (id, signal) => request(`/${id}/analytics`, { signal });
export const productAssemblies = (id, params, signal) => request(`/${id}/assemblies`, { params: clean(params), signal });
export const previewAssembly = (body) => request('/assemblies/preview', { body });
export const saveAssembly = (body) => request('/assemblies', { body });
export const getAssembly = (id, signal) => request(`/assemblies/${id}`, { signal });
export const reconcileProductRequest = (key) => request(`/requests/${key}`);
export const reviewProducts = (file, signal) => request('/import/review', { file, params: { filename: file.name }, signal });
export const importProducts = (file, digest, key) => request('/import/commit', { file, params: { filename: file.name, digest, confirm: true, idempotency_key: key } });
export const exportProducts = (params, format, signal) => request('/export', { params: { ...params, format }, download: true, signal });
export const sampleProducts = (format, signal) => request('/sample', { params: { format }, download: true, signal });
export const downloadProductFile = (blob, format, sample = false) => downloadServerBlob(blob, `evexia-product-${sample ? 'template' : 'master'}.${format}`);

export const newKey = () => globalThis.crypto.randomUUID();
export const owner = () => String(getSession()?.user?.id || '');
const journalKey = () => `evexia.product.pending:${owner()}`;
const notify = () => window.dispatchEvent(new Event('evexia-product-pending'));

/** Only an opaque actor-bound retry identity is stored; drafts stay in memory. */
export function pendingProduct() {
  try {
    if (!owner()) throw new Error();
    const raw = localStorage.getItem(journalKey());
    if (raw === null) return null;
    const item = JSON.parse(raw);
    if (item.owner !== owner() || !uuid.test(item.key)) throw new Error();
    return item;
  } catch { throw new Error('Product retry identity is unavailable. Restore browser storage/session access; do not start a replacement save until the previous outcome is checked.'); }
}
export async function rememberProduct(key) {
  const o = owner();
  if (!o || !navigator.locks) throw new Error('A safe save needs browser storage and Web Locks. Nothing was sent.');
  await navigator.locks.request(`evexia-product:${o}`, () => {
    const previous = pendingProduct();
    if (owner() !== o || (previous && previous.key !== key)) throw new Error('Another product save is unresolved. Check its outcome before saving again.');
    localStorage.setItem(journalKey(), JSON.stringify({ owner: o, key }));
    notify();
  });
}
export async function forgetProduct(key) {
  const o = owner();
  if (!o || !navigator.locks) throw new Error('Retry storage unavailable; check the outcome before a new save.');
  await navigator.locks.request(`evexia-product:${o}`, () => {
    if (owner() !== o || pendingProduct()?.key !== key) throw new Error('Retry identity changed.');
    localStorage.removeItem(journalKey());
    notify();
  });
}

/** Run a journaled mutation. Returns {ok,result} or throws with .uncertain when outcome must be reconciled. */
export async function journaled(key, send) {
  await rememberProduct(key);
  let result;
  try { result = await send(); } catch (e) { e.uncertain = true; throw e; }
  try { await forgetProduct(key); } catch (e) { e.uncertain = true; e.saved = result; throw e; }
  return result;
}
/** Reconcile an unknown identity; closes it durably when not committed. */
export async function reconcileKey(key) {
  const r = await reconcileProductRequest(key);
  if (!r || !['committed', 'not_committed'].includes(r.state)
      || (r.state === 'committed' && (!r.result?.id || (r.result.kind === 'product_import'
        && (!Number.isSafeInteger(r.result.imported) || r.result.imported < 1 || r.result.imported > 500
          || !Number.isSafeInteger(r.result.memberRows) || r.result.memberRows < r.result.imported * 2 || r.result.memberRows > 1000))))) {
    throw new Error('The server did not confirm this save outcome. Keep the same identity and check again.');
  }
  await forgetProduct(key);
  return r;
}

export const qty3 = (v) => { const n = BigInt(v); return `${n / 1000n}.${String(n % 1000n).padStart(3, '0')}`; };

/** Exact two-place half-up rate in integer cents (mirrors server rounding); null when invalid. */
export function toCents(value) {
  const s = String(value ?? '').trim();
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m || s.length > 64 || m[1].replace(/^0+/, '').length > 12) return null;
  const frac = (m[2] || '').padEnd(3, '0');
  let cents = BigInt(m[1]) * 100n + BigInt(frac.slice(0, 2));
  if (frac[2] >= '5') cents += 1n;
  return cents <= 99999999999999n ? cents : null;
}
