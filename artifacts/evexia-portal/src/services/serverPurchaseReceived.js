import { getSession, purchaseReceivedRequest as request } from '../auth/adminSession.js';
import { validDate } from './serverPurchaseOrders.js';
export { getPOBalances } from './purchaseReceived.js';
export { exportPRCSV } from './purchaseReceived.js';

export const listPR = (params, signal) => request('', { params, signal });
export const exportPR = (params, signal) => request('/export', { params, signal });
export const activityPR = (params, signal) => request('/activity', { params, signal });
export const analyticsPR = (params, signal) => request('/analytics', { params, signal });
export const filtersPR = (params, signal) => request('/filter-options', { params, signal });
export const referencePR = (kind, params, signal) => request(`/references/${kind}`, { params, signal });
export const getPR = (id, signal) => request(`/${id}`, { signal });
export const sourcePR = (id, exclude, signal) => request(`/sources/${id}`, { params: { exclude_id: exclude }, signal });
export const reviewPR = (input, id) => request(id ? `/${id}/preview` : '/preview', { body: input });
export const savePR = (input, token, key, receipt) => request(receipt ? `/${receipt.id}/edit` : '', { body: {
  ...input, reviewToken: token, idempotencyKey: key, ...(receipt ? { expected_version: receipt.version } : {}),
} });
export const removePR = (receipt, key) => request(`/${receipt.id}/delete`, { body: { expected_version: receipt.version, idempotencyKey: key } });
export const reconcilePR = (key) => request(`/requests/${key}`);
export const getPOFulfillment = (po) => po?.fulfillment || 'Open';
export const isSamplePR = () => false;
export const ownerPR = () => String(getSession()?.user?.id || '');
const journalKey = () => `evexia.pr.pending:${ownerPR()}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Persist ONLY opaque retry identity. Sensitive draft/review stays in memory. */
export function pendingPR() {
  try {
    if (!ownerPR()) throw new Error();
    const raw = localStorage.getItem(journalKey());
    if (raw === null) return null;
    const item = JSON.parse(raw);
    if (item.owner !== ownerPR() || !uuid.test(item.key) || !['create', 'edit', 'delete'].includes(item.operation)
      || (item.id !== null && !uuid.test(item.id))) throw new Error();
    return item;
  } catch { throw new Error('Receipt retry identity is unavailable. Restore browser storage/session access; do not start a replacement save until the previous outcome is checked.'); }
}
export async function rememberPR(item) {
  const owner = ownerPR();
  if (!owner || !navigator.locks) throw new Error('A safe save needs browser storage and Web Locks. Nothing was sent.');
  await navigator.locks.request(`evexia-pr:${owner}`, () => {
    const previous = pendingPR();
    if (ownerPR() !== owner || (previous && previous.key !== item.key)) throw new Error('Another receipt save is unresolved. Reconcile it before saving again.');
    localStorage.setItem(journalKey(), JSON.stringify({ owner, key: item.key, id: item.id || null, operation: item.operation }));
  });
}
export async function forgetPR(key) {
  const owner = ownerPR();
  if (!owner || !navigator.locks) throw new Error('Retry storage unavailable; reconcile before a new save.');
  await navigator.locks.request(`evexia-pr:${owner}`, () => {
    if (ownerPR() !== owner || pendingPR()?.key !== key) throw new Error('Retry identity changed.');
    localStorage.removeItem(journalKey());
  });
}

const milli = (v) => {
  if (!/^\d+(?:\.\d{1,3})?$/.test(String(v ?? '').trim())) return null;
  const [a, b = ''] = String(v).trim().split('.');
  const n = BigInt(a + b.padEnd(3, '0'));
  return n <= 1000000000n ? n : null;
};
export function inputPR(values) {
  return { poId: values.poId, receivedDate: values.receivedDate, receiverMode: values.receiverMode,
    staffId: values.receiverMode === 'staff' ? values.staff?.id || null : null,
    otherName: values.receiverMode === 'other' ? values.otherName.trim() : null,
    lines: values.rows.filter((r) => milli(r.receivedQty) !== 0n && String(r.receivedQty).trim() !== '')
      .map((r) => ({ ...r, receivedQty: String(r.receivedQty).trim(), acceptedQty: String(r.acceptedQty).trim() })) };
}
export function validateDraftPR(values, po, receipt) {
  const errors = {};
  if (!po || po.id !== values.poId) errors.poId = 'Select an available server Purchase Order.';
  if (!validDate(values.receivedDate)) errors.receivedDate = 'Enter a valid received date.';
  else if (po && values.receivedDate < po.poDate) errors.receivedDate = 'Received date cannot be before PO date.';
  if (values.receiverMode === 'staff' && !values.staff) errors.receivedBy = 'Select active staff or Others.';
  if (values.receiverMode === 'other' && (!values.otherName.trim() || values.otherName.trim().length > 120)) errors.receivedBy = 'Enter the person’s name (up to 120 characters).';
  let positive = 0;
  values.rows.forEach((r, i) => {
    const received = milli(r.receivedQty), accepted = milli(r.acceptedQty);
    const key = (f, message) => { errors[`lines.${i}.${f}`] = message; };
    if ((!String(r.receivedQty).trim() || received === 0n) && (!String(r.acceptedQty).trim() || accepted === 0n)) return;
    if (received === null || received <= 0n) key('receivedQty', 'Enter a positive quantity with up to 3 decimals.');
    else positive++;
    if (accepted === null || (received !== null && accepted > received)) key('acceptedQty', 'Enter acceptance between zero and received, up to 3 decimals.');
    const available = milli(po?.balances?.[r.lineId] ?? '0');
    const old = milli(receipt?.lines.find((l) => l.lineId === r.lineId)?.receivedQty ?? '0');
    if (received !== null && available !== null && received > (old > available ? old : available)) key('receivedQty', 'Quantity exceeds current or retained historical allowance.');
    if (accepted !== null && available !== null && accepted > available) key('acceptedQty', 'Acceptance exceeds the balance after other active receipts.');
    if (!r.batchNo.trim()) key('batchNo', 'Batch number is required.');
    if (!validDate(r.expiryDate) || r.expiryDate < values.receivedDate) key('expiryDate', 'Enter an expiry on or after receiving.');
  });
  if (!positive) errors.lines = 'Enter at least one positive received quantity.';
  return errors;
}
