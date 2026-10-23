import { getSession, purchaseOrderRequest } from '../auth/adminSession.js';
import states from '../../../api-server/backend/app/services/gst_states.json' with { type: 'json' };
import { catalogueRate } from './rates.js';

export const GST_STATES = states;
export const TAX_COMPONENTS = ['cgst', 'sgst', 'utgst', 'igst'];
export function taxContext(vendor, destination) {
  const gstin = vendor?.gstin;
  const supplier = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin || '') && states.find((s) => s.code === gstin.slice(0, 2));
  const place = states.find((s) => s.code === destination);
  if (!supplier) return { error: vendor ? 'Vendor GST registration state unavailable or unsupported. Select a vendor with a supported GSTIN; for a legacy order, load its current vendor tax basis.' : 'Select a vendor to determine its GST registration state.' };
  if (!place) return { supplier, error: 'Select Place of supply (State/UT) to calculate GST components.' };
  const treatment = supplier.code === place.code ? `cgst_${place.localTax}` : 'igst';
  return { supplier, place, treatment };
}

const clean = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, value]) => value !== '' && value != null));

export const listPurchaseOrders = (params, signal) => purchaseOrderRequest('', { params: clean(params), signal });
export const getPurchaseOrderOverview = (signal) => purchaseOrderRequest('/overview', { signal });
export const listPurchaseOrderActivity = (params, signal) => purchaseOrderRequest('/activity', { params: clean(params), signal });
export const getPurchaseOrderAnalytics = (signal) => purchaseOrderRequest('/analytics', { signal });
export const listPurchaseOrderReferences = async (kind, params, signal) => {
  const page = await purchaseOrderRequest(`/references/${kind}`, { params: clean(params), signal });
  // Normalize only new catalogue choices, never fetched order/retry snapshots.
  return kind !== 'products' ? page : { ...page, items: page.items.map((item) => ({
    ...item, unitPrice: item.unitPrice == null ? null : catalogueRate(item.unitPrice), gst: catalogueRate(item.gst, true),
  })) };
};
export const listPurchaseOrderFilterOptions = (kind, params, signal) => purchaseOrderRequest(`/filter-options/${kind}`, { params: clean(params), signal });
export const previewPurchaseOrder = (input, signal) => purchaseOrderRequest('/preview', { body: input, signal });
export const createPurchaseOrder = (input, reviewToken, idempotencyKey, signal) => purchaseOrderRequest('', { body: { ...input, reviewToken, idempotencyKey }, signal });
export const getPurchaseOrder = (id, signal) => purchaseOrderRequest(`/${id}`, { signal });
export const previewPurchaseOrderEdit = (id, input) => purchaseOrderRequest(`/${id}/preview`, { body: input });
export const updatePurchaseOrder = (id, input, version, reviewToken, idempotencyKey) => purchaseOrderRequest(`/${id}/edit`, { body: { ...input, expected_version: version, reviewToken, idempotencyKey } });
export const deletePurchaseOrder = (id, version, idempotencyKey) => purchaseOrderRequest(`/${id}/delete`, { body: { expected_version: version, idempotencyKey } });
export const isStaleOrder = (error) => error?.status === 409 && errorCode(error) === 'po_stale';

/* Edit/delete retries are durable and scoped to owner + order, never local PO records. */
const mutationKey = (id) => `evexia.po.pending-mutation:${ownerId()}:${id}`;
/** Bounded discovery of this owner's retry journals, not a local order directory. */
export function pendingPurchaseOrderDeletions() {
  const owner = ownerId();
  if (!owner) return { ids: [], error: '' };
  try {
    const prefix = `evexia.po.pending-mutation:${owner}:`;
    const storage = window.localStorage;
    if (storage.length > 2000) throw new Error();
    const ids = [];
    let unreadable = false;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (!/^[0-9a-f-]{36}$/i.test(id)) { unreadable = true; continue; }
      const state = loadOrderMutation(id);
      if (state.status === 'blocked') unreadable = true;
      if (state.status === 'found' && state.pending.operation === 'delete') ids.push(id);
      if (ids.length > 50) throw new Error();
    }
    return { ids, error: unreadable ? 'Some order retry data is unreadable. Open the affected saved order to recover it; do not clear browser retry data without checking the server.' : '' };
  } catch {
    return { ids: [], error: 'Deletion recovery could not read the bounded browser retry journal. Restore storage access and reopen this listing or the affected order; do not start an independent replacement action.' };
  }
}
export function loadOrderMutation(id) {
  try {
    if (!ownerId()) throw new Error();
    const raw = window.localStorage.getItem(mutationKey(id));
    if (raw === null) return { status: 'none' };
    const p = JSON.parse(raw);
    if (p.owner !== ownerId() || p.id !== id || !UUID.test(p.key) || !['edit', 'delete'].includes(p.operation)
      || !Number.isInteger(p.version) || p.version < 1
      || (p.operation === 'edit' && (!validPending(p) || !/^[0-9a-f]{64}$/.test(p.reviewToken)
        || !Array.isArray(p.order.lines) || p.order.lines.length < 1
        || !p.order.lines.every((line) => line && typeof line.productName === 'string' && typeof line.quantity === 'string'
          && typeof line.unitPrice === 'string' && typeof line.gst === 'string'
          && ['subtotal', 'gstAmount', 'total'].every((key) => Number.isSafeInteger(line[key])))))) throw new Error();
    return { status: 'found', pending: p };
  } catch {
    return { status: 'blocked', message: 'The saved retry state cannot be read. Changes are locked to avoid repeating an unconfirmed action. Restore browser storage access and reload; do not clear retry data without checking the saved order.' };
  }
}
export async function saveOrderMutation(id, pending) {
  const owner = ownerId();
  if (!owner || !navigator.locks) return false;
  try {
    return await navigator.locks.request(`evexia-po-mutation:${owner}:${id}`, () => {
      const current = loadOrderMutation(id);
      if (ownerId() !== owner || current.status === 'blocked' || (current.status === 'found' && JSON.stringify(current.pending) !== JSON.stringify({ ...pending, owner, id }))) return false;
      window.localStorage.setItem(mutationKey(id), JSON.stringify({ ...pending, owner, id }));
      return true;
    });
  } catch { return false; }
}
export async function clearOrderMutation(id, key) {
  const owner = ownerId();
  if (!owner || !navigator.locks) return false;
  try {
    return await navigator.locks.request(`evexia-po-mutation:${owner}:${id}`, () => {
      if (ownerId() !== owner) return false;
      const state = loadOrderMutation(id);
      if (state.status === 'none') return true;
      if (state.status !== 'found' || state.pending.key !== key) return false;
      window.localStorage.removeItem(mutationKey(id));
      return true;
    });
  } catch { return false; }
}

/* ---------- errors ---------- */
export const errorCode = (error) => error?.code || error?.detail?.code || error?.body?.code || error?.body?.detail?.code || '';
export const isPermissionError = (error) => error?.status === 403;
export const isStaleReview = (error) => error?.status === 409 && errorCode(error) === 'po_review_stale';
export const isUncertain = (error) => typeof error?.ambiguous === 'boolean' ? error.ambiguous : (!error?.status || error.status >= 500 || error.status === 408);
export function describeError(error, fallback) {
  if (isPermissionError(error)) return 'Your account does not have permission to use purchase orders.';
  return error?.message || fallback;
}

/* ---------- money display ---------- */
const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatPaise(paise) {
  const value = Number(paise);
  if (!Number.isFinite(value)) return '—';
  return rupees.format(value / 100);
}
export function trimDecimal(text, min = 2) {
  const value = String(text ?? '');
  if (!/^\d+(?:\.\d+)?$/.test(value)) return value || '—';
  const [whole, frac = ''] = value.split('.');
  const trimmed = frac.replace(/0+$/, '').padEnd(min, '0');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/* ---------- exact arithmetic (BigInt) ---------- */
function parseScaled(text, scale) {
  const value = String(text ?? '').trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2] || '').length > scale) return null;
  return BigInt(match[1] + (match[2] || '').padEnd(scale, '0'));
}
const roundDiv = (numerator, divisor) => (numerator * 2n + divisor) / (divisor * 2n);

export const MAX_LINES = 100;
export const MAX_TOTAL_PAISE = 10000000000;
const MAX_QTY = 1000000n * 1000n;
const MAX_PRICE = 999999999999999999n; // 999999999999.999999 at scale 6
const MAX_GST = 100n * 1000000n;

export function parseQuantity(text) {
  const value = parseScaled(text, 3);
  return value === null || value <= 0n || value > MAX_QTY ? null : value;
}

/** Returns { subtotal, gstAmount, total } in integer paise, or null when inputs are not computable. */
export function computeLine(quantityText, product, treatment) {
  const qty = parseQuantity(quantityText);
  if (qty === null || !product || product.unitPrice == null) return null;
  // Retained lines carry historical rates and MUST keep their exact arithmetic.
  // New choices are canonicalized at the catalogue/selection boundary.
  const price = parseScaled(product.unitPrice, 6);
  const gst = parseScaled(product.gst, 6);
  if (price === null || price > MAX_PRICE || gst === null || gst > MAX_GST) return null;
  const subtotal = roundDiv(qty * price, 10n ** 7n);
  if (subtotal > BigInt(MAX_TOTAL_PAISE)) return { overflow: true };
  if (!['igst', 'cgst_sgst', 'cgst_utgst'].includes(treatment)) return { subtotal: Number(subtotal), taxPending: true, gstAmount: null, total: null };
  // Rates have seven decimals: halving a six-decimal product rate is exact.
  const rates = Object.fromEntries(TAX_COMPONENTS.map((k) => [k, 0n]));
  if (treatment === 'igst') rates.igst = gst * 10n;
  else { rates.cgst = gst * 5n; rates[treatment.slice(5)] = gst * 5n; }
  const components = Object.fromEntries(TAX_COMPONENTS.map((k) => [k, roundDiv(subtotal * rates[k], 10n ** 9n)]));
  const gstAmount = TAX_COMPONENTS.reduce((sum, k) => sum + components[k], 0n);
  const total = subtotal + gstAmount;
  if (total > BigInt(MAX_TOTAL_PAISE)) return { overflow: true };
  const rateString = (value) => `${value / 10000000n}.${String(value % 10000000n).padStart(7, '0')}`.replace(/\.?0+$/, '');
  return { subtotal: Number(subtotal), gstAmount: Number(gstAmount), total: Number(total),
    taxComponents: Object.fromEntries(TAX_COMPONENTS.map((k) => [k, Number(components[k])])),
    componentRates: Object.fromEntries(TAX_COMPONENTS.map((k) => [k, rateString(rates[k]) || '0'])) };
}

/** Sum of rounded lines; null when no line is computable. overflow flags totals above the limit. */
export function computeTotals(lines, treatment) {
  const all = lines.map((line) => computeLine(line.quantity, line.product, treatment));
  if (all.some((part) => part?.overflow)) return { overflow: true };
  const parts = all.filter(Boolean);
  const incomplete = all.length - parts.length;
  const taxPending = parts.some((part) => part.taxPending);
  const metadata = { incomplete, partial: incomplete > 0, completed: parts.length, taxPending };
  const sum = (key) => parts.reduce((acc, part) => acc + BigInt(part[key]), 0n);
  const subtotal = sum('subtotal');
  if (subtotal > BigInt(MAX_TOTAL_PAISE)) return { ...metadata, overflow: true };
  if (taxPending) return { ...metadata, subtotal: Number(subtotal), gstAmount: null, total: null };
  const total = sum('total');
  if (total > BigInt(MAX_TOTAL_PAISE)) return { overflow: true };
  return { ...metadata, subtotal: Number(subtotal), gstAmount: Number(sum('gstAmount')), total: Number(total),
    taxComponents: Object.fromEntries(TAX_COMPONENTS.map((k) => [k, parts.reduce((sum, part) => sum + part.taxComponents[k], 0)])) };
}

/* ---------- dates ---------- */
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/* ---------- durable create identity (owner scoped, fails closed) ---------- */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const newKey = () => crypto.randomUUID();
const ownerId = () => { const id = getSession()?.user?.id; return id ? String(id) : ''; };
const pendingKey = () => `evexia.po.pending-create:${ownerId()}`;
const isRef = (item) => item && typeof item.id === 'string' && typeof item.name === 'string';
function validPending(p) {
  return Boolean(p && typeof p === 'object' && typeof p.fingerprint === 'string' && UUID.test(p.key || '') && typeof p.reviewToken === 'string'
    && p.owner === ownerId() && p.values && typeof p.values.poDate === 'string' && typeof p.values.expectedDate === 'string'
    && isRef(p.values.vendor) && isRef(p.values.location) && Array.isArray(p.values.lines) && p.values.lines.length > 0 && p.values.lines.length <= MAX_LINES
    && p.values.lines.every((line) => typeof line.key === 'string' && typeof line.quantity === 'string' && isRef(line.product))
    && p.order && Array.isArray(p.order.lines) && ['subtotal', 'gstAmount', 'total'].every((k) => Number.isFinite(Number(p.order[k])))
    && typeof p.order.vendorName === 'string' && typeof p.order.locationName === 'string');
}
/** Returns { status: 'none' | 'found' | 'blocked', pending?, message? }. Anything unreadable blocks creation. */
export function loadPending() {
  if (!ownerId()) return { status: 'blocked', message: 'Your session identity is unavailable, so a safe create cannot be started. Sign in again.' };
  let raw;
  try { raw = window.localStorage.getItem(pendingKey()); }
  catch { return { status: 'blocked', message: 'Browser storage is unavailable, so a duplicate-safe create cannot be guaranteed. Enable storage and reload.' }; }
  if (raw == null) return { status: 'none' };
  try {
    const pending = JSON.parse(raw);
    if (validPending(pending)) return { status: 'found', pending };
  } catch { /* falls through */ }
  return { status: 'blocked', message: 'A saved create attempt could not be read. Creation stays locked so it cannot be duplicated; check the order list, then clear this site\'s stored data to continue.' };
}
export async function savePending(pending) {
  const owner = ownerId();
  if (!owner || !navigator.locks) return false;
  try {
    return await navigator.locks.request(`evexia-po-create:${owner}`, () => {
      const stored = loadPending();
      if (ownerId() !== owner || stored.status === 'blocked' ||
          (stored.status === 'found' && (stored.pending.key !== pending.key || stored.pending.fingerprint !== pending.fingerprint))) return false;
      window.localStorage.setItem(pendingKey(), JSON.stringify({ ...pending, owner }));
      return true;
    });
  } catch { return false; }
}
export function clearPending() {
  try { window.localStorage.removeItem(pendingKey()); return true; } catch { return false; }
}

/* ---------- confirmed-save marker (set only after a confirmed server response) ---------- */
const SAVED_KEY = 'evexia.po.saved-notice';
export function markSaved(order) {
  try { window.sessionStorage.setItem(SAVED_KEY, JSON.stringify({ owner: ownerId(), number: String(order?.number || ''), documentRevision: order?.documentRevision ?? null })); } catch { /* notice is optional */ }
}
export function consumeSaved() {
  try {
    const raw = window.sessionStorage.getItem(SAVED_KEY);
    window.sessionStorage.removeItem(SAVED_KEY);
    const value = JSON.parse(raw || 'null');
    return value && value.owner === ownerId() ? value : null;
  } catch { return null; }
}
