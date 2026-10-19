import { getSession, inventoryRequest as request } from '../auth/adminSession.js';

export const UNIT = 'procurement quantity units';
const clean = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length)));

export const listStock = (params, signal) => request('/stock', { params: clean({ ...params, product_ids: params?.product_ids?.join?.(',') ?? params?.product_ids }), signal });
export const stockHistory = (id, params, signal) => request(`/stock/${id}/history`, { params: clean(params), signal });
export const listReference = (kind, params, signal) => request(`/references/${kind}`, { params: clean(params), signal });
export const listMovements = (params, signal) => request('/movements', { params: clean(params), signal });
export const getMovement = (id, signal) => request(`/movements/${id}`, { signal });
export const previewMovement = (body) => request('/movements/preview', { body });
export const saveMovement = (body) => request('/movements', { body });
export const reconcileMovement = (key) => request(`/requests/${key}`);

export const newKey = () => globalThis.crypto.randomUUID();
export const ownerMove = () => String(getSession()?.user?.id || '');
const journalKey = () => `evexia.move.pending:${ownerMove()}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only an opaque owner-bound retry identity is persisted. Drafts stay in memory. */
export function pendingMove() {
  try {
    if (!ownerMove()) throw new Error();
    const raw = localStorage.getItem(journalKey());
    if (raw === null) return null;
    const item = JSON.parse(raw);
    if (item.owner !== ownerMove() || !uuid.test(item.key)) throw new Error();
    return item;
  } catch { throw new Error('Movement retry identity is unavailable. Restore browser storage/session access; do not start a replacement save until the previous outcome is checked.'); }
}
export async function rememberMove(key) {
  const owner = ownerMove();
  if (!owner || !navigator.locks) throw new Error('A safe save needs browser storage and Web Locks. Nothing was sent.');
  await navigator.locks.request(`evexia-move:${owner}`, () => {
    const previous = pendingMove();
    if (ownerMove() !== owner || (previous && previous.key !== key)) throw new Error('Another movement save is unresolved. Check its outcome before saving again.');
    localStorage.setItem(journalKey(), JSON.stringify({ owner, key }));
  });
}
export async function forgetMove(key) {
  const owner = ownerMove();
  if (!owner || !navigator.locks) throw new Error('Retry storage unavailable; check the outcome before a new save.');
  await navigator.locks.request(`evexia-move:${owner}`, () => {
    if (ownerMove() !== owner || pendingMove()?.key !== key) throw new Error('Retry identity changed.');
    localStorage.removeItem(journalKey());
  });
}

/** Exact decimal helpers: thousandths as BigInt, never Number. */
export const milli = (v) => {
  const s = String(v ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/.test(s)) return null;
  const [a, b = ''] = s.split('.');
  return BigInt(a + b.padEnd(3, '0'));
};
export const MAX_MILLI = 1000000000n;
export function validateLines(lines) {
  const errors = {};
  let count = 0;
  lines.forEach(({ lot, quantity }) => {
    const n = milli(quantity), a = milli(lot.available);
    if (n === null || n <= 0n) errors[lot.id] = 'Enter a positive quantity with up to 3 decimals.';
    else if (n > MAX_MILLI) errors[lot.id] = 'Quantity cannot exceed 1000000.';
    else if (a !== null && n > a) errors[lot.id] = `Quantity exceeds available ${lot.available}.`;
    else count++;
  });
  return { errors, count };
}
export function sumMilli(values) {
  const total = values.reduce((s, v) => s + (milli(v) ?? 0n), 0n);
  return `${total / 1000n}.${String(total % 1000n).padStart(3, '0')}`;
}

export const formatPrice = (v) => v == null || v === '' || Number.isNaN(Number(v)) ? 'Not set'
  : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(v));

export const dayStartISO = (d) => `${d}T00:00:00.000Z`;
export function dayEndExclusiveISO(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day + 1)).toISOString();
}

const cell = (value) => {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
export function exportStockCSV(rows, { asOf, coverage }) {
  const header = ['Product ID', 'Product', 'Concentration', 'Category', 'Selling price (INR)', 'Quantity', 'Unit', 'State', 'As of (UTC)', 'Sales', 'Openings'];
  const records = rows.map((r) => [r.productId, r.name, r.concentration, r.category, r.sellingPrice ?? '', r.quantity, r.unit, r.state, asOf,
    coverage?.sales || 'unavailable', coverage?.openings || 'outside coverage']);
  return '\uFEFF' + [header, ...records].map((c) => c.map(cell).join(',')).join('\r\n') + '\r\n';
}
