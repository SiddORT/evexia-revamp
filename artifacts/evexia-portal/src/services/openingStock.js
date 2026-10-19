import { getSession, openingStockRequest as request } from '../auth/adminSession.js';

const clean = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v != null));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const listOpenings = (params, signal) => request('', { params: clean(params), signal });
export const listItemReferences = (_kind, params, signal) => request('/references/items', { params: clean(params), signal });
export const getOpening = (id, signal) => request(`/${id}`, { signal });
export const openingActivity = (id, params, signal) => request(`/${id}/activity`, { params: clean(params), signal });
export const openingAnalytics = (id, signal) => request(`/${id}/analytics`, { signal });
export const previewOpening = (body) => request('/preview', { body });
export const commitOpening = (body) => request('', { body });
export const reviewImport = (file, signal) => request('/import/review', { file, params: { filename: file.name }, signal });
export const downloadSample = (format) => request('/sample', { params: { format }, download: true });
export const downloadExport = (query, format) => request('/export', { params: clean({ query, format }), download: true });
export const reconcileOpeningRequest = (key) => request(`/requests/${key}`);

export const newId = () => globalThis.crypto.randomUUID();
export const owner = () => String(getSession()?.user?.id || '');
const journalKey = () => `evexia.opening-stock.pending:${owner()}`;
const notify = () => window.dispatchEvent(new Event('evexia-opening-pending'));

/** Only an opaque owner-bound request identity is stored; drafts stay in memory. */
export function pendingOpening() {
  try {
    if (!owner()) throw new Error();
    const raw = localStorage.getItem(journalKey());
    if (raw === null) return null;
    const item = JSON.parse(raw);
    if (item.owner !== owner() || !uuid.test(item.key)) throw new Error();
    return item;
  } catch { throw new Error('Opening stock retry identity is unavailable. Restore browser storage/session access; do not start a replacement save until the previous outcome is checked.'); }
}
export async function rememberOpening(key) {
  const o = owner();
  if (!o || !navigator.locks) throw new Error('A safe save needs browser storage and Web Locks. Nothing was sent.');
  await navigator.locks.request(`evexia-opening-stock:${o}`, () => {
    const previous = pendingOpening();
    if (owner() !== o || (previous && previous.key !== key)) throw new Error('Another opening stock save is unresolved. Check its outcome before saving again.');
    localStorage.setItem(journalKey(), JSON.stringify({ owner: o, key }));
    notify();
  });
}
export async function forgetOpening(key) {
  const o = owner();
  if (!o || !navigator.locks) throw new Error('Retry storage unavailable; check the outcome before a new save.');
  await navigator.locks.request(`evexia-opening-stock:${o}`, () => {
    if (owner() !== o || pendingOpening()?.key !== key) throw new Error('Retry identity changed.');
    localStorage.removeItem(journalKey());
    notify();
  });
}
export async function journaled(key, send) {
  await rememberOpening(key);
  let result;
  try { result = await send(); } catch (e) { e.uncertain = true; throw e; }
  try { await forgetOpening(key); } catch (e) { e.uncertain = true; e.saved = result; throw e; }
  return result;
}
export async function reconcileKey(key) {
  const r = await reconcileOpeningRequest(key);
  if (!r || !['committed', 'not_committed'].includes(r.state)) throw new Error('The server returned an unclear outcome. Retry the check.');
  await forgetOpening(key);
  return r;
}

const RATE_RE = /^\d{1,12}(?:\.\d{1,6})?$/;
const MAX_RATE_CENTS = 99999999999999n;
const split = (v) => { const [a, b = ''] = String(v).trim().split('.'); return [a, b]; };
/** Exact half-up rounding of a nonnegative decimal string to two places, in cents. */
const toCents = (v) => { const [a, b] = split(v); const f = (b + '000000').slice(0, 6); return (BigInt(a) * 1000000n + BigInt(f) + 5000n) / 10000n; };
export const validRate = (v) => RATE_RE.test(String(v).trim()) && toCents(v) <= MAX_RATE_CENTS;
export function validQuantity(v, kind) {
  const s = String(v).trim();
  if (kind === 'combo') return /^(?:[1-9]\d{0,5}|1000000)$/.test(s);
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/.test(s)) return false;
  const [a, b] = split(s);
  const milli = BigInt(a) * 1000n + BigInt((b + '000').slice(0, 3));
  return milli > 0n && milli <= 1000000000n;
}
const group = (digits) => BigInt(digits).toLocaleString('en-IN');
const valid = (v) => typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v.trim());
/** Unit rate: exactly two decimals, half-up, no floating point. */
export const money = (v) => {
  if (!valid(v)) return 'Not set';
  const c = toCents(v);
  return `INR ${group(String(c / 100n))}.${String(c % 100n).padStart(2, '0')}`;
};
/** Opening value: exact, up to five decimals, never rounded, at least two. */
export const valueMoney = (v) => {
  if (!valid(v)) return 'Not set';
  const [a, b] = split(v);
  let frac = b.replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `INR ${group(a)}.${frac}`;
};
export const locationLabel = (l) => l?.id ? l.name : 'Unallocated';
