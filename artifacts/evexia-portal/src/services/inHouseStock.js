import { getSession, inHouseStockRequest as request } from '../auth/adminSession.js';

const clean = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v != null));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PENDING_EVENT = 'evexia-in-house-stock-pending';

export const listInHouseStock = (params, signal) => request('', { params: clean(params), signal });
export const getInHouseStock = (id, signal) => request(`/${encodeURIComponent(id)}`, { signal });
export const previewInHouseStock = (body) => request('/preview', { body });
export const commitInHouseStock = (body) => request('', { body });
const reconcileRequest = (key) => request(`/requests/${key}`);

/** ReferenceSelect adapters: map {id,name,categoryName} to {value,label,...}. */
const adapt = (d, withCategory) => ({
  ...d,
  items: (d?.items || []).map((i) => ({ ...i, id: i.id, name: withCategory && i.categoryName ? `${i.name} (${i.categoryName})` : i.name, value: i.id, label: withCategory && i.categoryName ? `${i.name} (${i.categoryName})` : i.name })),
  filtered: d?.filtered ?? 0,
});
export const listAllergenReferences = (_kind, params, signal) => request('/references/allergens', { params: clean({ query: params?.query, offset: params?.offset, limit: params?.limit }), signal }).then((d) => adapt(d, true));
export const listLocationReferences = (_kind, params, signal) => request('/references/locations', { params: clean({ query: params?.query, offset: params?.offset, limit: params?.limit }), signal }).then((d) => adapt(d, false));

export const newId = () => globalThis.crypto.randomUUID();
const owner = () => String(getSession()?.user?.id || '');
const journalKey = () => `evexia.in-house-stock.pending:${owner()}`;
const notify = () => window.dispatchEvent(new Event(PENDING_EVENT));

/** Only an opaque owner-bound request identity is stored; drafts stay in memory. */
export function pendingInHouse() {
  try {
    if (!owner()) throw new Error();
    const raw = localStorage.getItem(journalKey());
    if (raw === null) return null;
    const item = JSON.parse(raw);
    if (item.owner !== owner() || !uuid.test(item.key)) throw new Error();
    return item;
  } catch { throw new Error('In-house stock retry identity is unavailable. Restore browser storage/session access; do not start a replacement save until the previous outcome is checked.'); }
}
async function remember(key) {
  const o = owner();
  if (!o || !navigator.locks) throw new Error('A safe save needs browser storage and Web Locks. Nothing was sent.');
  await navigator.locks.request(`evexia-in-house-stock:${o}`, () => {
    const previous = pendingInHouse();
    if (owner() !== o || (previous && previous.key !== key)) throw new Error('Another in-house stock save is unresolved. Check its outcome before saving again.');
    localStorage.setItem(journalKey(), JSON.stringify({ owner: o, key }));
    notify();
  });
}
async function forget(key) {
  const o = owner();
  if (!o || !navigator.locks) throw new Error('Retry storage unavailable; check the outcome before a new save.');
  await navigator.locks.request(`evexia-in-house-stock:${o}`, () => {
    if (owner() !== o || pendingInHouse()?.key !== key) throw new Error('Retry identity changed.');
    localStorage.removeItem(journalKey());
    notify();
  });
}
export async function journaled(key, send) {
  await remember(key);
  let result;
  try { result = await send(); } catch (e) { e.uncertain = true; throw e; }
  try { await forget(key); } catch (e) { e.uncertain = true; e.saved = result; throw e; }
  return result;
}
export async function reconcileKey(key) {
  const r = await reconcileRequest(key);
  if (!r || !['committed', 'not_committed'].includes(r.state) || (r.state === 'committed' && (!uuid.test(r.result?.id) || r.result.reserveOnly !== true))) throw new Error('The server returned an unclear outcome. Retry the check.');
  await forget(key);
  return r;
}

const split = (v) => { const [a, b = ''] = String(v).trim().split('.'); return [a, b]; };
export function validQuantity(v) {
  const s = String(v).trim();
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/.test(s)) return false;
  const [a, b] = split(s);
  const milli = BigInt(a) * 1000n + BigInt((b + '000').slice(0, 3));
  return milli > 0n && milli <= 1000000000n;
}
export function validDay(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v && !v.startsWith('0000');
}
export const RESERVE_NOTE = 'Reserve only. In-house stock is not order-ready and is never allocated to orders.';
